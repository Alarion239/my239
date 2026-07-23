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
