import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  claimIsLive,
  coffinOpen,
  displayStatusMeta,
  formatDateTime,
  usePutSubproblemSolutionTex,
  usePublishSubproblemSolutionsBatch,
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
import { useCenterIdContext, useCenterTermContext } from './center-id-context'
import { SolutionWorkbench, type SolutionWorkbenchMode } from './solution-editor'
import { displayPill } from './status-style'
import { coffinQueueThreadPath } from './navigation-paths'

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
  const [movedPlaceholder, setMovedPlaceholder] = useState<{ coffin: Coffin; index: number } | null>(null)
  const [focusCoffinId, setFocusCoffinId] = useState<number | null>(null)

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
          centerId={centerId}
          isManager={isManager}
          solved={tab === 'solved'}
          movedPlaceholder={tab === 'current' ? movedPlaceholder : null}
          focusCoffinId={focusCoffinId}
          onPublished={(coffin, index) => setMovedPlaceholder({ coffin, index })}
          onFollowPlaceholder={() => {
            if (!movedPlaceholder) return
            setFocusCoffinId(movedPlaceholder.coffin.subproblem_id)
            setMovedPlaceholder(null)
            navigate('/mathcenter/' + year + '/coffins/solved' + search)
          }}
          onFocused={() => setFocusCoffinId(null)}
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
  movedPlaceholder,
  focusCoffinId,
  onPublished,
  onFollowPlaceholder,
  onFocused,
}: {
  coffins: Coffin[]
  centerId: number
  isManager: boolean
  solved: boolean
  movedPlaceholder: { coffin: Coffin; index: number } | null
  focusCoffinId: number | null
  onPublished: (coffin: Coffin, index: number) => void
  onFollowPlaceholder: () => void
  onFocused: () => void
}) {
  if (coffins.length === 0 && !movedPlaceholder) {
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
          {g.coffins.map((c, index) => (
            <div key={c.subproblem_id}>
              {movedPlaceholder && movedPlaceholder.coffin.series_id === g.key && movedPlaceholder.index === index ? (
                <MovedCoffinPlaceholder onClick={onFollowPlaceholder} />
              ) : null}
              <CoffinCard
                centerId={centerId}
                coffin={c}
                isManager={isManager}
                solved={solved}
                autoOpen={focusCoffinId === c.subproblem_id}
                onPublished={() => onPublished(c, index)}
                onFocused={onFocused}
              />
            </div>
          ))}
          {movedPlaceholder && movedPlaceholder.coffin.series_id === g.key && movedPlaceholder.index >= g.coffins.length ? (
            <MovedCoffinPlaceholder onClick={onFollowPlaceholder} />
          ) : null}
        </section>
      ))}
      {movedPlaceholder && !groups.some((group) => group.key === movedPlaceholder.coffin.series_id) ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-medium text-ink">Серия {movedPlaceholder.coffin.series_number} · {movedPlaceholder.coffin.series_name}</h2>
          <MovedCoffinPlaceholder onClick={onFollowPlaceholder} />
        </section>
      ) : null}
    </div>
  )
}

function MovedCoffinPlaceholder({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-left text-sm text-accent-ink transition-colors hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      <span>Гроб перемещён в «Разобранные»</span>
      <span className="font-medium">Перейти →</span>
    </button>
  )
}

function CoffinCard({
  centerId,
  coffin,
  isManager,
  solved,
  autoOpen,
  onPublished,
  onFocused,
}: {
  centerId: number
  coffin: Coffin
  isManager: boolean
  solved: boolean
  autoOpen?: boolean
  onPublished?: () => void
  onFocused?: () => void
}) {
  const hasSolution =
    coffin.has_solution_tex || coffin.has_solution_pdf || !!coffin.solution_link
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
  const [panelMode, setPanelMode] = useState<SolutionWorkbenchMode | null>(null)
  const originControl = useRef<'view' | 'edit'>('view')
  const cardRef = useRef<HTMLDivElement>(null)
  const texQuery = useSubproblemSolutionTex(coffin.subproblem_id, coffin.has_solution_tex && panelMode !== null)
  const putTex = usePutSubproblemSolutionTex(coffin.subproblem_id, centerId)
  const uploadPdf = useUploadSubproblemSolutionPdf(coffin.subproblem_id, centerId)
  const setLink = useSetSubproblemSolutionLink(coffin.subproblem_id, centerId)
  const publish = usePublishSubproblemSolutionsBatch(centerId)
  // Students see разбор once the coffin is solved; teachers always (to verify).
  const canSeeSolution = (isManager || solved) && hasSolution

  useEffect(() => {
    if (!autoOpen || !solved) return
    setPanelMode('view')
    cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    onFocused?.()
  }, [autoOpen, onFocused, solved])

  return (
    <div ref={cardRef}>
    <Card className={cn('p-4', coffin.is_coffin && !solved && 'border-status-checking', hasSolution && coffin.solution_published_at ? 'bg-status-accepted-soft' : hasSolution ? 'bg-surface-muted' : '')}>
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
            {isManager && hasSolution ? (
              <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', coffin.solution_published_at ? 'bg-status-accepted-soft text-status-accepted' : 'bg-surface-muted text-muted')}>
                {coffin.solution_published_at ? 'Разбор опубликован' : 'Черновик'}
              </span>
            ) : null}
            {isManager ? (
              <span className="text-xs text-muted">
                решили {coffin.accepted_count} из {coffin.total_count}
              </span>
            ) : null}
            {!isManager && solved && accessLabel ? (
              <span className="text-xs text-muted">{accessLabel}</span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canSeeSolution ? (
            <Button
              id={'coffin-solution-view-' + coffin.subproblem_id}
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                originControl.current = 'view'
                setPanelMode((v) => v === 'view' ? null : 'view')
              }}
            >
              Разбор
            </Button>
          ) : null}
          {isManager ? (
            <ManagerControls
              solved={solved}
              hasSolution={hasSolution}
              onOpen={() => {
                originControl.current = 'edit'
                setPanelMode('edit')
              }}
              triggerId={'coffin-solution-edit-' + coffin.subproblem_id}
            />
          ) : null}
        </div>
      </div>

      {/* Student submit tile (only while the coffin is open). */}
      {!isManager && !solved ? (
        <div className="mt-3">
          <SubTile coffin={coffin} />
        </div>
      ) : null}

      {panelMode && (panelMode === 'edit' || canSeeSolution) ? (
        <div className="mt-4 border-t border-line pt-4">
          <SolutionWorkbench
            title={coffin.display}
            mode={panelMode}
            hasTex={coffin.has_solution_tex}
            hasPdf={coffin.has_solution_pdf}
            link={coffin.solution_link}
            publishedAt={coffin.solution_published_at}
            centerId={centerId}
            pdfPath={'/mathcenter/subproblems/' + coffin.subproblem_id + '/solution/pdf'}
            initialTex={texQuery.data?.tex}
            texQuery={texQuery}
            onModeChange={setPanelMode}
            onPutTex={(tex) => putTex.mutateAsync(tex)}
            onUploadPdf={(file) => uploadPdf.mutateAsync(file)}
            onSetLink={(link) => setLink.mutateAsync(link)}
            onPublish={() => publish.mutateAsync([coffin.subproblem_id])}
            closesCoffin={!solved}
            onPublished={onPublished}
            onClose={() => {
              setPanelMode(null)
              const id = originControl.current === 'edit'
                ? 'coffin-solution-edit-' + coffin.subproblem_id
                : 'coffin-solution-view-' + coffin.subproblem_id
              requestAnimationFrame(() => document.getElementById(id)?.focus())
            }}
          />
        </div>
      ) : null}
    </Card>
    </div>
  )
}

function ManagerControls({
  solved,
  hasSolution,
  onOpen,
  triggerId,
}: {
  solved: boolean
  hasSolution: boolean
  onOpen: () => void
  triggerId: string
}) {
  return (
    <Button id={triggerId} type="button" size="sm" variant={solved || hasSolution ? 'secondary' : 'primary'} onClick={onOpen}>
      {hasSolution ? 'Редактировать разбор' : 'Загрузить разбор'}
    </Button>
  )
}

function SubTile({ coffin }: { coffin: Coffin }) {
  const { year } = useParams<{ year: string }>()
  const { search } = useLocation()
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
      to={to + search}
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
