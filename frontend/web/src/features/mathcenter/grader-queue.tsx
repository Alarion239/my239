import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import {
  claimIsLive,
  formatDateTime,
  useGraderQueue,
  useGraderStats,
  type QueueItem,
} from '@my239/shared'
import { Spinner } from '../../design/ui'
import { cn } from '../../design/cn'
import { displayPill } from './status-style'

export interface GraderQueueProps {
  centerId: number
  seriesId: number
  mine: boolean
  onMineChange: (mine: boolean) => void
}

function threadPath(centerId: number, seriesId: number, threadId: number): string {
  return '/mathcenter/' + centerId + '/series/' + seriesId + '/thread/' + threadId
}

function itemLabel(item: QueueItem): string {
  return item.subproblem_label
    ? item.problem_display + ' (' + item.subproblem_label + ')'
    : item.problem_display
}

// GraderQueue lists submissions/appeals awaiting grading in a series, with a
// "только мои" filter and at-a-glance workload badges. Each row links to the
// thread.
export function GraderQueue({
  centerId,
  seriesId,
  mine,
  onMineChange,
}: GraderQueueProps) {
  const stats = useGraderStats(centerId)
  const queue = useGraderQueue(seriesId, mine)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {stats.data ? (
          <div className="flex flex-wrap gap-3 text-xs text-muted">
            <span>
              Ожидают:{' '}
              <span className="font-medium text-status-checking">
                {stats.data.pending_count}
              </span>
            </span>
            <span>
              У меня:{' '}
              <span className="font-medium text-accent">
                {stats.data.my_claimed_count}
              </span>
            </span>
            <span>
              Апелляции:{' '}
              <span className="font-medium text-status-appeal">
                {stats.data.my_appeals_count}
              </span>
            </span>
          </div>
        ) : (
          <span />
        )}
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => onMineChange(e.target.checked)}
            className="h-4 w-4 rounded border-line-strong accent-accent"
          />
          Только мои
        </label>
      </div>

      {queue.isPending ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : queue.isError || !queue.data ? (
        <p className="py-6 text-sm text-danger">Не удалось загрузить очередь.</p>
      ) : queue.data.length === 0 ? (
        <p className="py-6 text-sm text-muted">
          {mine ? 'У вас нет задач в работе.' : 'Очередь пуста.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {queue.data.map((item) => (
            <li key={item.thread_id}>
              <QueueRow centerId={centerId} seriesId={seriesId} item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function QueueRow({
  centerId,
  seriesId,
  item,
}: {
  centerId: number
  seriesId: number
  item: QueueItem
}) {
  const locked = claimIsLive(item)
  const { meta, className } = displayPill(item.current_status, locked)
  return (
    <Link
      to={threadPath(centerId, seriesId, item.thread_id)}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-ink">{item.student_name}</div>
        <div className="text-xs text-muted">{itemLabel(item)}</div>
      </div>
      {locked ? (
        <Lock className="h-3.5 w-3.5 text-faint" aria-label="Занято" />
      ) : null}
      <span className="hidden text-xs text-faint sm:inline">
        {formatDateTime(item.updated_at)}
      </span>
      <span
        className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', className)}
      >
        {meta.label}
      </span>
    </Link>
  )
}
