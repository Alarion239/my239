import { Skull } from 'lucide-react'
import {
  useCenterCoffins,
  useMarkCoffin,
  useUnmarkCoffin,
  type SeriesProblemStat,
  type SeriesProblemStats,
} from '@my239/shared'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../design/ui'
import { cn } from '../../design/cn'

// Each segment maps a stat field to its status colour token + Russian label.
interface Segment {
  key: keyof Pick<
    SeriesProblemStat,
    'accepted' | 'submitted' | 'rejected' | 'appealed' | 'unsolved'
  >
  label: string
  bar: string
  dot: string
}

const SEGMENTS: Segment[] = [
  { key: 'accepted', label: 'Принято', bar: 'bg-status-accepted', dot: 'bg-status-accepted' },
  { key: 'submitted', label: 'Проверяется', bar: 'bg-status-checking', dot: 'bg-status-checking' },
  { key: 'rejected', label: 'Отклонено', bar: 'bg-status-rejected', dot: 'bg-status-rejected' },
  { key: 'appealed', label: 'Апелляция', bar: 'bg-status-appeal', dot: 'bg-status-appeal' },
  { key: 'unsolved', label: 'Не решено', bar: 'bg-status-unsolved', dot: 'bg-status-unsolved' },
]

// subStatLabel composes the user-facing name of a stat line: the problem name
// plus the subproblem letter when there is one (1а, 1б); single-subproblem
// problems carry an empty label and read as just "Задача 1".
function subStatLabel(stat: SeriesProblemStat): string {
  return stat.subproblem_label
    ? stat.problem_display + ' (' + stat.subproblem_label + ')'
    : stat.problem_display
}

export interface TeacherProblemStatsProps {
  stats: SeriesProblemStats
  centerId: number
}

// TeacherProblemStats renders the per-subproblem aggregate across all students:
// a horizontal stacked bar plus a numeric breakdown and the student count. Each
// row also carries a coffin badge (operating on its parent problem) so teachers
// can flag a гроб straight from the stats they just read.
export function TeacherProblemStats({ stats, centerId }: TeacherProblemStatsProps) {
  const { data: coffins } = useCenterCoffins(centerId)
  const mark = useMarkCoffin(centerId)
  const unmark = useUnmarkCoffin(centerId)
  const busy = mark.isPending || unmark.isPending
  const coffinProblemIds = new Set((coffins ?? []).map((c) => c.problem_id))

  if (stats.problems.length === 0) {
    return <p className="py-6 text-sm text-muted">В этой серии пока нет задач.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {stats.problems.map((p) => (
        <ProblemStatRow
          key={p.subproblem_id}
          stat={p}
          isCoffin={coffinProblemIds.has(p.problem_id)}
          busy={busy}
          onMark={() => mark.mutate(p.problem_id)}
          onUnmark={() => unmark.mutate(p.problem_id)}
        />
      ))}
    </div>
  )
}

function ProblemStatRow({
  stat,
  isCoffin,
  busy,
  onMark,
  onUnmark,
}: {
  stat: SeriesProblemStat
  isCoffin: boolean
  busy: boolean
  onMark: () => void
  onUnmark: () => void
}) {
  const total =
    stat.accepted + stat.submitted + stat.rejected + stat.appealed + stat.unsolved

  return (
    <div
      className={cn(
        'rounded-xl border bg-surface px-4 py-3',
        isCoffin ? 'border-status-checking' : 'border-line',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-medium text-ink">{subStatLabel(stat)}</span>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted">{total} учеников</span>
          <CoffinBadge
            problemDisplay={stat.problem_display}
            isCoffin={isCoffin}
            busy={busy}
            onMark={onMark}
            onUnmark={onUnmark}
          />
        </div>
      </div>

      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-muted"
        role="img"
        aria-label={'Распределение статусов по задаче ' + subStatLabel(stat)}
      >
        {SEGMENTS.map((seg) => {
          const value = stat[seg.key]
          if (value === 0 || total === 0) return null
          return (
            <span
              key={seg.key}
              className={cn('h-full', seg.bar)}
              style={{ width: (value / total) * 100 + '%' }}
            />
          )
        })}
      </div>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {SEGMENTS.map((seg) => (
          <li key={seg.key} className="flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', seg.dot)} aria-hidden />
            <span>
              {seg.label}: <span className="font-medium text-ink">{stat[seg.key]}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// CoffinBadge is the per-problem гроб toggle living on each stat row. Clicking
// it opens a small confirmation menu (marking re-opens the whole problem for
// submission after the deadline until its разбор is released).
function CoffinBadge({
  problemDisplay,
  isCoffin,
  busy,
  onMark,
  onUnmark,
}: {
  problemDisplay: string
  isCoffin: boolean
  busy: boolean
  onMark: () => void
  onUnmark: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          title={isCoffin ? 'Гроб — нажмите, чтобы снять' : 'Отметить гробом'}
          aria-label={isCoffin ? 'Гроб: снять пометку' : 'Отметить гробом'}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-55',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            isCoffin
              ? 'border-status-checking bg-status-checking-soft text-status-checking'
              : 'border-line-strong bg-surface text-muted hover:text-ink',
          )}
        >
          <Skull className="h-3.5 w-3.5" aria-hidden />
          {isCoffin ? 'Гроб' : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>{problemDisplay}</DropdownMenuLabel>
        {isCoffin ? (
          <>
            <p className="px-2.5 pb-1 text-xs text-muted">
              Задача открыта для сдачи как гроб.
            </p>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={onUnmark}>
              <Skull className="h-4 w-4" aria-hidden />
              Снять пометку гроба
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <p className="px-2.5 pb-1 text-xs text-muted">
              Гроб останется открытым для сдачи после дедлайна, пока вы не
              опубликуете разбор.
            </p>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onMark}>
              <Skull className="h-4 w-4" aria-hidden />
              Отметить гробом
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
