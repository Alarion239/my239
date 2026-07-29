package googlesheets

import (
	"strings"
	"testing"
)

func TestValidateLinkTarget(t *testing.T) {
	tests := []struct {
		name    string
		kind    LinkKind
		groupID int64
		title   string
		wantErr bool
	}{
		{name: "group conduit", kind: LinkKindConduit, groupID: 4, title: "16"},
		{name: "conduit requires group", kind: LinkKindConduit, title: "16", wantErr: true},
		{name: "legend is outbound only", kind: LinkKindInitialsLegend, title: "Расшифровка"},
		{name: "legend cannot have group", kind: LinkKindInitialsLegend, groupID: 4, title: "Расшифровка", wantErr: true},
		{name: "legend requires expected tab", kind: LinkKindInitialsLegend, title: "16", wantErr: true},
		{name: "salary is excluded", kind: LinkKindConduit, groupID: 4, title: " ЗП ", wantErr: true},
		{name: "invalid kind", kind: "other", groupID: 4, title: "16", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateLinkTarget(test.kind, test.groupID, test.title)
			if (err != nil) != test.wantErr {
				t.Fatalf("validateLinkTarget(%q, %d, %q) error = %v, wantErr %v", test.kind, test.groupID, test.title, err, test.wantErr)
			}
		})
	}
}

func TestDirectionForKind(t *testing.T) {
	if got := directionForKind(LinkKindInitialsLegend); got != SyncDirectionOutboundOnly {
		t.Fatalf("initials legend direction = %q, want %q", got, SyncDirectionOutboundOnly)
	}
	if got := directionForKind(LinkKindConduit); got != SyncDirectionTwoWay {
		t.Fatalf("conduit direction = %q, want %q", got, SyncDirectionTwoWay)
	}
}

func TestParseConduitMarkers(t *testing.T) {
	values := [][]string{
		{"", "", "Серия 1", "", "Серия 2"},
		{"Фамилия Имя", "Решено", "1", "2a", "3"},
		{"Иванов Иван", "", "АБ", "", "ВГ"},
		{"Петров Пётр", "", "", "ДЕ", ""},
	}
	markers, err := parseConduitMarkers(values)
	if err != nil {
		t.Fatalf("parseConduitMarkers() error = %v", err)
	}
	if len(markers) != 3 {
		t.Fatalf("markers = %#v, want 3", markers)
	}
	if got := markers[0]; got.StudentName != "иванов иван" || got.Series != 1 || got.Problem != 1 || got.Cell != "C3" {
		t.Fatalf("first marker = %#v", got)
	}
	if got := markers[1]; got.StudentName != "петров петр" || got.Label != "a" || got.Cell != "D4" {
		t.Fatalf("second marker = %#v", got)
	}
	if got := markers[2]; got.Series != 2 || got.Problem != 3 || got.Initials != "ВГ" {
		t.Fatalf("third marker = %#v", got)
	}
}

func TestParseConduitRoster(t *testing.T) {
	values := [][]string{
		{"", "Серия 1"},
		{"Фамилия Имя", "1"},
		{"Идеальный Ученик", "1"},
		{"  Иванов   Иван  "},
		{},
		{"Петров Пётр"},
	}
	roster, err := parseConduitRoster(values)
	if err != nil {
		t.Fatalf("parseConduitRoster() error = %v", err)
	}
	if roster.headerRow != 1 || roster.nameColumn != 0 || roster.lastNameRow != 5 {
		t.Fatalf("roster coordinates = %#v", roster)
	}
	if len(roster.names) != 2 || roster.names[0] != "Иванов Иван" || roster.names[1] != "Петров Пётр" {
		t.Fatalf("roster names = %#v", roster.names)
	}
	if _, exists := roster.nameKeys[normalizePersonName("Идеальный Ученик")]; exists {
		t.Fatal("ideal student must not be imported")
	}
}

func TestParseSheetSeries(t *testing.T) {
	values := [][]string{
		{"", "", "Серия 11", "", "", "Серия 12"},
		{"Фамилия Имя", "Решено", "1a", "1b", "2", "3"},
	}
	layout, err := parseSheetSeries(values)
	if err != nil {
		t.Fatalf("parseSheetSeries() error = %v", err)
	}
	if layout.headerRow != 1 || len(layout.series) != 2 {
		t.Fatalf("layout = %#v", layout)
	}
	wantFirst := sheetSeries{
		number: 11,
		problems: []sheetProblem{
			{number: 1, label: "a"},
			{number: 1, label: "b"},
			{number: 2, label: ""},
		},
	}
	if !sameSeriesLayout(layout.series[0], wantFirst) {
		t.Fatalf("first series = %#v, want %#v", layout.series[0], wantFirst)
	}
	if got := layout.series[1]; got.number != 12 || len(got.problems) != 1 || got.problems[0].number != 3 {
		t.Fatalf("second series = %#v", got)
	}
}

func TestSeriesExportRows(t *testing.T) {
	seriesRow, problemRow := seriesExportRows([]sheetSeries{
		{number: 3, problems: []sheetProblem{{number: 1}, {number: 2, label: "a"}}},
		{number: 4},
	})
	if got, want := strings.Join(seriesRow, "|"), "Серия 3||Серия 4"; got != want {
		t.Fatalf("series row = %q, want %q", got, want)
	}
	if got, want := strings.Join(problemRow, "|"), "1|2a|"; got != want {
		t.Fatalf("problem row = %q, want %q", got, want)
	}
}

func TestSplitSheetName(t *testing.T) {
	last, first, middle, err := splitSheetName("Иванов Иван Иванович")
	if err != nil {
		t.Fatalf("splitSheetName() error = %v", err)
	}
	if last != "Иванов" || first != "Иван" || middle == nil || *middle != "Иванович" {
		t.Fatalf("split name = %q %q %#v", last, first, middle)
	}
	if _, _, _, err := splitSheetName("Мадонна"); err == nil {
		t.Fatal("one-part name must be rejected")
	}
	if normalizePersonName("Петров Пётр") == normalizePersonName("Петров Петр") {
		t.Fatal("student identity matching must preserve exact spelling")
	}
}
