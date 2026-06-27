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
	// KindAcceptedOffline records a solution accepted in person (the
	// «кондуит» workflow). It carries verdict 'accepted', is_offline = true,
	// and has no online submission behind it.
	KindAcceptedOffline = "accepted_offline"
	// KindOfflineRetracted undoes a prior offline accept.
	KindOfflineRetracted = "offline_retracted"
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
	// An offline accept supersedes any non-accepted state, so it's legal from
	// every status except 'accepted' (already accepted → handler returns a
	// 409/no-op). offline_retracted undoes it, so it's legal from 'accepted'.
	legal := map[string]map[string]bool{
		StatusUngraded:  {KindSubmitted: true, KindAcceptedOffline: true},
		StatusSubmitted: {KindClaimed: true, KindReleased: true, KindGraded: true, KindAcceptedOffline: true},
		StatusRejected:  {KindSubmitted: true, KindAppealed: true, KindAcceptedOffline: true},
		StatusAppealed:  {KindClaimed: true, KindReleased: true, KindGraded: true, KindAcceptedOffline: true},
		StatusAccepted:  {KindRetracted: true, KindOfflineRetracted: true},
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
