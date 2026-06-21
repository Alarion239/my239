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
}

function threadPath(centerId: number, seriesId: number, threadId: number): string {
  return '/mathcenter/' + centerId + '/series/' + seriesId + '/thread/' + threadId
}

function itemLabel(item: QueueItem): string {
  return item.subproblem_label
    ? item.problem_display + ' (' + item.subproblem_label + ')'
    : item.problem_display
}

// New solutions are graded before appeals (an appeal is a re-read request that
// waits behind fresh submissions). Stable sort keeps the backend's within-group
// order (oldest-waiting first).
function solutionsFirst(items: QueueItem[]): QueueItem[] {
  return [...items].sort(
    (a, b) =>
      (a.current_status === 'appealed' ? 1 : 0) -
      (b.current_status === 'appealed' ? 1 : 0),
  )
}

// GraderQueue lists submissions/appeals to grade in a series. The backend
// returns the caller's own active claims plus the unclaimed pool (items another
// grader is actively holding are excluded — they live in the "Таблица" view).
// Anything the caller currently holds ("В работе") is pulled to the top so they
// can resume it; the rest is the scrollable available pool below.
export function GraderQueue({ centerId, seriesId }: GraderQueueProps) {
  const queue = useGraderQueue(seriesId, false)
  const all = queue.data ?? []
  // A live claim in this result is necessarily the caller's own (others are
  // filtered out server-side), so it's "in my work".
  const mine = solutionsFirst(all.filter((i) => claimIsLive(i)))
  const available = solutionsFirst(all.filter((i) => !claimIsLive(i)))
  const appeals = available.filter((i) => i.current_status === 'appealed').length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>
          Доступно к проверке:{' '}
          <span className="font-medium text-status-checking">{available.length}</span>
        </span>
        <span>
          Апелляции:{' '}
          <span className="font-medium text-status-appeal">{appeals}</span>
        </span>
        {mine.length > 0 ? (
          <span>
            В работе у вас:{' '}
            <span className="font-medium text-accent-ink">{mine.length}</span>
          </span>
        ) : null}
      </div>

      {queue.isPending ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : queue.isError || !queue.data ? (
        <p className="py-6 text-sm text-danger">Не удалось загрузить очередь.</p>
      ) : all.length === 0 ? (
        <p className="py-6 text-sm text-muted">Очередь пуста.</p>
      ) : (
        <>
          {mine.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-ink">В работе</h3>
              <ul className="flex flex-col gap-2">
                {mine.map((item) => (
                  <li key={item.thread_id}>
                    <QueueRow centerId={centerId} seriesId={seriesId} item={item} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="flex flex-col gap-2">
            {mine.length > 0 ? (
              <h3 className="text-sm font-medium text-ink">Доступно к проверке</h3>
            ) : null}
            {available.length === 0 ? (
              <p className="py-2 text-sm text-muted">Свободных задач нет.</p>
            ) : (
              <ul className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto pr-1">
                {available.map((item) => (
                  <li key={item.thread_id}>
                    <QueueRow centerId={centerId} seriesId={seriesId} item={item} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
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
