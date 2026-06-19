import {
  displayStatusMeta,
  homeworkStatusMeta,
  type HomeworkStatus,
  type StatusMeta,
  type StatusTone,
} from '@my239/shared'
import { cn } from '../cn'

// toneClasses maps an abstract status `tone` to its colour-token utility pair.
// One small helper so the tile and the legend stay in sync. The matching
// `status-x` / `status-x-soft` tokens live in design/theme.css.
function toneClasses(tone: StatusTone): string {
  switch (tone) {
    case 'accepted':
      return 'bg-status-accepted-soft text-status-accepted'
    case 'checking':
      return 'bg-status-checking-soft text-status-checking'
    case 'grading':
      return 'bg-status-grading-soft text-status-grading'
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
  // When provided, the tile uses the claim-aware presentation: "В очереди" vs
  // "На проверке". Omit it where claim state is unknown.
  beingGraded?: boolean
  // Optional override for the accessible label; defaults to the status label.
  label?: string
  className?: string
}

function metaFor(status: HomeworkStatus, beingGraded?: boolean): StatusMeta {
  return beingGraded === undefined
    ? homeworkStatusMeta(status)
    : displayStatusMeta(status, beingGraded)
}

// StatusTile is a ~28px rounded square showing a status glyph, tinted with the
// status colour tokens. The Russian label is exposed as title + aria-label.
export function StatusTile({ status, beingGraded, label, className }: StatusTileProps) {
  const meta = metaFor(status, beingGraded)
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

// LEGEND_ITEMS lists the user-facing states in display order, including the
// claim-aware split (queued vs being-graded).
const LEGEND_ITEMS: { status: HomeworkStatus; beingGraded?: boolean }[] = [
  { status: 'accepted' },
  { status: 'submitted', beingGraded: false },
  { status: 'submitted', beingGraded: true },
  { status: 'rejected' },
  { status: 'appealed', beingGraded: false },
  { status: 'ungraded' },
]

// StatusLegend lists the statuses with a swatch + label, for a page footer.
export function StatusLegend({ className }: { className?: string }) {
  return (
    <ul
      className={cn('flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted', className)}
      aria-label="Обозначения статусов"
    >
      {LEGEND_ITEMS.map((item) => {
        const meta = metaFor(item.status, item.beingGraded)
        return (
          <li key={meta.label} className="flex items-center gap-2">
            <StatusTile status={item.status} beingGraded={item.beingGraded} />
            <span>{meta.label}</span>
          </li>
        )
      })}
    </ul>
  )
}
