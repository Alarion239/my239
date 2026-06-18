import type { SeriesProblemStat, SeriesProblemStats } from '@my239/shared'
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

export interface TeacherProblemStatsProps {
  stats: SeriesProblemStats
}

// TeacherProblemStats renders the per-problem aggregate across all students:
// a horizontal stacked bar plus a numeric breakdown and the student count.
export function TeacherProblemStats({ stats }: TeacherProblemStatsProps) {
  if (stats.problems.length === 0) {
    return <p className="py-6 text-sm text-muted">В этой серии пока нет задач.</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {stats.problems.map((p) => (
        <ProblemStatRow key={p.problem_id} stat={p} />
      ))}
    </div>
  )
}

function ProblemStatRow({ stat }: { stat: SeriesProblemStat }) {
  const total =
    stat.accepted + stat.submitted + stat.rejected + stat.appealed + stat.unsolved

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-medium text-ink">{stat.problem_display}</span>
        <span className="text-xs text-muted">{total} учеников</span>
      </div>

      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-muted"
        role="img"
        aria-label={'Распределение статусов по задаче ' + stat.problem_display}
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
