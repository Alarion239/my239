package live

import (
	"testing"
	"time"
)

func TestHub_DeliversToCenterSubscribersOnly(t *testing.T) {
	h := NewHub()
	defer h.Close()

	a := h.Subscribe(7)
	b := h.Subscribe(9)
	defer h.Unsubscribe(a)
	defer h.Unsubscribe(b)

	h.Publish(Event{CenterID: 7, Kind: KindGrading, SeriesID: 42})

	select {
	case ev := <-a.C:
		if ev.CenterID != 7 || ev.SeriesID != 42 {
			t.Fatalf("got %+v", ev)
		}
	case <-time.After(time.Second):
		t.Fatal("subscriber a got no event")
	}
	select {
	case ev := <-b.C:
		t.Fatalf("subscriber b should not receive center 7 event, got %+v", ev)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestHub_PublishNeverBlocksOnSlowSubscriber(t *testing.T) {
	h := NewHub()
	defer h.Close()
	s := h.Subscribe(7) // buffered chan, we never drain it
	defer h.Unsubscribe(s)
	for i := 0; i < 1000; i++ {
		h.Publish(Event{CenterID: 7, Kind: KindGrading}) // must not deadlock
	}
}
