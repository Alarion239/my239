import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import {
  claimIsLive,
  formatDateTime,
  useGraderQueue,
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

// GraderQueue lists submissions/appeals AVAILABLE to grade in a series (the
// backend excludes items another grader is actively holding). Counts are
// derived from this series' list so they always match the rows shown — no
// center-wide vs series-scoped mismatch. Items being graded by someone else
// live in the "Таблица" view, not here.
export function GraderQueue({
  centerId,
  seriesId,
  mine,
  onMineChange,
}: GraderQueueProps) {
  const queue = useGraderQueue(seriesId, mine)
  // New solutions are graded before appeals: appeals are a re-read request and
  // wait behind fresh submissions. Stable sort keeps the backend's within-group
  // ordering (oldest-waiting first).
  const items = [...(queue.data ?? [])].sort(
    (a, b) =>
      (a.current_status === 'appealed' ? 1 : 0) -
      (b.current_status === 'appealed' ? 1 : 0),
  )
  const appeals = items.filter((i) => i.current_status === 'appealed').length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          <span>
            Доступно к проверке:{' '}
            <span className="font-medium text-status-checking">{items.length}</span>
          </span>
          <span>
            Апелляции:{' '}
            <span className="font-medium text-status-appeal">{appeals}</span>
          </span>
        </div>
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
      ) : items.length === 0 ? (
        <p className="py-6 text-sm text-muted">
          {mine ? 'У вас нет задач в работе.' : 'Очередь пуста.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
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
