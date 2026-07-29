package googlesheets

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/store"
)

const unavailableSeriesTex = "Серия недоступна. Попросите преподавателя загрузить её в систему"

type StudentSyncResult struct {
	AddedToMy239  int `json:"added_to_my239"`
	AddedToSheets int `json:"added_to_sheets"`
	Matched       int `json:"matched"`
	Moved         int `json:"moved"`
	Ambiguous     int `json:"ambiguous"`
}

type SeriesSyncResult struct {
	AddedToMy239  int `json:"added_to_my239"`
	AddedToSheets int `json:"added_to_sheets"`
	Matched       int `json:"matched"`
}

type conduitRoster struct {
	headerRow   int
	nameColumn  int
	lastNameRow int
	names       []string
	nameKeys    map[string]struct{}
}

type linkedRoster struct {
	link   Link
	values [][]string
	roster conduitRoster
}

type sheetProblem struct {
	number int
	label  string
}

type sheetSeries struct {
	number   int
	problems []sheetProblem
}

type sheetLayout struct {
	headerRow int
	series    []sheetSeries
}

type linkedSeries struct {
	link   Link
	values [][]string
	layout sheetLayout
}

type userName struct {
	id         int64
	firstName  string
	middleName *string
	lastName   string
}

type enrollment struct {
	id      int64
	groupID int64
}

// SyncStudents performs a non-destructive two-way roster union for every
// enabled conduit link in the selected term. A tab is already bound to one
// group, so a matched student is enrolled in that group. No row is removed
// from either system.
func (s *Service) SyncStudents(ctx context.Context, centerID, termID int64) (StudentSyncResult, error) {
	var result StudentSyncResult
	if !s.Configured() {
		return result, ErrNotConfigured
	}
	links, err := s.linksForTerm(ctx, centerID, termID)
	if err != nil {
		return result, err
	}
	linked := make([]linkedRoster, 0, len(links))
	nameGroups := make(map[string]int64)
	for _, link := range links {
		if link.LinkKind != LinkKindConduit || link.GroupID == nil {
			continue
		}
		values, err := s.client.Values(ctx, link.SpreadsheetID, link.SheetTitle)
		if err != nil {
			return result, fmt.Errorf("reading student roster from %q: %w", link.SheetTitle, err)
		}
		roster, err := parseConduitRoster(values)
		if err != nil {
			return result, fmt.Errorf("reading student roster from %q: %w", link.SheetTitle, err)
		}
		for _, name := range roster.names {
			key := normalizePersonName(name)
			if groupID, exists := nameGroups[key]; exists && groupID != *link.GroupID {
				return result, fmt.Errorf("student %q occurs in linked tabs for different groups", name)
			}
			nameGroups[key] = *link.GroupID
		}
		linked = append(linked, linkedRoster{link: link, values: values, roster: roster})
	}
	if len(linked) == 0 {
		return result, nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return result, fmt.Errorf("beginning student synchronization: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	usersByName, err := loadUsersByName(ctx, tx)
	if err != nil {
		return result, err
	}
	enrollments, err := loadEnrollments(ctx, tx, termID)
	if err != nil {
		return result, err
	}
	passwordHash := ""
	for _, item := range linked {
		for _, sheetName := range item.roster.names {
			key := normalizePersonName(sheetName)
			user, ok := chooseUser(usersByName[key], enrollments)
			if !ok && len(usersByName[key]) > 0 {
				result.Ambiguous++
				continue
			}
			if !ok {
				lastName, firstName, middleName, splitErr := splitSheetName(sheetName)
				if splitErr != nil {
					result.Ambiguous++
					continue
				}
				if passwordHash == "" {
					passwordHash, err = unavailableAccountPasswordHash()
					if err != nil {
						return result, err
					}
				}
				username, usernameErr := randomSheetsUsername()
				if usernameErr != nil {
					return result, usernameErr
				}
				q := store.New(tx)
				created, createErr := q.CreateUser(ctx, store.CreateUserParams{
					Username: username, PasswordHash: passwordHash,
					FirstName: firstName, MiddleName: middleName, LastName: lastName,
				})
				if createErr != nil {
					return result, fmt.Errorf("creating student %q: %w", sheetName, createErr)
				}
				user = userName{
					id: created.ID, firstName: created.FirstName,
					middleName: created.MiddleName, lastName: created.LastName,
				}
				usersByName[key] = []userName{user}
			}

			targetGroup := *item.link.GroupID
			current, enrolled := enrollments[user.id]
			switch {
			case !enrolled:
				if _, err := tx.Exec(ctx, `INSERT INTO math_center_students (user_id, group_id, term_id)
					VALUES ($1, $2, $3)`, user.id, targetGroup, termID); err != nil {
					return result, fmt.Errorf("enrolling student %q: %w", sheetName, err)
				}
				enrollments[user.id] = enrollment{groupID: targetGroup}
				result.AddedToMy239++
			case current.groupID != targetGroup:
				if _, err := tx.Exec(ctx, `UPDATE math_center_students SET group_id = $1
					WHERE id = $2 AND term_id = $3`, targetGroup, current.id, termID); err != nil {
					return result, fmt.Errorf("moving student %q to linked group: %w", sheetName, err)
				}
				current.groupID = targetGroup
				enrollments[user.id] = current
				result.Moved++
			default:
				result.Matched++
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return result, fmt.Errorf("committing student synchronization: %w", err)
	}

	// Local membership commits first. If Google is temporarily unavailable,
	// retrying this button is idempotent and only the missing sheet rows remain.
	for _, item := range linked {
		groupNames, err := s.groupStudentNames(ctx, termID, *item.link.GroupID)
		if err != nil {
			return result, err
		}
		missing := make([]string, 0)
		for _, name := range groupNames {
			if _, exists := item.roster.nameKeys[normalizePersonName(name)]; !exists {
				missing = append(missing, name)
			}
		}
		if len(missing) == 0 {
			continue
		}
		startRow := item.roster.lastNameRow + 2
		endRow := startRow + len(missing) - 1
		values := make([][]string, len(missing))
		for index, name := range missing {
			values[index] = []string{name}
		}
		rangeName := columnName(item.roster.nameColumn) + strconv.Itoa(startRow) + ":" +
			columnName(item.roster.nameColumn) + strconv.Itoa(endRow)
		if err := s.client.UpdateValues(ctx, item.link.SpreadsheetID, item.link.SheetTitle, rangeName, values); err != nil {
			return result, fmt.Errorf("adding students to %q: %w", item.link.SheetTitle, err)
		}
		result.AddedToSheets += len(missing)
	}
	return result, nil
}

// SyncSeries unions series numbers in my239 and each enabled conduit tab.
// Sheet-only series receive visible placeholder LaTeX and the exact problem
// columns found in the conduit. Existing my239 series are never overwritten.
func (s *Service) SyncSeries(ctx context.Context, centerID, termID int64) (SeriesSyncResult, error) {
	var result SeriesSyncResult
	if !s.Configured() {
		return result, ErrNotConfigured
	}
	links, err := s.linksForTerm(ctx, centerID, termID)
	if err != nil {
		return result, err
	}
	linked := make([]linkedSeries, 0, len(links))
	importLayouts := make(map[int]sheetSeries)
	for _, link := range links {
		if link.LinkKind != LinkKindConduit {
			continue
		}
		values, err := s.client.Values(ctx, link.SpreadsheetID, link.SheetTitle)
		if err != nil {
			return result, fmt.Errorf("reading series from %q: %w", link.SheetTitle, err)
		}
		layout, err := parseSheetSeries(values)
		if err != nil {
			return result, fmt.Errorf("reading series from %q: %w", link.SheetTitle, err)
		}
		for _, series := range layout.series {
			if previous, exists := importLayouts[series.number]; exists && !sameSeriesLayout(previous, series) {
				return result, fmt.Errorf("series %d has different problem columns in linked tabs", series.number)
			}
			importLayouts[series.number] = series
		}
		linked = append(linked, linkedSeries{link: link, values: values, layout: layout})
	}
	if len(linked) == 0 {
		return result, nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return result, fmt.Errorf("beginning series synchronization: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	existing, err := loadSeriesNumbers(ctx, tx, centerID, termID)
	if err != nil {
		return result, err
	}
	numbers := make([]int, 0, len(importLayouts))
	for number := range importLayouts {
		numbers = append(numbers, number)
	}
	sort.Ints(numbers)
	for _, number := range numbers {
		if _, exists := existing[number]; exists {
			continue
		}
		var seriesID int64
		if err := tx.QueryRow(ctx, `INSERT INTO math_center_series
			(math_center_id, term_id, number, name, due_at, tex_source, published_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id`,
			centerID, termID, number, "Серия недоступна", time.Now(), unavailableSeriesTex,
		).Scan(&seriesID); err != nil {
			return result, fmt.Errorf("creating placeholder series %d: %w", number, err)
		}
		if err := createSeriesProblems(ctx, tx, seriesID, importLayouts[number].problems); err != nil {
			return result, fmt.Errorf("creating placeholder series %d problems: %w", number, err)
		}
		existing[number] = seriesID
		result.AddedToMy239++
	}
	if err := tx.Commit(ctx); err != nil {
		return result, fmt.Errorf("committing series synchronization: %w", err)
	}

	localSeries, err := s.localSeriesLayouts(ctx, centerID, termID)
	if err != nil {
		return result, err
	}
	for _, item := range linked {
		sheetNumbers := make(map[int]struct{}, len(item.layout.series))
		for _, series := range item.layout.series {
			sheetNumbers[series.number] = struct{}{}
			result.Matched++
		}
		missing := make([]sheetSeries, 0)
		for _, series := range localSeries {
			if _, exists := sheetNumbers[series.number]; !exists {
				missing = append(missing, series)
			}
		}
		if len(missing) == 0 {
			continue
		}
		startColumn := lastUsedColumn(item.values) + 1
		seriesRow, problemRow := seriesExportRows(missing)
		endColumn := startColumn + len(seriesRow) - 1
		startRow := item.layout.headerRow
		rangeName := columnName(startColumn) + strconv.Itoa(startRow) + ":" +
			columnName(endColumn) + strconv.Itoa(startRow+1)
		if err := s.client.UpdateValues(ctx, item.link.SpreadsheetID, item.link.SheetTitle, rangeName, [][]string{seriesRow, problemRow}); err != nil {
			return result, fmt.Errorf("adding series to %q: %w", item.link.SheetTitle, err)
		}
		result.AddedToSheets += len(missing)
	}
	return result, nil
}

func parseConduitRoster(values [][]string) (conduitRoster, error) {
	headerRow, nameColumn := findConduitHeader(values)
	if headerRow < 1 {
		return conduitRoster{}, errors.New("google sheet conduit header «Фамилия Имя» was not found")
	}
	roster := conduitRoster{
		headerRow: headerRow, nameColumn: nameColumn, lastNameRow: headerRow,
		nameKeys: make(map[string]struct{}),
	}
	if len(values)-1 > roster.lastNameRow {
		// Append below every used row, not merely below the last student name:
		// a conduit may have summary/formula rows with an empty name cell.
		roster.lastNameRow = len(values) - 1
	}
	for rowIndex := headerRow + 1; rowIndex < len(values); rowIndex++ {
		if nameColumn >= len(values[rowIndex]) {
			continue
		}
		name := strings.Join(strings.Fields(values[rowIndex][nameColumn]), " ")
		if name == "" {
			continue
		}
		if normalizeCell(name) == normalizeCell("Идеальный Ученик") {
			continue
		}
		key := normalizePersonName(name)
		if _, duplicate := roster.nameKeys[key]; duplicate {
			continue
		}
		roster.nameKeys[key] = struct{}{}
		roster.names = append(roster.names, name)
	}
	return roster, nil
}

func parseSheetSeries(values [][]string) (sheetLayout, error) {
	headerRow, nameColumn := findConduitHeader(values)
	if headerRow < 1 {
		return sheetLayout{}, errors.New("google sheet conduit header «Фамилия Имя» was not found")
	}
	maxColumn := len(values[headerRow])
	if len(values[headerRow-1]) > maxColumn {
		maxColumn = len(values[headerRow-1])
	}
	layout := sheetLayout{headerRow: headerRow}
	current := -1
	for columnIndex := nameColumn + 1; columnIndex < maxColumn; columnIndex++ {
		if columnIndex < len(values[headerRow-1]) {
			if match := seriesHeader.FindStringSubmatch(strings.TrimSpace(values[headerRow-1][columnIndex])); match != nil {
				number, _ := strconv.Atoi(match[1])
				layout.series = append(layout.series, sheetSeries{number: number})
				current = len(layout.series) - 1
			}
		}
		if current < 0 || columnIndex >= len(values[headerRow]) {
			continue
		}
		number, label, ok := parseProblemHeader(values[headerRow][columnIndex])
		if ok {
			layout.series[current].problems = append(layout.series[current].problems, sheetProblem{number: number, label: label})
		}
	}
	return layout, nil
}

func findConduitHeader(values [][]string) (int, int) {
	for rowIndex, row := range values {
		for columnIndex, value := range row {
			if normalizeCell(value) == "фамилия имя" {
				return rowIndex, columnIndex
			}
		}
	}
	return -1, -1
}

func normalizePersonName(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func splitSheetName(value string) (string, string, *string, error) {
	fields := strings.Fields(value)
	if len(fields) < 2 {
		return "", "", nil, errors.New("student name must contain surname and first name")
	}
	lastName, firstName := fields[0], fields[1]
	if len(fields) == 2 {
		return lastName, firstName, nil, nil
	}
	middleName := strings.Join(fields[2:], " ")
	return lastName, firstName, &middleName, nil
}

func sheetPersonName(user userName) string {
	parts := []string{user.lastName, user.firstName}
	if user.middleName != nil && strings.TrimSpace(*user.middleName) != "" {
		parts = append(parts, strings.TrimSpace(*user.middleName))
	}
	return strings.Join(parts, " ")
}

func loadUsersByName(ctx context.Context, tx pgx.Tx) (map[string][]userName, error) {
	rows, err := tx.Query(ctx, `SELECT id, first_name, middle_name, last_name FROM users`)
	if err != nil {
		return nil, fmt.Errorf("listing users for student synchronization: %w", err)
	}
	defer rows.Close()
	users := make(map[string][]userName)
	for rows.Next() {
		var user userName
		if err := rows.Scan(&user.id, &user.firstName, &user.middleName, &user.lastName); err != nil {
			return nil, fmt.Errorf("scanning user for student synchronization: %w", err)
		}
		key := normalizePersonName(sheetPersonName(user))
		users[key] = append(users[key], user)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating users for student synchronization: %w", err)
	}
	return users, nil
}

func loadEnrollments(ctx context.Context, tx pgx.Tx, termID int64) (map[int64]enrollment, error) {
	rows, err := tx.Query(ctx, `SELECT id, user_id, group_id FROM math_center_students WHERE term_id = $1`, termID)
	if err != nil {
		return nil, fmt.Errorf("listing term students: %w", err)
	}
	defer rows.Close()
	enrollments := make(map[int64]enrollment)
	for rows.Next() {
		var id, userID, groupID int64
		if err := rows.Scan(&id, &userID, &groupID); err != nil {
			return nil, fmt.Errorf("scanning term student: %w", err)
		}
		enrollments[userID] = enrollment{id: id, groupID: groupID}
	}
	return enrollments, rows.Err()
}

func chooseUser(candidates []userName, enrollments map[int64]enrollment) (userName, bool) {
	if len(candidates) == 1 {
		return candidates[0], true
	}
	var enrolled []userName
	for _, candidate := range candidates {
		if _, exists := enrollments[candidate.id]; exists {
			enrolled = append(enrolled, candidate)
		}
	}
	if len(enrolled) == 1 {
		return enrolled[0], true
	}
	return userName{}, false
}

func unavailableAccountPasswordHash() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generating unavailable student password: %w", err)
	}
	hash, err := auth.HashPassword(hex.EncodeToString(bytes))
	if err != nil {
		return "", fmt.Errorf("hashing unavailable student password: %w", err)
	}
	return hash, nil
}

func randomSheetsUsername() (string, error) {
	bytes := make([]byte, 12)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generating sheets student username: %w", err)
	}
	return "sheets-" + hex.EncodeToString(bytes), nil
}

func (s *Service) groupStudentNames(ctx context.Context, termID, groupID int64) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT u.id, u.first_name, u.middle_name, u.last_name
		FROM math_center_students student
		JOIN users u ON u.id = student.user_id
		WHERE student.term_id = $1 AND student.group_id = $2
		ORDER BY u.last_name, u.first_name, u.middle_name`, termID, groupID)
	if err != nil {
		return nil, fmt.Errorf("listing group students for sheet export: %w", err)
	}
	defer rows.Close()
	names := make([]string, 0)
	for rows.Next() {
		var user userName
		if err := rows.Scan(&user.id, &user.firstName, &user.middleName, &user.lastName); err != nil {
			return nil, fmt.Errorf("scanning group student for sheet export: %w", err)
		}
		names = append(names, sheetPersonName(user))
	}
	return names, rows.Err()
}

func sameSeriesLayout(left, right sheetSeries) bool {
	if left.number != right.number || len(left.problems) != len(right.problems) {
		return false
	}
	for index := range left.problems {
		if left.problems[index] != right.problems[index] {
			return false
		}
	}
	return true
}

func loadSeriesNumbers(ctx context.Context, tx pgx.Tx, centerID, termID int64) (map[int]int64, error) {
	rows, err := tx.Query(ctx, `SELECT id, number FROM math_center_series
		WHERE math_center_id = $1 AND term_id = $2`, centerID, termID)
	if err != nil {
		return nil, fmt.Errorf("listing term series: %w", err)
	}
	defer rows.Close()
	series := make(map[int]int64)
	for rows.Next() {
		var id int64
		var number int
		if err := rows.Scan(&id, &number); err != nil {
			return nil, fmt.Errorf("scanning term series: %w", err)
		}
		series[number] = id
	}
	return series, rows.Err()
}

func createSeriesProblems(ctx context.Context, tx pgx.Tx, seriesID int64, columns []sheetProblem) error {
	problemIDs := make(map[int]int64)
	seen := make(map[string]struct{})
	for _, column := range columns {
		key := strconv.Itoa(column.number) + "|" + column.label
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		problemID, exists := problemIDs[column.number]
		if !exists {
			if err := tx.QueryRow(ctx, `INSERT INTO math_center_problems (series_id, number)
				VALUES ($1, $2) RETURNING id`, seriesID, column.number).Scan(&problemID); err != nil {
				return err
			}
			problemIDs[column.number] = problemID
		}
		if _, err := tx.Exec(ctx, `INSERT INTO math_center_subproblems (problem_id, label)
			VALUES ($1, $2)`, problemID, column.label); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) localSeriesLayouts(ctx context.Context, centerID, termID int64) ([]sheetSeries, error) {
	rows, err := s.pool.Query(ctx, `SELECT series.number, COALESCE(problem.number, 0),
			COALESCE(subproblem.label, ''), problem.id IS NOT NULL
		FROM math_center_series series
		LEFT JOIN math_center_problems problem ON problem.series_id = series.id
		LEFT JOIN math_center_subproblems subproblem ON subproblem.problem_id = problem.id
		WHERE series.math_center_id = $1 AND series.term_id = $2
		ORDER BY series.number, problem.number, subproblem.label`, centerID, termID)
	if err != nil {
		return nil, fmt.Errorf("listing my239 series for sheet export: %w", err)
	}
	defer rows.Close()
	byNumber := make(map[int]*sheetSeries)
	order := make([]int, 0)
	for rows.Next() {
		var seriesNumber, problemNumber int
		var label string
		var hasProblem bool
		if err := rows.Scan(&seriesNumber, &problemNumber, &label, &hasProblem); err != nil {
			return nil, fmt.Errorf("scanning my239 series for sheet export: %w", err)
		}
		series, exists := byNumber[seriesNumber]
		if !exists {
			series = &sheetSeries{number: seriesNumber}
			byNumber[seriesNumber] = series
			order = append(order, seriesNumber)
		}
		if hasProblem {
			series.problems = append(series.problems, sheetProblem{number: problemNumber, label: label})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating my239 series for sheet export: %w", err)
	}
	series := make([]sheetSeries, 0, len(order))
	for _, number := range order {
		series = append(series, *byNumber[number])
	}
	return series, nil
}

func lastUsedColumn(values [][]string) int {
	last := 0
	for _, row := range values {
		if len(row)-1 > last {
			last = len(row) - 1
		}
	}
	return last
}

func seriesExportRows(series []sheetSeries) ([]string, []string) {
	seriesRow := make([]string, 0)
	problemRow := make([]string, 0)
	for _, item := range series {
		columns := item.problems
		if len(columns) == 0 {
			columns = []sheetProblem{{}}
		}
		for index, problem := range columns {
			if index == 0 {
				seriesRow = append(seriesRow, "Серия "+strconv.Itoa(item.number))
			} else {
				seriesRow = append(seriesRow, "")
			}
			if problem.number == 0 {
				problemRow = append(problemRow, "")
			} else {
				problemRow = append(problemRow, strconv.Itoa(problem.number)+problem.label)
			}
		}
	}
	return seriesRow, problemRow
}
