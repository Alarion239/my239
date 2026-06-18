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
// area. The "current" series is emphasised with an accent border + a badge; the
// selected card gets a ring.
export function SeriesStrip({
  series,
  selectedId,
  currentId,
  onSelect,
  progress,
}: SeriesStripProps) {
  return (
    <div
      className="flex gap-3 overflow-x-auto pb-2"
      role="tablist"
      aria-label="Серии"
    >
      {series.map((s) => {
        const isCurrent = s.id === currentId
        const isSelected = s.id === selectedId
        return (
          <button
            key={s.id}
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
