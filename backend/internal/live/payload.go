// Package live carries lightweight "center X changed" signals to connected
// clients over SSE. Mutation handlers Publish a coarse Event after their
// transaction commits; a single per-instance listener fans NOTIFYs from
// Postgres into an in-process hub, which pushes them to each open SSE stream.
// Clients use the event's kind to invalidate the matching React Query keys and
// refetch through the normal GET endpoints — no domain data is streamed here.
package live

// Channel is the single Postgres LISTEN/NOTIFY channel all instances share.
const Channel = "mc_live"

// Kind enumerates the coarse change classes a center can emit.
type Kind string

const (
	KindGrading    Kind = "grading"    // submit/claim/grade/retract/release/appeal
	KindCoffins    Kind = "coffins"    // mark/unmark/release/solution
	KindMembership Kind = "membership" // groups/teachers/students changes
)

// Event is the JSON payload carried by pg_notify and pushed to SSE clients.
// SeriesID is 0 for non-series kinds (coffins/membership are center-wide).
type Event struct {
	CenterID int64 `json:"center_id"`
	Kind     Kind  `json:"kind"`
	SeriesID int64 `json:"series_id,omitempty"`
}
