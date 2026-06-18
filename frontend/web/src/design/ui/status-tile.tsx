import { homeworkStatusMeta, type HomeworkStatus, type StatusTone } from '@my239/shared'
import { cn } from '../cn'

// The five homework statuses, in display order, used by the legend.
const LEGEND_STATUSES: HomeworkStatus[] = [
  'accepted',
  'submitted',
  'rejected',
  'appealed',
  'ungraded',
]

// toneClasses maps an abstract status `tone` to its colour-token utility pair.
// One small helper so the tile and the legend stay in sync. The matching
// `status-x` / `status-x-soft` tokens live in design/theme.css.
function toneClasses(tone: StatusTone): string {
  switch (tone) {
    case 'accepted':
      return 'bg-status-accepted-soft text-status-accepted'
    case 'checking':
      return 'bg-status-checking-soft text-status-checking'
    case 'rejected':
      return 'bg-status-rejected-soft text-status-rejected'
    case 'appeal':
      return 'bg-status-appeal-soft text-status-appeal'
    case 'unsolved':
      return 'bg-status-unsolved-soft text-status-unsolved'
  }
}

export interface StatusTileProps {
  status: HomeworkStatus
  // Optional override for the accessible label; defaults to the Russian label.
  label?: string
  className?: string
}

// StatusTile is a ~28px rounded square showing a status glyph, tinted with the
// status colour tokens. The Russian label is exposed as title + aria-label.
export function StatusTile({ status, label, className }: StatusTileProps) {
  const meta = homeworkStatusMeta(status)
  const text = label ?? meta.label
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-medium leading-none select-none',
        toneClasses(meta.tone),
        className,
      )}
    >
      <span aria-hidden>{meta.glyph}</span>
    </span>
  )
}

// StatusLegend lists the five statuses with a swatch + label, for a page footer.
export function StatusLegend({ className }: { className?: string }) {
  return (
    <ul
      className={cn('flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted', className)}
      aria-label="Обозначения статусов"
    >
      {LEGEND_STATUSES.map((status) => {
        const meta = homeworkStatusMeta(status)
        return (
          <li key={status} className="flex items-center gap-2">
            <StatusTile status={status} />
            <span>{meta.label}</span>
          </li>
        )
      })}
    </ul>
  )
}
