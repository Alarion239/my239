import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  claimIsLive,
  coffinOpen,
  displayStatusMeta,
  formatDateTime,
  usePutSubproblemSolutionTex,
  useReleaseCoffin,
  useSetSubproblemSolutionLink,
  useSubproblemSolutionTex,
  useCenterCoffins,
  useCoffinQueue,
  useUploadSubproblemSolutionPdf,
  type Coffin,
  type CoffinQueueItem,
} from '@my239/shared'
import { Button, Card, Spinner, StatusTile } from '../../design/ui'
import { cn } from '../../design/cn'
import { useSeriesContext } from './use-series-context'
import { useCenterIdContext } from './center-id-context'
import { SolutionContent } from './solution-content'
import { SolutionEditor } from './solution-editor'
import { displayPill } from './status-style'

export function CoffinsPage() {
  const centerId = useCenterIdContext()
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
      <CoffinsView centerId={centerId} isManager={!ctx.isStudentView} />
    </div>
  )
}

type Tab = 'current' | 'solved' | 'queue'

function CoffinsView({ centerId, isManager }: { centerId: number; isManager: boolean }) {
  const { year, tab: tabParam } = useParams<{ year: string; tab?: string }>()
  const navigate = useNavigate()
  const { data, isPending, isError } = useCenterCoffins(centerId)

  const tabs: { id: Tab; label: string }[] = [
    { id: 'current', label: 'Текущие' },
    { id: 'solved', label: 'Разобранные' },
    ...(isManager ? [{ id: 'queue' as Tab, label: 'Очередь' }] : []),
  ]
  // Validate the URL tab against what this role may see. «Очередь» is
  // manager-only, so a student landing on coffins/queue bounces to current.
  const allowed = tabs.map((t) => t.id)
  const tab = (allowed as string[]).includes(tabParam ?? '')
    ? (tabParam as Tab)
    : null
  if (!tab) {
    return <Navigate to={'/mathcenter/' + year + '/coffins/current'} replace />
  }

  if (isPending) return <CenteredSpinner />
  if (isError || !data) {
    return <p className="py-6 text-sm text-danger">Не удалось загрузить гробы.</p>
  }

  const open = data.filter((c) => coffinOpen(c.released_at))
  const solved = data.filter((c) => !coffinOpen(c.released_at))

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
            onClick={() => navigate('/mathcenter/' + year + '/coffins/' + t.id)}
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
          centerId={centerId}
          isManager={isManager}
          solved={tab === 'solved'}
        />
      )}
    </div>
  )
}

function CoffinGroups({
  coffins,
  centerId,
  isManager,
  solved,
}: {
  coffins: Coffin[]
  centerId: number
  isManager: boolean
  solved: boolean
}) {
  if (coffins.length === 0) {
    return (
      <Card className="px-6 py-16 text-center">
        <p className="text-muted">
          {solved ? 'Разобранных гробов пока нет.' : 'Открытых гробов пока нет.'}
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
            <CoffinCard
              key={c.subproblem_id}
              centerId={centerId}
              coffin={c}
              isManager={isManager}
              solved={solved}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

function CoffinCard({
  centerId,
  coffin,
  isManager,
  solved,
}: {
  centerId: number
  coffin: Coffin
  isManager: boolean
  solved: boolean
}) {
  const hasSolution =
    coffin.has_solution_tex || coffin.has_solution_pdf || !!coffin.solution_link
  const [showSolution, setShowSolution] = useState(false)
  const texQuery = useSubproblemSolutionTex(
    coffin.subproblem_id,
    coffin.has_solution_tex && showSolution,
  )
  // Students see разбор once the coffin is solved; teachers always (to verify).
  const canSeeSolution = (isManager || solved) && hasSolution

  return (
    <Card className={cn('p-4', coffin.is_coffin && !solved && 'border-status-checking')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-ink">{coffin.display}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            {solved ? (
              <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-muted">
                Разобрана · {formatDateTime(coffin.released_at)}
              </span>
            ) : (
              <span className="rounded-full bg-status-checking-soft px-2.5 py-0.5 text-xs font-medium text-status-checking">
                Открыт для сдачи
              </span>
            )}
            {isManager ? (
              <span className="text-xs text-muted">
                решили {coffin.accepted_count} из {coffin.total_count}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canSeeSolution ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => setShowSolution((v) => !v)}>
              Разбор
            </Button>
          ) : null}
          {isManager ? (
            <ManagerControls centerId={centerId} coffin={coffin} solved={solved} hasSolution={hasSolution} />
          ) : null}
        </div>
      </div>

      {/* Student submit tile (only while the coffin is open). */}
      {!isManager && !solved ? (
        <div className="mt-3">
          <SubTile coffin={coffin} />
        </div>
      ) : null}

      {showSolution && canSeeSolution ? (
        <div className="mt-4 border-t border-line pt-4">
          <SolutionContent
            hasTex={coffin.has_solution_tex}
            hasPdf={coffin.has_solution_pdf}
            link={coffin.solution_link}
            pdfPath={'/mathcenter/subproblems/' + coffin.subproblem_id + '/solution/pdf'}
            texQuery={texQuery}
          />
        </div>
      ) : null}
    </Card>
  )
}

function ManagerControls({
  centerId,
  coffin,
  solved,
  hasSolution,
}: {
  centerId: number
  coffin: Coffin
  solved: boolean
  hasSolution: boolean
}) {
  const release = useReleaseCoffin(centerId)
  const putTex = usePutSubproblemSolutionTex(coffin.subproblem_id, centerId)
  const uploadPdf = useUploadSubproblemSolutionPdf(coffin.subproblem_id, centerId)
  const setLink = useSetSubproblemSolutionLink(coffin.subproblem_id, centerId)
  // Load the existing LaTeX so a разобранный coffin's editor opens on its code.
  const texQuery = useSubproblemSolutionTex(
    coffin.subproblem_id,
    solved && coffin.has_solution_tex,
  )

  if (solved) {
    // Разобранный гроб: edit / attach its разбор.
    return (
      <SolutionEditor
        title={'Разбор · ' + coffin.display}
        hasTex={coffin.has_solution_tex}
        hasPdf={coffin.has_solution_pdf}
        link={coffin.solution_link}
        initialTex={texQuery.data?.tex}
        onPutTex={(tex) => putTex.mutateAsync(tex)}
        onUploadPdf={(file) => uploadPdf.mutateAsync(file)}
        onSetLink={(link) => setLink.mutateAsync(link)}
        trigger={
          <Button type="button" size="sm" variant="secondary">
            {hasSolution ? 'Редактировать разбор' : 'Загрузить разбор'}
          </Button>
        }
      />
    )
  }
  // Open coffin: one «Снять» — attach the разбор (optional) and close it.
  return (
    <SolutionEditor
      title={'Снять гроб · ' + coffin.display}
      hasTex={coffin.has_solution_tex}
      hasPdf={coffin.has_solution_pdf}
      link={coffin.solution_link}
      onPutTex={(tex) => putTex.mutateAsync(tex)}
      onUploadPdf={(file) => uploadPdf.mutateAsync(file)}
      onSetLink={(link) => setLink.mutateAsync(link)}
      onResolve={() => release.mutateAsync(coffin.subproblem_id)}
      resolveLabel="Снять гроб (закрыть)"
      trigger={
        <Button type="button" size="sm">
          Снять
        </Button>
      }
    />
  )
}

function SubTile({ coffin }: { coffin: Coffin }) {
  const { year } = useParams<{ year: string }>()
  const status = coffin.current_status ?? 'ungraded'
  const beingGraded = coffin.being_graded ?? false
  const threadId = coffin.thread_id ?? 0
  const meta = displayStatusMeta(status, beingGraded)
  const base = '/mathcenter/' + year + '/series/' + coffin.series_id
  const to =
    threadId > 0
      ? base + '/thread/' + threadId
      : base + '/submit/' + coffin.subproblem_id
  return (
    <Link
      to={to}
      title={meta.label}
      className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <StatusTile status={status} beingGraded={beingGraded} label={meta.label} />
    </Link>
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
  return (
    <ul className="flex flex-col gap-2">
      {data.map((item) => (
        <li key={item.thread_id}>
          <CoffinQueueRow item={item} />
        </li>
      ))}
    </ul>
  )
}

function CoffinQueueRow({ item }: { item: CoffinQueueItem }) {
  const { year } = useParams<{ year: string }>()
  const locked = claimIsLive(item)
  const { meta, className } = displayPill(item.current_status, locked)
  const label = item.subproblem_label
    ? item.problem_display + ' (' + item.subproblem_label + ')'
    : item.problem_display
  return (
    <Link
      to={'/mathcenter/' + year + '/series/' + item.series_id + '/thread/' + item.thread_id}
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
