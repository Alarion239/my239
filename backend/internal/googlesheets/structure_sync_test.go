package googlesheets

import (
	"context"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

var structureLinkColumns = []string{
	"id", "term_id", "group_id", "group_name", "link_kind", "sync_direction",
	"spreadsheet_id", "sheet_id", "sheet_title", "enabled", "last_google_version",
	"last_google_modified_at", "created_at", "updated_at",
}

type structureClient struct {
	values        [][]string
	metadata      Metadata
	metadataCalls int
	updateCalls   int
}

func (client *structureClient) ListTabs(context.Context, string) ([]Tab, error) {
	return nil, nil
}

func (client *structureClient) Metadata(context.Context, string) (Metadata, error) {
	client.metadataCalls++
	return client.metadata, nil
}

func (client *structureClient) Values(context.Context, string, string) ([][]string, error) {
	return client.values, nil
}

func (client *structureClient) UpdateValues(context.Context, string, string, string, [][]string) error {
	client.updateCalls++
	return nil
}

func TestSyncStudentsReaderImportsWithoutWriting(t *testing.T) {
	t.Parallel()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("new pool: %v", err)
	}
	defer mock.Close()
	now := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	groupID := int64(16)
	groupName := "16"
	client := &structureClient{
		values:   [][]string{{"", "Серия 1"}, {"Фамилия Имя", "1"}},
		metadata: Metadata{CanModifyContent: false},
	}
	service := &Service{pool: mock, client: client}

	mock.ExpectQuery(`FROM math_center_google_sheet_links`).
		WithArgs(int64(70), int64(42)).
		WillReturnRows(mock.NewRows(structureLinkColumns).AddRow(
			int64(1), int64(70), &groupID, &groupName, LinkKindConduit, SyncDirectionTwoWay,
			"1Abcdefghijklmnopqrstuvwxyz_0123456789", int64(160), "16", true, "",
			(*time.Time)(nil), now, now,
		))
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id, first_name, middle_name, last_name FROM users`).
		WillReturnRows(mock.NewRows([]string{"id", "first_name", "middle_name", "last_name"}).
			AddRow(int64(8), "Иван", (*string)(nil), "Иванов"))
	mock.ExpectQuery(`SELECT id, user_id, group_id FROM math_center_students`).
		WithArgs(int64(70)).
		WillReturnRows(mock.NewRows([]string{"id", "user_id", "group_id"}).
			AddRow(int64(80), int64(8), groupID))
	mock.ExpectCommit()
	mock.ExpectQuery(`FROM math_center_students student`).
		WithArgs(int64(70), groupID).
		WillReturnRows(mock.NewRows([]string{"id", "first_name", "middle_name", "last_name"}).
			AddRow(int64(8), "Иван", (*string)(nil), "Иванов"))

	result, err := service.SyncStudents(t.Context(), 42, 70)
	if err != nil {
		t.Fatalf("SyncStudents() error = %v", err)
	}
	if !result.ReadOnly || result.AddedToSheets != 0 {
		t.Fatalf("result = %#v, want read-only with no sheet writes", result)
	}
	if client.updateCalls != 0 {
		t.Fatalf("UpdateValues calls = %d, want 0", client.updateCalls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled expectations: %v", err)
	}
}

func TestSyncStudentsTreatsSameNameAcrossGroupsAsOneExistingStudent(t *testing.T) {
	t.Parallel()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("new pool: %v", err)
	}
	defer mock.Close()
	now := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	firstGroupID := int64(16)
	firstGroupName := "16"
	secondGroupID := int64(17)
	secondGroupName := "17"
	client := &structureClient{
		values: [][]string{
			{"", "Серия 1"},
			{"Фамилия Имя", "1"},
			{"Шафиев Даниил"},
		},
		metadata: Metadata{CanModifyContent: false},
	}
	service := &Service{pool: mock, client: client}

	mock.ExpectQuery(`FROM math_center_google_sheet_links`).
		WithArgs(int64(70), int64(42)).
		WillReturnRows(mock.NewRows(structureLinkColumns).
			AddRow(
				int64(1), int64(70), &firstGroupID, &firstGroupName,
				LinkKindConduit, SyncDirectionTwoWay,
				"1Abcdefghijklmnopqrstuvwxyz_0123456789", int64(160), "16",
				true, "", (*time.Time)(nil), now, now,
			).
			AddRow(
				int64(2), int64(70), &secondGroupID, &secondGroupName,
				LinkKindConduit, SyncDirectionTwoWay,
				"1Abcdefghijklmnopqrstuvwxyz_0123456789", int64(170), "17",
				true, "", (*time.Time)(nil), now, now,
			))
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id, first_name, middle_name, last_name FROM users`).
		WillReturnRows(mock.NewRows([]string{"id", "first_name", "middle_name", "last_name"}).
			AddRow(int64(8), "Даниил", (*string)(nil), "Шафиев"))
	mock.ExpectQuery(`SELECT id, user_id, group_id FROM math_center_students`).
		WithArgs(int64(70)).
		WillReturnRows(mock.NewRows([]string{"id", "user_id", "group_id"}).
			AddRow(int64(80), int64(8), secondGroupID))
	mock.ExpectCommit()
	mock.ExpectQuery(`FROM math_center_students student`).
		WithArgs(int64(70), firstGroupID).
		WillReturnRows(mock.NewRows([]string{"id", "first_name", "middle_name", "last_name"}))
	mock.ExpectQuery(`FROM math_center_students student`).
		WithArgs(int64(70), secondGroupID).
		WillReturnRows(mock.NewRows([]string{"id", "first_name", "middle_name", "last_name"}).
			AddRow(int64(8), "Даниил", (*string)(nil), "Шафиев"))

	result, err := service.SyncStudents(t.Context(), 42, 70)
	if err != nil {
		t.Fatalf("SyncStudents() error = %v", err)
	}
	if result.Matched != 1 || result.Moved != 0 || result.AddedToMy239 != 0 {
		t.Fatalf("result = %#v, want one match with the existing group preserved", result)
	}
	if client.updateCalls != 0 {
		t.Fatalf("UpdateValues calls = %d, want 0", client.updateCalls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled expectations: %v", err)
	}
}

func TestSyncSeriesReaderImportsWithoutWriting(t *testing.T) {
	t.Parallel()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("new pool: %v", err)
	}
	defer mock.Close()
	now := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	groupID := int64(16)
	groupName := "16"
	client := &structureClient{
		values: [][]string{
			{"", "Серия 1"},
			{"Фамилия Имя", "1"},
		},
		metadata: Metadata{CanModifyContent: false},
	}
	service := &Service{pool: mock, client: client}

	mock.ExpectQuery(`FROM math_center_google_sheet_links`).
		WithArgs(int64(70), int64(42)).
		WillReturnRows(mock.NewRows(structureLinkColumns).AddRow(
			int64(1), int64(70), &groupID, &groupName, LinkKindConduit, SyncDirectionTwoWay,
			"1Abcdefghijklmnopqrstuvwxyz_0123456789", int64(160), "16", true, "",
			(*time.Time)(nil), now, now,
		))
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id, number FROM math_center_series`).
		WithArgs(int64(42), int64(70)).
		WillReturnRows(mock.NewRows([]string{"id", "number"}).
			AddRow(int64(101), 1).
			AddRow(int64(102), 2))
	mock.ExpectCommit()
	mock.ExpectQuery(`FROM math_center_series series`).
		WithArgs(int64(42), int64(70)).
		WillReturnRows(mock.NewRows([]string{"series_number", "problem_number", "label", "has_problem"}).
			AddRow(1, 1, "", true).
			AddRow(2, 1, "", true))

	result, err := service.SyncSeries(t.Context(), 42, 70)
	if err != nil {
		t.Fatalf("SyncSeries() error = %v", err)
	}
	if !result.ReadOnly || result.AddedToSheets != 0 {
		t.Fatalf("result = %#v, want read-only with no sheet writes", result)
	}
	if client.updateCalls != 0 {
		t.Fatalf("UpdateValues calls = %d, want 0", client.updateCalls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled expectations: %v", err)
	}
}
