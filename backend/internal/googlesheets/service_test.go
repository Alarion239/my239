package googlesheets

import "testing"

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
