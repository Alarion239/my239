package live

import "sync"

// subBuffer is the per-subscriber channel depth. SSE clients only need a
// "something changed" nudge, so on overflow we drop (coalesce) rather than
// block the publisher — a slow tab must never stall grading.
const subBuffer = 16

// Subscription is one open SSE connection's feed for a single center.
type Subscription struct {
	centerID int64
	C        chan Event
}

// Hub fans Events out to in-process Subscriptions filtered by center id. Safe
// for concurrent Publish/Subscribe/Unsubscribe.
type Hub struct {
	mu   sync.RWMutex
	subs map[int64]map[*Subscription]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: make(map[int64]map[*Subscription]struct{})}
}

func (h *Hub) Subscribe(centerID int64) *Subscription {
	s := &Subscription{centerID: centerID, C: make(chan Event, subBuffer)}
	h.mu.Lock()
	defer h.mu.Unlock()
	m := h.subs[centerID]
	if m == nil {
		m = make(map[*Subscription]struct{})
		h.subs[centerID] = m
	}
	m[s] = struct{}{}
	return s
}

func (h *Hub) Unsubscribe(s *Subscription) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if m := h.subs[s.centerID]; m != nil {
		delete(m, s)
		if len(m) == 0 {
			delete(h.subs, s.centerID)
		}
	}
}

// Publish delivers ev to every subscriber of ev.CenterID. Non-blocking: if a
// subscriber's buffer is full the event is dropped for that subscriber (the
// next event, or its periodic refetch, recovers it).
func (h *Hub) Publish(ev Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for s := range h.subs[ev.CenterID] {
		select {
		case s.C <- ev:
		default:
		}
	}
}

// Close is a no-op placeholder kept for symmetry with future lifecycle needs;
// Subscriptions are owned (and closed) by their SSE handler goroutines.
func (h *Hub) Close() {}
