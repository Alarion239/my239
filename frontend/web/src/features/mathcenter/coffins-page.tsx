import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  claimIsLive,
  formatDateTime,
  useCenterCoffins,
  useCoffinQueue,
  type Coffin,
  type CoffinQueueItem,
} from '@my239/shared'
import { Card, Spinner } from '../../design/ui'
import { cn } from '../../design/cn'
import { useSeriesContext } from './use-series-context'
import { useCenterIdContext, useCenterTermContext } from './center-id-context'
import { displayPill } from './status-style'
import { coffinQueueThreadPath } from './navigation-paths'
import { studentStatusMeta, studentSubproblemIdentifier } from './student-status'
import { StudentStatusTile } from './student-status-tile'
import { appealsLast } from './queue-order'

export function CoffinsPage() {
  const centerId = useCenterIdContext()
  const { termId } = useCenterTermContext()
  const ctx = useSeriesContext(centerId)

  if (!Number.isFinite(centerId) || centerId <= 0 || (!ctx.isLoading && !ctx.hasAccess)) {
    return (
      <Card className="animate-rise px-6 py-16 text-center">
        <p className="text-muted">Нет доступа к этому матцентру.</p>
      </Card>
    )
  }
  if (ctx.isLoading) {
    return <CenteredSpinner />
  }

  return (
    <div className="animate-rise flex flex-col gap-4">
      <CoffinsView centerId={centerId} termId={termId} isManager={!ctx.isStudentView} />
    </div>
  )
}

type Tab = 'current' | 'solved' | 'queue'

function CoffinsView({ centerId, termId, isManager }: { centerId: number; termId: number; isManager: boolean }) {
  const { year, tab: tabParam } = useParams<{ year: string; tab?: string }>()
  const { search } = useLocation()
  const navigate = useNavigate()
  const { data, isPending, isError } = useCenterCoffins(centerId, termId)

  const tabs: { id: Tab; label: string }[] = [
    ...(isManager ? [{ id: 'queue' as Tab, label: 'Очередь' }] : []),
    { id: 'current', label: 'Текущие' },
    { id: 'solved', label: 'Разобранные' },
  ]
  // Validate the URL tab against what this role may see. «Очередь» is
  // manager-only, so a student landing on coffins/queue bounces to current.
  const allowed = tabs.map((t) => t.id)
  const tab = (allowed as string[]).includes(tabParam ?? '')
    ? (tabParam as Tab)
    : null
  if (!tab) {
    return <Navigate to={'/mathcenter/' + year + '/coffins/current' + search} replace />
  }

  if (isPending) return <CenteredSpinner />
  if (isError || !data) {
    return <p className="py-6 text-sm text-danger">Не удалось загрузить гробы.</p>
  }

  const open = data.filter((c) => !c.solution_published_at)
  const solved = data.filter((c) => !!c.solution_published_at)

  return (
    <div className="flex flex-col gap-4">
      <div
        className="inline-flex self-start rounded-full border border-line bg-surface-muted p-0.5"
        role="tablist"
        aria-label="Раздел гробов"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => navigate('/mathcenter/' + year + '/coffins/' + t.id + search)}
            className={cn(
              'rounded-full px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              tab === t.id ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'queue' ? (
        <CoffinQueueList centerId={centerId} />
      ) : (
        <CoffinGroups
          coffins={tab === 'current' ? open : solved}
          isManager={isManager}
          solved={tab === 'solved'}
        />
      )}
    </div>
  )
}

function CoffinGroups({
  coffins,
  isManager,
  solved,
}: {
  coffins: Coffin[]
  isManager: boolean
  solved: boolean
}) {
  if (coffins.length === 0) {
    return (
      <Card className="px-6 py-16 text-center">
        <p className="text-muted">
          {solved ? 'Разобранных гробов пока нет.' : 'Текущих гробов пока нет.'}
        </p>
        {isManager && !solved ? (
          <p className="mt-2 text-sm text-muted">
            Отметить подзадачу гробом можно в разделе «Разбор» серии.
          </p>
        ) : null}
      </Card>
    )
  }
  const groups: { key: number; label: string; coffins: Coffin[] }[] = []
  for (const c of coffins) {
    let g = groups.find((x) => x.key === c.series_id)
    if (!g) {
      g = { key: c.series_id, label: 'Серия ' + c.series_number + ' · ' + c.series_name, coffins: [] }
      groups.push(g)
    }
    g.coffins.push(c)
  }
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-medium text-ink">{g.label}</h2>
          {g.coffins.map((c) => (
            <CoffinCard key={c.subproblem_id} coffin={c} isManager={isManager} solved={solved} />
          ))}
        </section>
      ))}
    </div>
  )
}

function CoffinCard({
  coffin,
  isManager,
  solved,
}: {
  coffin: Coffin
  isManager: boolean
  solved: boolean
}) {
  const legacyAccess = coffin.razbor_access !== false
  const videoAccess = coffin.razbor_video_access ?? legacyAccess
  const pdfTexAccess = coffin.razbor_pdf_tex_access ?? legacyAccess
  const accessLabel =
    videoAccess && pdfTexAccess
      ? null
      : videoAccess
        ? 'Доступно только видео'
        : pdfTexAccess
          ? 'Доступны только PDF и LaTeX'
          : 'Разбор недоступен'
  const { year } = useParams<{ year: string }>()
  const { search } = useLocation()
  const card = (
    <Card className={cn('p-4', isManager && 'cursor-pointer transition-colors hover:bg-surface-muted')}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-[1_1_16rem] flex-wrap items-center gap-x-3 gap-y-1">
          <div className="font-medium text-ink">{coffin.display}</div>
            {isManager ? (
              <span className="text-xs text-muted">
                решили {coffin.accepted_count} из {coffin.total_count}
              </span>
            ) : null}
            {!isManager && solved && accessLabel ? (
              <span className="text-xs text-muted">{accessLabel}</span>
            ) : null}
        </div>

        {!isManager ? (
          <div className="flex min-w-[5rem] flex-[0_1_8rem]">
            <SubTile coffin={coffin} solved={solved} />
          </div>
        ) : null}

      </div>
    </Card>
  )
  if (!isManager) return card
  return (
    <Link
      to={'/mathcenter/' + year + '/series/' + coffin.series_id + '/razbor' + search}
      aria-label={coffin.display + ' — открыть разбор'}
      className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {card}
    </Link>
  )
}

function SubTile({ coffin, solved }: { coffin: Coffin; solved: boolean }) {
  const { year } = useParams<{ year: string }>()
  const { search } = useLocation()
  const status = coffin.current_status ?? 'ungraded'
  const threadId = coffin.thread_id ?? 0
  const meta = studentStatusMeta(status)
  const identifier = studentSubproblemIdentifier(
    coffin.subproblem_label,
    coffin.problem_number,
  )
  const base = '/mathcenter/' + year + '/series/' + coffin.series_id
  const to =
    threadId > 0
      ? base + '/thread/' + threadId
      : base + '/submit/' + coffin.subproblem_id
  const tile = (
    <StudentStatusTile status={status} identifier={identifier} />
  )
  const interactive = threadId > 0 || !solved
  return interactive ? (
    <Link
      to={to + search}
      aria-label={identifier + ': ' + meta.label}
      className="flex min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {tile}
    </Link>
  ) : (
    <span title={identifier + ': ' + meta.label} className="flex min-w-0 flex-1">
      {tile}
    </span>
  )
}

function CoffinQueueList({ centerId }: { centerId: number }) {
  const { data, isPending, isError } = useCoffinQueue(centerId)
  if (isPending) return <CenteredSpinner />
  if (isError || !data) {
    return <p className="py-6 text-sm text-danger">Не удалось загрузить очередь.</p>
  }
  if (data.length === 0) {
    return (
      <Card className="px-6 py-16 text-center">
        <p className="text-muted">Очередь гробов пуста.</p>
      </Card>
    )
  }
  const ordered = appealsLast(data)
  return (
    <ul className="flex flex-col gap-2">
      {ordered.map((item) => (
        <li key={item.thread_id}>
          <CoffinQueueRow item={item} />
        </li>
      ))}
    </ul>
  )
}

function CoffinQueueRow({ item }: { item: CoffinQueueItem }) {
  const { year } = useParams<{ year: string }>()
  const { search } = useLocation()
  const locked = claimIsLive(item)
  const { meta, className } = displayPill(item.current_status, locked)
  const label = item.subproblem_label
    ? item.problem_display + ' (' + item.subproblem_label + ')'
    : item.problem_display
  return (
    <Link
      to={coffinQueueThreadPath(year ?? '', item.series_id, item.thread_id, search)}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-ink">{item.student_name}</div>
        <div className="text-xs text-muted">{label}</div>
      </div>
      <span className="hidden text-xs text-faint sm:inline">
        {formatDateTime(item.updated_at)}
      </span>
      <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', className)}>
        {meta.label}
      </span>
    </Link>
  )
}

function CenteredSpinner() {
  return (
    <div className="flex justify-center py-16">
      <Spinner />
    </div>
  )
}
