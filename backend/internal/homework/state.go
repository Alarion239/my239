package homework

import "fmt"

// Thread statuses persisted in homework_thread.current_status. Kept as
// constants so handler code branches on a named value instead of magic
// strings.
const (
	StatusUngraded  = "ungraded"
	StatusSubmitted = "submitted"
	StatusAccepted  = "accepted"
	StatusRejected  = "rejected"
	StatusAppealed  = "appealed"
)

// Event kinds persisted in homework_thread_event.kind.
const (
	KindSubmitted = "submitted"
	KindClaimed   = "claimed"
	KindReleased  = "released"
	KindGraded    = "graded"
	KindRetracted = "retracted"
	KindAppealed  = "appealed"
)

// Verdict values stored on graded events.
const (
	VerdictAccepted = "accepted"
	VerdictRejected = "rejected"
)

// CanTransition reports whether `kind` is a legal event to append given the
// thread's current_status. Handlers do their own status-specific 409
// branching for clarity; this is a final belt-and-suspenders check inside
// the same tx that appends the event, so a malformed sequence cannot land
// in the log.
func CanTransition(currentStatus, kind string) error {
	legal := map[string]map[string]bool{
		StatusUngraded:  {KindSubmitted: true},
		StatusSubmitted: {KindClaimed: true, KindReleased: true, KindGraded: true},
		StatusRejected:  {KindSubmitted: true, KindAppealed: true},
		StatusAppealed:  {KindClaimed: true, KindReleased: true, KindGraded: true},
		StatusAccepted:  {KindRetracted: true},
	}
	// Retract is also legal from rejected (a grader can change their mind
	// either way). Add it here rather than duplicate the map entry above.
	if currentStatus == StatusRejected && kind == KindRetracted {
		return nil
	}
	if _, ok := legal[currentStatus][kind]; !ok {
		return fmt.Errorf("homework: illegal transition: kind=%s on status=%s", kind, currentStatus)
	}
	return nil
}
