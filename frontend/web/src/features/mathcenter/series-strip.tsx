import { useEffect, useMemo, useRef } from 'react'
import { formatDateTime, type Series } from '@my239/shared'
import { Badge } from '../../design/ui'
import { cn } from '../../design/cn'

export interface SeriesStripProps {
  series: Series[]
  selectedId: number | null
  currentId: number | null
  onSelect: (id: number) => void
  // Optional per-series progress hint (e.g. "3/5") shown on the card, for the
  // student view where the rollup is cheap to summarise.
  progress?: Record<number, string>
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
    // px/py padding keeps the selected card's 2px ring from being clipped by the
    // scroll container (overflow-x:auto also clips the cross axis).
    <div
      ref={scrollerRef}
      className="flex gap-3 overflow-x-auto px-1 py-2"
      role="tablist"
      aria-label="Серии"
    >
      {ordered.map((s) => {
        const isCurrent = s.id === currentId
        const isSelected = s.id === selectedId
        return (
          <button
            key={s.id}
            ref={s.id === centerId ? centerRef : undefined}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onSelect(s.id)}
            className={cn(
              'flex w-56 shrink-0 flex-col gap-1 rounded-2xl border bg-surface p-4 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              isCurrent ? 'border-accent' : 'border-line hover:bg-surface-muted',
              isSelected && 'ring-2 ring-accent/60',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-lg font-medium text-ink">
                Серия {s.number}
              </span>
              {isCurrent ? <Badge variant="accent">Текущая</Badge> : null}
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
        )
      })}
    </div>
  )
}
