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

func TestParseConduitMarkersSkipsNonSeriesSections(t *testing.T) {
	values := [][]string{
		{"", "", "Серия 37", "", "КР", "Олимпиада", "Серия 38"},
		{"Фамилия Имя", "Решено", "1", "2", "0", "1", "1"},
		{"Иванов Иван", "", "АБ", "АБ", "АБ", "АБ", "АБ"},
	}
	markers, err := parseConduitMarkers(values)
	if err != nil {
		t.Fatalf("parseConduitMarkers() error = %v", err)
	}
	if len(markers) != 3 {
		t.Fatalf("markers = %#v, want only the three series markers", markers)
	}
	if markers[0].Series != 37 || markers[0].Problem != 1 ||
		markers[1].Series != 37 || markers[1].Problem != 2 ||
		markers[2].Series != 38 || markers[2].Problem != 1 {
		t.Fatalf("markers = %#v, want non-series sections skipped", markers)
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

func TestParseSheetSeriesSkipsNonSeriesSections(t *testing.T) {
	values := [][]string{
		{"", "", "Серия 37", "", "КР", "Олимпиада", "Серия 38"},
		{"Фамилия Имя", "Решено", "1", "2", "0", "1", "1"},
	}
	layout, err := parseSheetSeries(values)
	if err != nil {
		t.Fatalf("parseSheetSeries() error = %v", err)
	}
	if len(layout.series) != 2 {
		t.Fatalf("layout = %#v, want two series", layout)
	}
	if got := layout.series[0]; got.number != 37 || len(got.problems) != 2 ||
		got.problems[0].number != 1 || got.problems[1].number != 2 {
		t.Fatalf("series 37 = %#v, want only its own problem columns", got)
	}
	if got := layout.series[1]; got.number != 38 || len(got.problems) != 1 ||
		got.problems[0].number != 1 {
		t.Fatalf("series 38 = %#v, want its own problem column", got)
	}
}

func TestParseSheetSeriesExerciseColumns(t *testing.T) {
	values := [][]string{
		{"", "Серия 9", "", ""},
		{"Фамилия Имя", "У", "Уa", "0b"},
	}
	layout, err := parseSheetSeries(values)
	if err != nil {
		t.Fatalf("parseSheetSeries() error = %v", err)
	}
	if len(layout.series) != 1 {
		t.Fatalf("layout = %#v, want one series", layout)
	}
	want := []sheetProblem{
		{number: 0},
		{number: 0, label: "a"},
		{number: 0, label: "b"},
	}
	if !sameSeriesLayout(layout.series[0], sheetSeries{number: 9, problems: want}) {
		t.Fatalf("series = %#v, want %#v", layout.series[0], want)
	}
}

func TestParseProblemHeaderExerciseLabels(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  sheetProblem
	}{
		{name: "compact exercise", value: "У", want: sheetProblem{number: 0}},
		{name: "compact subpart", value: "Уa", want: sheetProblem{number: 0, label: "a"}},
		{name: "spaced subpart", value: "У b", want: sheetProblem{number: 0, label: "b"}},
		{name: "full legacy spelling", value: "Упражнение", want: sheetProblem{number: 0}},
		{name: "old abbreviation", value: "Упр а", want: sheetProblem{number: 0, label: "a"}},
		{name: "numeric legacy sentinel", value: "0b", want: sheetProblem{number: 0, label: "b"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			number, label, ok := parseProblemHeader(test.value)
			if !ok || number != test.want.number || label != test.want.label {
				t.Fatalf("parseProblemHeader(%q) = (%d, %q, %t), want (%d, %q, true)", test.value, number, label, ok, test.want.number, test.want.label)
			}
		})
	}
}

func TestMergeSeriesLayoutUnionsDifferentGroupColumns(t *testing.T) {
	merged := mergeSeriesLayout(
		sheetSeries{
			number:   5,
			problems: []sheetProblem{{number: 1}, {number: 2}},
		},
		sheetSeries{
			number: 5,
			problems: []sheetProblem{
				{number: 0},
				{number: 2},
				{number: 2, label: "a"},
			},
		},
	)
	want := sheetSeries{
		number: 5,
		problems: []sheetProblem{
			{number: 0},
			{number: 1},
			{number: 2},
			{number: 2, label: "a"},
		},
	}
	if !sameSeriesLayout(merged, want) {
		t.Fatalf("merged layout = %#v, want %#v", merged, want)
	}
}

func TestSeriesExportRows(t *testing.T) {
	seriesRow, problemRow := seriesExportRows([]sheetSeries{
		{number: 3, problems: []sheetProblem{{number: 0}, {number: 0, label: "a"}, {number: 1}, {number: 2, label: "a"}}},
		{number: 4},
	})
	if got, want := strings.Join(seriesRow, "|"), "Серия 3||||Серия 4"; got != want {
		t.Fatalf("series row = %q, want %q", got, want)
	}
	if got, want := strings.Join(problemRow, "|"), "У|Уa|1|2a|"; got != want {
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
