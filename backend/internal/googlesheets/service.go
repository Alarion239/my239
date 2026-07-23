package googlesheets

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/pkg/db"
)

// ErrParserNotConfigured deliberately blocks semantic synchronization until a
// center-specific workbook mapping is supplied. Linking and Google access stay
// usable, but no unreviewed row/column heuristic can alter student history.
var ErrParserNotConfigured = errors.New("google sheets conduit parser is not configured")

type LinkKind string

const (
	LinkKindConduit        LinkKind = "conduit"
	LinkKindInitialsLegend LinkKind = "initials_legend"
)

type SyncDirection string

const (
	SyncDirectionTwoWay       SyncDirection = "two_way"
	SyncDirectionOutboundOnly SyncDirection = "outbound_only"
)

type Link struct {
	ID                   int64         `json:"id"`
	TermID               int64         `json:"term_id"`
	GroupID              *int64        `json:"group_id"`
	GroupName            *string       `json:"group_name"`
	LinkKind             LinkKind      `json:"link_kind"`
	SyncDirection        SyncDirection `json:"sync_direction"`
	SpreadsheetID        string        `json:"spreadsheet_id"`
	SheetID              int64         `json:"sheet_id"`
	SheetTitle           string        `json:"sheet_title"`
	Enabled              bool          `json:"enabled"`
	LastGoogleVersion    string        `json:"last_google_version"`
	LastGoogleModifiedAt *time.Time    `json:"last_google_modified_at"`
	CreatedAt            time.Time     `json:"created_at"`
	UpdatedAt            time.Time     `json:"updated_at"`
}

type SyncRun struct {
	ID               int64           `json:"id"`
	LinkID           int64           `json:"link_id"`
	Status           string          `json:"status"`
	GoogleVersion    string          `json:"google_version"`
	GoogleModifiedAt *time.Time      `json:"google_modified_at"`
	Summary          json.RawMessage `json:"summary"`
	ErrorMessage     string          `json:"error_message"`
	StartedAt        time.Time       `json:"started_at"`
	FinishedAt       *time.Time      `json:"finished_at"`
}

// Service owns persistence and the Google boundary. Parser execution is kept
// separate: it receives/produces semantic cell data only after an explicit
// mapping contract exists.
type Service struct {
	pool   db.Pool
	client Client
}

func NewDisabledService(pool db.Pool) *Service { return &Service{pool: pool} }

func NewService(pool db.Pool, serviceAccountJSON string) (*Service, error) {
	client, err := NewHTTPClient(serviceAccountJSON)
	if errors.Is(err, ErrNotConfigured) {
		return &Service{pool: pool}, nil
	}
	if err != nil {
		return nil, err
	}
	return &Service{pool: pool, client: client}, nil
}

func (s *Service) Configured() bool { return s != nil && s.client != nil }

func (s *Service) DiscoverTabs(ctx context.Context, spreadsheetURL string) (string, []Tab, error) {
	if !s.Configured() {
		return "", nil, ErrNotConfigured
	}
	spreadsheetID, err := SpreadsheetIDFromURL(spreadsheetURL)
	if err != nil {
		return "", nil, err
	}
	tabs, err := s.client.ListTabs(ctx, spreadsheetID)
	if err != nil {
		return "", nil, fmt.Errorf("listing google sheet tabs: %w", err)
	}
	return spreadsheetID, tabs, nil
}

func (s *Service) CreateLink(ctx context.Context, centerID, termID, groupID, sheetID, actorID int64, kind LinkKind, spreadsheetURL string) (Link, error) {
	if !s.Configured() {
		return Link{}, ErrNotConfigured
	}
	spreadsheetID, tabs, err := s.DiscoverTabs(ctx, spreadsheetURL)
	if err != nil {
		return Link{}, err
	}
	var title string
	for _, tab := range tabs {
		if tab.ID == sheetID {
			title = tab.Title
			break
		}
	}
	if title == "" {
		return Link{}, errors.New("selected tab was not found in the spreadsheet")
	}
	if err := validateLinkTarget(kind, groupID, title); err != nil {
		return Link{}, err
	}
	var belongs bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (
        SELECT 1 FROM math_center_terms WHERE id = $1 AND math_center_id = $2
    )`, termID, centerID).Scan(&belongs); err != nil {
		return Link{}, fmt.Errorf("checking google sheet term: %w", err)
	}
	if !belongs {
		return Link{}, errors.New("term does not belong to this math center")
	}
	if kind == LinkKindConduit {
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS (
            SELECT 1 FROM math_center_groups
            WHERE id = $1 AND term_id = $2 AND math_center_id = $3
        )`, groupID, termID, centerID).Scan(&belongs); err != nil {
			return Link{}, fmt.Errorf("checking google sheet group: %w", err)
		}
		if !belongs {
			return Link{}, errors.New("group does not belong to this term and math center")
		}
	}
	direction := directionForKind(kind)
	const query = `INSERT INTO math_center_google_sheet_links
        (term_id, group_id, link_kind, sync_direction, spreadsheet_id, sheet_id, sheet_title, created_by_user_id)
        VALUES ($1, NULLIF($2, 0), $3, $4, $5, $6, $7, $8)
        RETURNING id, term_id, group_id, NULL::TEXT, link_kind, sync_direction,
          spreadsheet_id, sheet_id, sheet_title, enabled, last_google_version,
          last_google_modified_at, created_at, updated_at`
	link, err := scanLink(s.pool.QueryRow(ctx, query, termID, groupID, kind, direction, spreadsheetID, sheetID, title, actorID))
	if err != nil {
		return Link{}, fmt.Errorf("creating google sheet link: %w", err)
	}
	return link, nil
}

func (s *Service) ListLinks(ctx context.Context, centerID int64) ([]Link, error) {
	const query = `SELECT l.id, l.term_id, l.group_id, g.name, l.link_kind, l.sync_direction,
        l.spreadsheet_id, l.sheet_id, l.sheet_title, l.enabled, l.last_google_version,
        l.last_google_modified_at, l.created_at, l.updated_at
        FROM math_center_google_sheet_links l
        JOIN math_center_terms t ON t.id = l.term_id
		LEFT JOIN math_center_groups g ON g.id = l.group_id
        WHERE t.math_center_id = $1
        ORDER BY t.is_active DESC, t.grade DESC NULLS LAST, l.created_at`
	rows, err := s.pool.Query(ctx, query, centerID)
	if err != nil {
		return nil, fmt.Errorf("listing google sheet links: %w", err)
	}
	defer rows.Close()
	links := []Link{}
	for rows.Next() {
		link, err := scanLink(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning google sheet link: %w", err)
		}
		links = append(links, link)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating google sheet links: %w", err)
	}
	return links, nil
}

func (s *Service) ListRuns(ctx context.Context, centerID int64) ([]SyncRun, error) {
	const query = `SELECT r.id, r.link_id, r.status, r.google_version, r.google_modified_at,
        r.summary, r.error_message, r.started_at, r.finished_at
        FROM math_center_google_sheet_sync_runs r
        JOIN math_center_google_sheet_links l ON l.id = r.link_id
        JOIN math_center_terms t ON t.id = l.term_id
        WHERE t.math_center_id = $1
        ORDER BY r.started_at DESC LIMIT 30`
	rows, err := s.pool.Query(ctx, query, centerID)
	if err != nil {
		return nil, fmt.Errorf("listing google sheet sync runs: %w", err)
	}
	defer rows.Close()
	runs := []SyncRun{}
	for rows.Next() {
		var run SyncRun
		if err := rows.Scan(&run.ID, &run.LinkID, &run.Status, &run.GoogleVersion,
			&run.GoogleModifiedAt, &run.Summary, &run.ErrorMessage, &run.StartedAt, &run.FinishedAt); err != nil {
			return nil, fmt.Errorf("scanning google sheet sync run: %w", err)
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

func (s *Service) SetEnabled(ctx context.Context, centerID, linkID int64, enabled bool) error {
	command, err := s.pool.Exec(ctx, `UPDATE math_center_google_sheet_links l
        SET enabled = $1, updated_at = NOW()
        FROM math_center_terms t
        WHERE l.id = $2 AND l.term_id = t.id AND t.math_center_id = $3`, enabled, linkID, centerID)
	if err != nil {
		return fmt.Errorf("updating google sheet link: %w", err)
	}
	if command.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Service) DeleteLink(ctx context.Context, centerID, linkID int64) error {
	command, err := s.pool.Exec(ctx, `DELETE FROM math_center_google_sheet_links l
        USING math_center_terms t
        WHERE l.id = $1 AND l.term_id = t.id AND t.math_center_id = $2`, linkID, centerID)
	if err != nil {
		return fmt.Errorf("deleting google sheet link: %w", err)
	}
	if command.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// SyncTerm records the remote workbook version for every enabled link. Actual
// accept/retraction reconciliation returns ErrParserNotConfigured until the
// approved parser is attached; this deliberately never mutates a conduit by
// guessing the meaning of a cell.
func (s *Service) SyncTerm(ctx context.Context, centerID, termID, actorID int64) ([]SyncRun, error) {
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	links, err := s.linksForTerm(ctx, centerID, termID)
	if err != nil {
		return nil, err
	}
	runs := make([]SyncRun, 0, len(links))
	for _, link := range links {
		run, err := s.syncLink(ctx, link, actorID)
		if err != nil {
			return runs, err
		}
		runs = append(runs, run)
	}
	return runs, nil
}

func (s *Service) linksForTerm(ctx context.Context, centerID, termID int64) ([]Link, error) {
	const query = `SELECT l.id, l.term_id, l.group_id, g.name, l.link_kind, l.sync_direction,
        l.spreadsheet_id, l.sheet_id, l.sheet_title, l.enabled, l.last_google_version,
        l.last_google_modified_at, l.created_at, l.updated_at
        FROM math_center_google_sheet_links l
        JOIN math_center_terms t ON t.id = l.term_id
		LEFT JOIN math_center_groups g ON g.id = l.group_id
        WHERE l.term_id = $1 AND t.math_center_id = $2 AND l.enabled = TRUE
        ORDER BY l.id`
	rows, err := s.pool.Query(ctx, query, termID, centerID)
	if err != nil {
		return nil, fmt.Errorf("listing enabled google sheet links: %w", err)
	}
	defer rows.Close()
	links := []Link{}
	for rows.Next() {
		link, err := scanLink(rows)
		if err != nil {
			return nil, err
		}
		links = append(links, link)
	}
	return links, rows.Err()
}

func (s *Service) syncLink(ctx context.Context, link Link, actorID int64) (SyncRun, error) {
	var run SyncRun
	if err := s.pool.QueryRow(ctx, `INSERT INTO math_center_google_sheet_sync_runs
        (link_id, requested_by_user_id, status) VALUES ($1, $2, 'running')
        RETURNING id, link_id, status, google_version, google_modified_at, summary,
          error_message, started_at, finished_at`, link.ID, actorID).Scan(
		&run.ID, &run.LinkID, &run.Status, &run.GoogleVersion, &run.GoogleModifiedAt,
		&run.Summary, &run.ErrorMessage, &run.StartedAt, &run.FinishedAt); err != nil {
		return SyncRun{}, fmt.Errorf("creating google sheet sync run: %w", err)
	}
	metadata, err := s.client.Metadata(ctx, link.SpreadsheetID)
	if err == nil {
		_, err = s.pool.Exec(ctx, `UPDATE math_center_google_sheet_links
            SET last_google_version = $1, last_google_modified_at = $2, updated_at = NOW()
            WHERE id = $3`, metadata.Version, metadata.ModifiedAt, link.ID)
	}
	if err == nil {
		err = ErrParserNotConfigured
	}
	if err != nil {
		_, updateErr := s.pool.Exec(ctx, `UPDATE math_center_google_sheet_sync_runs
            SET status = 'failed', google_version = $1, google_modified_at = $2,
                error_message = $3, finished_at = NOW() WHERE id = $4`,
			metadata.Version, nullableTime(metadata.ModifiedAt), safeError(err), run.ID)
		if updateErr != nil {
			return SyncRun{}, fmt.Errorf("recording google sheet sync failure: %w", updateErr)
		}
		run.Status, run.GoogleVersion, run.ErrorMessage = "failed", metadata.Version, safeError(err)
		run.GoogleModifiedAt = nullableTime(metadata.ModifiedAt)
		now := time.Now()
		run.FinishedAt = &now
		return run, nil
	}
	return run, nil
}

type rowScanner interface{ Scan(...any) error }

func scanLink(row rowScanner) (Link, error) {
	var link Link
	err := row.Scan(&link.ID, &link.TermID, &link.GroupID, &link.GroupName, &link.LinkKind,
		&link.SyncDirection, &link.SpreadsheetID, &link.SheetID, &link.SheetTitle, &link.Enabled,
		&link.LastGoogleVersion, &link.LastGoogleModifiedAt, &link.CreatedAt, &link.UpdatedAt)
	return link, err
}

func validateLinkTarget(kind LinkKind, groupID int64, title string) error {
	title = strings.ToLower(strings.TrimSpace(title))
	if title == "зп" {
		return errors.New("the ЗП tab cannot be linked")
	}
	switch kind {
	case LinkKindConduit:
		if groupID <= 0 {
			return errors.New("a group is required for a conduit tab")
		}
	case LinkKindInitialsLegend:
		if groupID != 0 {
			return errors.New("the initials legend cannot be linked to a group")
		}
		if title != "расшифровка" {
			return errors.New("only the Расшифровка tab can be an initials legend")
		}
	default:
		return errors.New("invalid Google Sheets link kind")
	}
	return nil
}

func directionForKind(kind LinkKind) SyncDirection {
	if kind == LinkKindInitialsLegend {
		return SyncDirectionOutboundOnly
	}
	return SyncDirectionTwoWay
}

func nullableTime(value time.Time) *time.Time {
	if value.IsZero() {
		return nil
	}
	return &value
}

func safeError(err error) string {
	message := err.Error()
	if len(message) > 1000 {
		return message[:1000]
	}
	return message
}

// SpreadsheetIDFromURL accepts the normal Google Sheets URL or an already
// extracted ID. It does not fetch the supplied URL.
func SpreadsheetIDFromURL(value string) (string, error) {
	value = strings.TrimSpace(value)
	if validSpreadsheetID(value) == nil {
		return value, nil
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "docs.google.com" {
		return "", errors.New("enter a Google Sheets URL or spreadsheet id")
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) < 3 || parts[0] != "spreadsheets" || parts[1] != "d" {
		return "", errors.New("enter a Google Sheets spreadsheet URL")
	}
	if err := validSpreadsheetID(parts[2]); err != nil {
		return "", err
	}
	return parts[2], nil
}
