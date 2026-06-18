package tokenpreset_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/internal/tokenpreset"
)

// mockStore is a hand-written tokenpreset.Store. Each field is the canned
// result (or error) for the matching method; *Calls counters let tests assert
// what Apply/Validate invoked and in what shape. It deliberately implements the
// interface without a real DB so unit tests stay fast and deterministic.
type mockStore struct {
	groups     map[int64]store.MathCenterGroup
	groupErr   error
	centers    map[int64]store.MathCenter
	centerErr  error
	isTeacher  bool
	isStudent  bool
	membersErr error

	setAdminCalls  []store.SetUserAdminParams
	addStudentCall []store.AddStudentToGroupParams
	addTeacherCall []store.AddTeacherToCenterParams
}

func (m *mockStore) GetGroup(_ context.Context, id int64) (store.MathCenterGroup, error) {
	if m.groupErr != nil {
		return store.MathCenterGroup{}, m.groupErr
	}
	g, ok := m.groups[id]
	if !ok {
		return store.MathCenterGroup{}, pgx.ErrNoRows
	}
	return g, nil
}

func (m *mockStore) GetMathCenter(_ context.Context, id int64) (store.MathCenter, error) {
	if m.centerErr != nil {
		return store.MathCenter{}, m.centerErr
	}
	c, ok := m.centers[id]
	if !ok {
		return store.MathCenter{}, pgx.ErrNoRows
	}
	return c, nil
}

func (m *mockStore) IsTeacherInCenter(_ context.Context, _ store.IsTeacherInCenterParams) (bool, error) {
	return m.isTeacher, m.membersErr
}

func (m *mockStore) IsStudentInCenter(_ context.Context, _ store.IsStudentInCenterParams) (bool, error) {
	return m.isStudent, m.membersErr
}

func (m *mockStore) SetUserAdmin(_ context.Context, arg store.SetUserAdminParams) error {
	m.setAdminCalls = append(m.setAdminCalls, arg)
	return nil
}

func (m *mockStore) AddStudentToGroup(_ context.Context, arg store.AddStudentToGroupParams) (store.MathCenterStudent, error) {
	m.addStudentCall = append(m.addStudentCall, arg)
	return store.MathCenterStudent{ID: 1, UserID: arg.UserID, GroupID: arg.GroupID}, nil
}

func (m *mockStore) AddTeacherToCenter(_ context.Context, arg store.AddTeacherToCenterParams) (store.MathCenterTeacher, error) {
	m.addTeacherCall = append(m.addTeacherCall, arg)
	return store.MathCenterTeacher{ID: 1, UserID: arg.UserID, MathCenterID: arg.MathCenterID, IsHeadTeacher: arg.IsHeadTeacher}, nil
}

// compile-time check that the hand mock satisfies the interface.
var _ tokenpreset.Store = (*mockStore)(nil)

func TestParse(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		raw         json.RawMessage
		wantVersion int
		wantAdmin   bool
		wantErr     error
	}{
		{name: "nil is empty preset", raw: nil, wantVersion: tokenpreset.CurrentVersion},
		{name: "empty bytes is empty preset", raw: json.RawMessage(``), wantVersion: tokenpreset.CurrentVersion},
		{name: "empty object is empty preset", raw: json.RawMessage(`{}`), wantVersion: tokenpreset.CurrentVersion},
		{
			name:        "legacy version 0 normalized",
			raw:         json.RawMessage(`{"grants_admin":true}`),
			wantVersion: tokenpreset.CurrentVersion,
			wantAdmin:   true,
		},
		{
			name:        "current version accepted",
			raw:         json.RawMessage(`{"version":1,"grants_admin":true}`),
			wantVersion: tokenpreset.CurrentVersion,
			wantAdmin:   true,
		},
		{
			name:    "future version rejected",
			raw:     json.RawMessage(`{"version":2}`),
			wantErr: tokenpreset.ErrUnsupportedVersion,
		},
		{
			name:    "malformed json rejected",
			raw:     json.RawMessage(`{not json`),
			wantErr: tokenpreset.ErrInvalidPreset,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := tokenpreset.Parse(tt.raw)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("error: got %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.Version != tt.wantVersion {
				t.Errorf("version: got %d, want %d", got.Version, tt.wantVersion)
			}
			if got.GrantsAdmin != tt.wantAdmin {
				t.Errorf("grants_admin: got %v, want %v", got.GrantsAdmin, tt.wantAdmin)
			}
		})
	}
}

func TestMarshalRoundTrip(t *testing.T) {
	t.Parallel()
	in := tokenpreset.Preset{
		GrantsAdmin:       true,
		MathCenterTeacher: &tokenpreset.MathCenterTeacher{CenterID: 5, IsHeadTeacher: true},
	}
	raw, err := tokenpreset.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	out, err := tokenpreset.Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if out.Version != tokenpreset.CurrentVersion {
		t.Errorf("version not stamped: got %d", out.Version)
	}
	if !out.GrantsAdmin || out.MathCenterTeacher == nil || out.MathCenterTeacher.CenterID != 5 || !out.MathCenterTeacher.IsHeadTeacher {
		t.Errorf("round trip lost data: %+v", out)
	}
}

func TestValidate(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		store   *mockStore
		preset  tokenpreset.Preset
		wantErr error
	}{
		{
			name:   "empty preset ok",
			store:  &mockStore{},
			preset: tokenpreset.Preset{},
		},
		{
			name:   "valid student group",
			store:  &mockStore{groups: map[int64]store.MathCenterGroup{3: {ID: 3, MathCenterID: 7}}},
			preset: tokenpreset.Preset{MathCenterStudent: &tokenpreset.MathCenterStudent{GroupID: 3}},
		},
		{
			name:    "unknown student group rejected",
			store:   &mockStore{groups: map[int64]store.MathCenterGroup{}},
			preset:  tokenpreset.Preset{MathCenterStudent: &tokenpreset.MathCenterStudent{GroupID: 99}},
			wantErr: tokenpreset.ErrInvalidPreset,
		},
		{
			name:   "valid teacher center",
			store:  &mockStore{centers: map[int64]store.MathCenter{7: {ID: 7}}},
			preset: tokenpreset.Preset{MathCenterTeacher: &tokenpreset.MathCenterTeacher{CenterID: 7}},
		},
		{
			name:    "unknown teacher center rejected",
			store:   &mockStore{centers: map[int64]store.MathCenter{}},
			preset:  tokenpreset.Preset{MathCenterTeacher: &tokenpreset.MathCenterTeacher{CenterID: 99}},
			wantErr: tokenpreset.ErrInvalidPreset,
		},
		{
			name: "student and teacher of same center rejected",
			store: &mockStore{
				groups:  map[int64]store.MathCenterGroup{3: {ID: 3, MathCenterID: 7}},
				centers: map[int64]store.MathCenter{7: {ID: 7}},
			},
			preset: tokenpreset.Preset{
				MathCenterStudent: &tokenpreset.MathCenterStudent{GroupID: 3},
				MathCenterTeacher: &tokenpreset.MathCenterTeacher{CenterID: 7},
			},
			wantErr: tokenpreset.ErrInvalidPreset,
		},
		{
			name: "student and teacher of different centers ok",
			store: &mockStore{
				groups:  map[int64]store.MathCenterGroup{3: {ID: 3, MathCenterID: 7}},
				centers: map[int64]store.MathCenter{8: {ID: 8}},
			},
			preset: tokenpreset.Preset{
				MathCenterStudent: &tokenpreset.MathCenterStudent{GroupID: 3},
				MathCenterTeacher: &tokenpreset.MathCenterTeacher{CenterID: 8},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := tokenpreset.Validate(context.Background(), tt.store, tt.preset)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("error: got %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestApply_GrantsAdmin(t *testing.T) {
	t.Parallel()
	ms := &mockStore{}
	err := tokenpreset.Apply(context.Background(), ms, 42, tokenpreset.Preset{GrantsAdmin: true})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if len(ms.setAdminCalls) != 1 || ms.setAdminCalls[0].ID != 42 || !ms.setAdminCalls[0].IsAdmin {
		t.Errorf("SetUserAdmin not called correctly: %+v", ms.setAdminCalls)
	}
}

func TestApply_EnrollsStudent(t *testing.T) {
	t.Parallel()
	ms := &mockStore{groups: map[int64]store.MathCenterGroup{3: {ID: 3, MathCenterID: 7}}}
	err := tokenpreset.Apply(context.Background(), ms, 42, tokenpreset.Preset{
		MathCenterStudent: &tokenpreset.MathCenterStudent{GroupID: 3},
	})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if len(ms.addStudentCall) != 1 || ms.addStudentCall[0].UserID != 42 || ms.addStudentCall[0].GroupID != 3 {
		t.Errorf("AddStudentToGroup not called correctly: %+v", ms.addStudentCall)
	}
}

func TestApply_StudentBlockedWhenTeacher(t *testing.T) {
	t.Parallel()
	ms := &mockStore{
		groups:    map[int64]store.MathCenterGroup{3: {ID: 3, MathCenterID: 7}},
		isTeacher: true,
	}
	err := tokenpreset.Apply(context.Background(), ms, 42, tokenpreset.Preset{
		MathCenterStudent: &tokenpreset.MathCenterStudent{GroupID: 3},
	})
	if !errors.Is(err, tokenpreset.ErrConflict) {
		t.Fatalf("error: got %v, want ErrConflict", err)
	}
	if len(ms.addStudentCall) != 0 {
		t.Errorf("AddStudentToGroup must not be called on conflict: %+v", ms.addStudentCall)
	}
}

func TestApply_EnrollsTeacher(t *testing.T) {
	t.Parallel()
	ms := &mockStore{centers: map[int64]store.MathCenter{7: {ID: 7}}}
	err := tokenpreset.Apply(context.Background(), ms, 42, tokenpreset.Preset{
		MathCenterTeacher: &tokenpreset.MathCenterTeacher{CenterID: 7, IsHeadTeacher: true},
	})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if len(ms.addTeacherCall) != 1 || ms.addTeacherCall[0].UserID != 42 ||
		ms.addTeacherCall[0].MathCenterID != 7 || !ms.addTeacherCall[0].IsHeadTeacher {
		t.Errorf("AddTeacherToCenter not called correctly: %+v", ms.addTeacherCall)
	}
}

func TestApply_TeacherBlockedWhenStudent(t *testing.T) {
	t.Parallel()
	ms := &mockStore{
		centers:   map[int64]store.MathCenter{7: {ID: 7}},
		isStudent: true,
	}
	err := tokenpreset.Apply(context.Background(), ms, 42, tokenpreset.Preset{
		MathCenterTeacher: &tokenpreset.MathCenterTeacher{CenterID: 7},
	})
	if !errors.Is(err, tokenpreset.ErrConflict) {
		t.Fatalf("error: got %v, want ErrConflict", err)
	}
	if len(ms.addTeacherCall) != 0 {
		t.Errorf("AddTeacherToCenter must not be called on conflict: %+v", ms.addTeacherCall)
	}
}

func TestApply_MissingGroupAtRegistration(t *testing.T) {
	t.Parallel()
	ms := &mockStore{groups: map[int64]store.MathCenterGroup{}}
	err := tokenpreset.Apply(context.Background(), ms, 42, tokenpreset.Preset{
		MathCenterStudent: &tokenpreset.MathCenterStudent{GroupID: 3},
	})
	if !errors.Is(err, tokenpreset.ErrInvalidPreset) {
		t.Fatalf("error: got %v, want ErrInvalidPreset", err)
	}
}
