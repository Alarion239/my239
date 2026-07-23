// Package tokenpreset defines the versioned, typed preset carried by an
// invitation token. A preset describes who a registrant becomes — granted
// admin, enrolled as a math-center student, enrolled as a math-center teacher —
// and is ENFORCED server-side at registration: the registrant supplies only a
// username/password, never the grants.
//
// The preset is persisted as JSONB (invitation_tokens.preset). Storing it as a
// document rather than dedicated columns means a future consumer (e.g. alumni
// enrollment) is added by extending the Go types here — no DB migration. The
// Version field lets old tokens be rejected cleanly if the schema changes
// incompatibly.
//
// Lifecycle:
//   - Parse decodes the stored JSONB into a Preset (used at registration and
//     when echoing a token back).
//   - Validate checks referential integrity against the database (used at token
//     CREATION, before the JSONB is stored).
//   - Apply performs the grants inside the registration transaction.
package tokenpreset

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/store"
)

// CurrentVersion is the schema version written by Marshal and required by
// Parse. Bump it (and teach Parse to migrate or reject older payloads) only on
// an incompatible change to the Preset shape.
const CurrentVersion = 1

// Preset is the typed view of invitation_tokens.preset. The zero value (with
// Version normalized to CurrentVersion) means "no extra grants" — a plain
// invitation token. Each non-nil consumer field describes one grant applied at
// registration.
//
// Adding a consumer: add an optional field here (a pointer or a bool with
// `omitempty`) plus a Validate/Apply branch. No migration is required because
// the column is schemaless JSONB.
type Preset struct {
	Version           int                `json:"version"`
	GrantsAdmin       bool               `json:"grants_admin,omitempty"`
	MathCenterStudent *MathCenterStudent `json:"mathcenter_student,omitempty"`
	MathCenterTeacher *MathCenterTeacher `json:"mathcenter_teacher,omitempty"`
}

// MathCenterStudent enrolls the registrant as a student in the given group. The
// group's owning center is resolved server-side; the registrant never names a
// center directly as a student.
type MathCenterStudent struct {
	GroupID int64 `json:"group_id"`
}

// MathCenterTeacher enrolls the registrant as a teacher of the given center,
// optionally as a head teacher.
type MathCenterTeacher struct {
	CenterID      int64 `json:"center_id"`
	IsHeadTeacher bool  `json:"is_head_teacher"`
}

// Sentinel errors. Validate and Apply wrap these so callers can classify a
// failure with errors.Is without string matching:
//
//   - ErrUnsupportedVersion → the stored payload predates / postdates this
//     build's schema (treat as a server/config problem).
//   - ErrInvalidPreset → the preset references something that does not exist,
//     or is internally contradictory; surfaced as 4xx at token creation /
//     registration.
//   - ErrConflict → the grant cannot be applied because it violates an
//     invariant for this specific user (e.g. per-center student/teacher
//     exclusivity); surfaced as 409 at registration.
var (
	ErrUnsupportedVersion = errors.New("unsupported preset version")
	ErrInvalidPreset      = errors.New("invalid token preset")
	ErrConflict           = errors.New("preset conflicts with existing membership")
)

// Store is the subset of *store.Queries that tokenpreset depends on. Call sites
// pass a concrete *store.Queries; the interface exists so tests can drive
// Validate/Apply with a pgxmock-backed *store.Queries or a hand-written mock.
type Store interface {
	GetGroup(ctx context.Context, id int64) (store.GetGroupRow, error)
	GetMathCenter(ctx context.Context, id int64) (store.MathCenter, error)
	IsTeacherInCenter(ctx context.Context, arg store.IsTeacherInCenterParams) (bool, error)
	IsStudentInCenter(ctx context.Context, arg store.IsStudentInCenterParams) (bool, error)
	SetUserAdmin(ctx context.Context, arg store.SetUserAdminParams) error
	AddStudentToGroup(ctx context.Context, arg store.AddStudentToGroupParams) (store.AddStudentToGroupRow, error)
	AddTeacherToCenter(ctx context.Context, arg store.AddTeacherToCenterParams) (store.MathCenterTeacher, error)
}

// Parse decodes a stored JSONB preset. An empty payload (nil, "" or "{}")
// yields an empty preset at CurrentVersion. A payload whose version is neither
// 0 (legacy/unset) nor CurrentVersion is rejected with ErrUnsupportedVersion.
// The returned Preset always has Version == CurrentVersion.
func Parse(raw json.RawMessage) (Preset, error) {
	var p Preset
	if len(raw) == 0 {
		p.Version = CurrentVersion
		return p, nil
	}

	if err := json.Unmarshal(raw, &p); err != nil {
		return Preset{}, fmt.Errorf("%w: %w", ErrInvalidPreset, err)
	}

	if p.Version != 0 && p.Version != CurrentVersion {
		return Preset{}, fmt.Errorf("%w: got %d, supported %d", ErrUnsupportedVersion, p.Version, CurrentVersion)
	}
	p.Version = CurrentVersion
	return p, nil
}

// Marshal serializes a preset for storage, stamping it with CurrentVersion.
func Marshal(p Preset) (json.RawMessage, error) {
	p.Version = CurrentVersion
	raw, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal preset: %w", err)
	}
	return raw, nil
}

// Validate checks a preset's referential integrity at token CREATION, before
// it is stored. It confirms referenced entities exist and that the preset is
// not internally contradictory; it does NOT touch the (not-yet-existing)
// registrant. Returns a wrapped ErrInvalidPreset for any problem.
//
// Rules:
//   - MathCenterStudent: the group must exist.
//   - MathCenterTeacher: the center must exist.
//   - Both set resolving to the SAME center is rejected — it would always fail
//     at registration on per-center student/teacher exclusivity, so reject the
//     contradiction up front rather than mint an unusable token.
func Validate(ctx context.Context, q Store, p Preset) error {
	var studentCenterID int64
	haveStudentCenter := false

	if p.MathCenterStudent != nil {
		group, err := q.GetGroup(ctx, p.MathCenterStudent.GroupID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("%w: math-center group %d does not exist", ErrInvalidPreset, p.MathCenterStudent.GroupID)
			}
			return fmt.Errorf("validate student group: %w", err)
		}
		studentCenterID = group.MathCenterID
		haveStudentCenter = true
	}

	if p.MathCenterTeacher != nil {
		if _, err := q.GetMathCenter(ctx, p.MathCenterTeacher.CenterID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("%w: math-center %d does not exist", ErrInvalidPreset, p.MathCenterTeacher.CenterID)
			}
			return fmt.Errorf("validate teacher center: %w", err)
		}

		if haveStudentCenter && studentCenterID == p.MathCenterTeacher.CenterID {
			return fmt.Errorf("%w: cannot enroll as both student and teacher of the same center (%d)", ErrInvalidPreset, p.MathCenterTeacher.CenterID)
		}
	}

	return nil
}

// Apply enforces the preset against the freshly-created user at registration.
// The caller passes the transaction-bound *store.Queries (store.New(tx)) so the
// grants commit atomically with the user row; on any error the caller rolls
// back. userID is the id returned by CreateUser.
//
// Error classification (via errors.Is):
//   - ErrInvalidPreset — a referenced entity vanished between token creation and
//     registration (group/center deleted). Surface as 4xx.
//   - ErrConflict — the grant violates per-center student/teacher exclusivity for
//     this user. Surface as 409.
//   - anything else — wrapped internal/database error; surface as 500.
func Apply(ctx context.Context, q Store, userID int64, p Preset) error {
	if p.GrantsAdmin {
		if err := q.SetUserAdmin(ctx, store.SetUserAdminParams{ID: userID, IsAdmin: true}); err != nil {
			return fmt.Errorf("grant admin: %w", err)
		}
	}

	if p.MathCenterStudent != nil {
		if err := applyStudent(ctx, q, userID, *p.MathCenterStudent); err != nil {
			return err
		}
	}

	if p.MathCenterTeacher != nil {
		if err := applyTeacher(ctx, q, userID, *p.MathCenterTeacher); err != nil {
			return err
		}
	}

	return nil
}

func applyStudent(ctx context.Context, q Store, userID int64, s MathCenterStudent) error {
	group, err := q.GetGroup(ctx, s.GroupID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: math-center group %d no longer exists", ErrInvalidPreset, s.GroupID)
		}
		return fmt.Errorf("resolve student group: %w", err)
	}

	// Per-center exclusivity: a user is a student or a teacher of a center,
	// never both. Mirrors the guard in the admin add-student handler.
	isTeacher, err := q.IsTeacherInCenter(ctx, store.IsTeacherInCenterParams{
		UserID:       userID,
		MathCenterID: group.MathCenterID,
	})
	if err != nil {
		return fmt.Errorf("check teacher membership: %w", err)
	}
	if isTeacher {
		return fmt.Errorf("%w: user is a teacher of center %d and cannot also be a student there", ErrConflict, group.MathCenterID)
	}

	if _, err := q.AddStudentToGroup(ctx, store.AddStudentToGroupParams{
		UserID:  userID,
		GroupID: s.GroupID,
	}); err != nil {
		return fmt.Errorf("enroll student: %w", err)
	}
	return nil
}

func applyTeacher(ctx context.Context, q Store, userID int64, tch MathCenterTeacher) error {
	if _, err := q.GetMathCenter(ctx, tch.CenterID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: math-center %d no longer exists", ErrInvalidPreset, tch.CenterID)
		}
		return fmt.Errorf("resolve teacher center: %w", err)
	}

	isStudent, err := q.IsStudentInCenter(ctx, store.IsStudentInCenterParams{
		UserID:       userID,
		MathCenterID: tch.CenterID,
	})
	if err != nil {
		return fmt.Errorf("check student membership: %w", err)
	}
	if isStudent {
		return fmt.Errorf("%w: user is a student of center %d and cannot also be a teacher there", ErrConflict, tch.CenterID)
	}

	if _, err := q.AddTeacherToCenter(ctx, store.AddTeacherToCenterParams{
		UserID:        userID,
		MathCenterID:  tch.CenterID,
		IsHeadTeacher: tch.IsHeadTeacher,
	}); err != nil {
		return fmt.Errorf("enroll teacher: %w", err)
	}
	return nil
}
