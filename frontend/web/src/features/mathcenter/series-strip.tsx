import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { formatDateTime, useGraderQueue, type Series } from '@my239/shared'
import { Badge, NotificationBadge } from '../../design/ui'
import { cn } from '../../design/cn'

export interface SeriesStripProps {
  series: Series[]
  selectedId: number | null
  currentId: number | null
  onSelect: (id: number) => void
  // Optional per-series progress hint (e.g. "3/5") shown on the card, for the
  // student view where the rollup is cheap to summarise.
  progress?: Record<number, string>
  // Optional card rendered at the END of the strip (the teacher "+ create"
  // card). Stretches to the row height like the series cards.
  trailing?: ReactNode
  // Teacher-only queue counts for every series card, including the selected one.
  showQueueNotifications?: boolean
  selectedActionsOpen?: boolean
  selectedActions?: ReactNode
}

// SeriesStrip is the horizontal, scrollable row of series cards above the detail
// area, ordered by due date (earliest left → latest right). The "current"
// series (closest upcoming deadline) is emphasised, and the strip auto-scrolls
// to centre it on load — so with many series you land on the current one and
// swipe left to reach earlier ones.
export function SeriesStrip({
  series,
  selectedId,
  currentId,
  onSelect,
  progress,
  trailing,
  showQueueNotifications = false,
  selectedActionsOpen = false,
  selectedActions,
}: SeriesStripProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const centerRef = useRef<HTMLButtonElement | null>(null)

  // Chronological order by due date; ties fall back to series number.
  const ordered = useMemo(
    () =>
      [...series].sort((a, b) => {
        const da = Date.parse(a.due_at)
        const db = Date.parse(b.due_at)
        if (da !== db && !Number.isNaN(da) && !Number.isNaN(db)) return da - db
        return a.number - b.number
      }),
    [series],
  )

  // The card to centre on: the current series, else the selected one.
  const centerId = currentId ?? selectedId

  // Centre that card on load (and whenever the target changes). Computed from
  // bounding rects so it's robust to the scroller's offsetParent.
  useEffect(() => {
    const scroller = scrollerRef.current
    const el = centerRef.current
    if (!scroller || !el) return
    const elRect = el.getBoundingClientRect()
    const scRect = scroller.getBoundingClientRect()
    const delta =
      elRect.left - scRect.left - (scroller.clientWidth - el.clientWidth) / 2
    scroller.scrollLeft = Math.max(0, scroller.scrollLeft + delta)
  }, [centerId, ordered.length])

  return (
    // Horizontal scroll only: overflow-y is pinned to hidden (otherwise the
    // browser computes it to `auto` when overflow-x is `auto`, which let the
    // strip be dragged a few px vertically). The scrollbar is hidden in all
    // engines — scrolling still works via wheel/trackpad/drag. px/py padding
    // keeps the selected card's 2px ring from being clipped.
    <div
      ref={scrollerRef}
      className="flex gap-3 overflow-x-auto overflow-y-hidden px-1 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label="Серии"
    >
      {ordered.map((s) => {
        const isCurrent = s.id === currentId
        const isSelected = s.id === selectedId
        return (
          <div key={s.id} className="relative w-56 shrink-0">
            <button
              ref={s.id === centerId ? centerRef : undefined}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => onSelect(s.id)}
              className={cn(
                'flex w-full flex-col gap-1 rounded-2xl border bg-surface p-4 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                isCurrent ? 'border-accent' : 'border-line hover:bg-surface-muted',
                isSelected && 'ring-2 ring-accent/60',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-lg font-medium text-ink">
                  Серия {s.number}
                </span>
                <div className="flex items-center gap-1.5">
                  {showQueueNotifications ? (
                    <SeriesQueueBadge seriesId={s.id} />
                  ) : null}
                  {isCurrent ? <Badge variant="accent">Текущая</Badge> : null}
                </div>
              </div>
              <span className="line-clamp-2 text-sm text-muted">{s.name}</span>
              <span className="mt-1 text-xs text-faint">
                Срок: {formatDateTime(s.due_at)}
              </span>
              {progress?.[s.id] ? (
                <span className="text-xs font-medium text-accent-ink">
                  {progress[s.id]}
                </span>
              ) : null}
            </button>
            {isSelected && selectedActionsOpen && selectedActions ? (
              <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-line bg-surface/95 p-1 shadow-lg backdrop-blur-sm">
                {selectedActions}
              </div>
            ) : null}
          </div>
        )
      })}
      {trailing}
    </div>
  )
}

function SeriesQueueBadge({ seriesId }: { seriesId: number }) {
  const queue = useGraderQueue(seriesId, false)
  return <NotificationBadge count={queue.data?.length ?? 0} label="Очередь серии" />
}
