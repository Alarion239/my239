import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  APIErrorImpl,
  currentSeries,
  exerciseComplete,
  isClosed,
  solvedForCredit,
  useDeleteSeries,
  useMathCenterMe,
  useMySeriesRollup,
  useSeriesList,
  useSeriesProblemStats,
  type MyRollup,
  type Series,
  type MathCenterTerm,
} from '@my239/shared'
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  PillTabs,
  Spinner,
} from '../../design/ui'
import { cn } from '../../design/cn'
import { useAuth } from '../../auth/auth-context'
import { StatementPanel } from './statement-panel'
import { SeriesStrip } from './series-strip'
import { StudentProblemList } from './student-problem-list'
import { StudentRazbor } from './student-razbor'
import { TeacherProblemStats } from './teacher-problem-stats'
import { GraderQueue } from './grader-queue'
import { OfflineGradingTab } from './offline-grading-tab'
import { UploadSeriesDialog } from './upload-series-dialog'
import { SeriesDraftEditor } from './series-draft-editor'
import { useSeriesContext } from './use-series-context'
import { useCenterIdContext, useCenterTermContext } from './center-id-context'

// Allowed tab ids per view, with the default first. The route carries the tab
// (e.g. /mathcenter/2027/series/42/razbor) so it survives reload + back/forward.
const STUDENT_TAB_IDS = ['progress', 'statement', 'razbor'] as const
const TEACHER_TAB_IDS = ['queue', 'statement', 'razbor', 'offline'] as const

export function SeriesPage() {
  const centerId = useCenterIdContext()
  const { termId, term } = useCenterTermContext()
  const ctx = useSeriesContext(centerId)
  const me = useMathCenterMe()

  if (!Number.isFinite(centerId) || centerId <= 0) {
    return <NotFoundState />
  }
  if (ctx.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }
  if (ctx.isError) {
    return <p className="py-10 text-sm text-danger">Не удалось загрузить матцентр.</p>
  }
  if (!ctx.hasAccess) {
    return <NotFoundState />
  }
	if (ctx.isStudentView && (term === null || term.is_active) && me.data?.student?.is_unassigned) {
		return <UnassignedStudentState headTeachers={me.data.student.head_teachers} />
	}

  return (
    <div className="animate-rise flex flex-col gap-6">
      <CenterSeries
        key={centerId + ':' + termId}
        centerId={centerId}
        termId={termId}
        termKind={term?.kind ?? 'academic'}
        isArchived={term !== null && !term.is_active}
        isStudentView={ctx.isStudentView}
      />
    </div>
  )
}

function UnassignedStudentState({ headTeachers }: { headTeachers: { display_name: string }[] }) {
  return (
    <Card className="animate-rise px-6 py-12 text-center">
      <p className="text-lg font-medium text-ink">Вы ещё не распределены в группу.</p>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
        Попросите одного из руководителей матцентра назначить вас в учебную группу.
      </p>
      {headTeachers.length > 0 ? (
        <div className="mx-auto mt-5 max-w-sm text-left">
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Руководители</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-ink">
            {headTeachers.map((teacher) => <li key={teacher.display_name}>{teacher.display_name}</li>)}
          </ul>
        </div>
      ) : null}
    </Card>
  )
}

function NotFoundState() {
  return (
    <Card className="animate-rise px-6 py-16 text-center">
      <p className="text-muted">Нет доступа к этому матцентру.</p>
    </Card>
  )
}

// CreateSeriesCard is the empty "+" card at the end of the series strip that
// opens the create-series dialog — replacing the old toolbar button. It mirrors
// the series cards' width and stretches to their height.
function CreateSeriesCard({
  centerId,
  termId,
  defaultNumber,
  previousDueAt,
  termKind,
  highlight = false,
}: {
  centerId: number
  termId: number
  defaultNumber: number
  previousDueAt?: string | null
  termKind: MathCenterTerm['kind']
  highlight?: boolean
}) {
  return (
    <UploadSeriesDialog
      centerId={centerId}
      termId={termId}
      defaultNumber={defaultNumber}
      previousDueAt={previousDueAt}
      termKind={termKind}
      trigger={
        <button
          type="button"
          aria-label="Создать серию"
          className={cn(
            'flex w-56 shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong bg-surface p-4 text-muted transition-colors',
            highlight && 'border-accent bg-accent-soft text-accent-ink ring-2 ring-accent/30',
            'hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          )}
        >
          <Plus className="h-6 w-6" aria-hidden />
          <span className="text-sm font-medium">Создать серию</span>
        </button>
      }
    />
  )
}

// MathCenterIndex handles bare /mathcenter: redirect to the first center the
// user can access, or — if none — show an empty state (admins get a hint to use
// the admin area, where they can enrol themselves or pick any center).
export function MathCenterIndex() {
  const { user } = useAuth()
  const me = useMathCenterMe()
  const isAdmin = user?.is_admin ?? false

  if (me.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }

  const teacherCenters = me.data?.teacher?.centers ?? []
  const studentCenter = me.data?.student?.center ?? null
  // Address centers by graduation year in the URL (the canonical scheme).
  const firstYear =
    teacherCenters[0]?.graduation_year ?? studentCenter?.graduation_year ?? null

  if (firstYear !== null) {
    return <Navigate to={'/mathcenter/' + firstYear} replace />
  }

  return (
    <Card className="animate-rise px-6 py-16 text-center">
      <p className="text-muted">Вы не состоите ни в одном матцентре.</p>
      {isAdmin ? (
        <p className="mt-2 text-sm text-muted">
          Откройте{' '}
          <Link
            to="/admin/users"
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            Администрирование
          </Link>
          , чтобы добавить себя в матцентр.
        </p>
      ) : null}
    </Card>
  )
}

// CenterSeries holds the per-center list + URL-driven selection/tab. The active
// series + tab live in the route (series/:seriesId/:tab) so reload and
// back/forward restore them; bare `series` resolves to the current series'
// default tab.
function CenterSeries({
  centerId,
  termId,
  termKind,
  isArchived,
  isStudentView,
}: {
  centerId: number
  termId: number
  termKind: MathCenterTerm['kind']
  isArchived: boolean
  isStudentView: boolean
}) {
  const { year, seriesId: seriesIdParam, tab } = useParams<{
    year: string
    seriesId?: string
    tab?: string
  }>()
  const navigate = useNavigate()
  const [actionsSeriesId, setActionsSeriesId] = useState<number | null>(null)
  const { data: list, isPending, isError } = useSeriesList(centerId, termId)
  const current = useMemo(() => (list ? currentSeries(list) : undefined), [list])
  const termSearch = '?term_id=' + termId

  if (isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }
  if (isError || !list) {
    return <p className="py-10 text-sm text-danger">Не удалось загрузить серии.</p>
  }

  const allowedTabs = isStudentView ? STUDENT_TAB_IDS : TEACHER_TAB_IDS
  // Pre-fill the next series number: one past the highest existing number.
  const nextNumber =
    list.length > 0 ? Math.max(...list.map((s) => s.number)) + 1 : 1
  const previousDueAt =
    list.reduce<string | null>((latest, series) => {
      if (!latest) return series.due_at
      return Date.parse(series.due_at) > Date.parse(latest) ? series.due_at : latest
    }, null)
  const createCard = !isStudentView && !isArchived ? (
    <CreateSeriesCard
      centerId={centerId}
      termId={termId}
      defaultNumber={nextNumber}
      previousDueAt={previousDueAt}
      termKind={termKind}
      highlight={!current}
    />
  ) : undefined

  if (list.length === 0) {
    return !isStudentView && !isArchived ? (
      <div className="flex">{createCard}</div>
    ) : (
      <Card className="px-6 py-16 text-center">
        <p className="text-muted">Серий пока нет</p>
      </Card>
    )
  }

  // Bare `series` (no :seriesId): redirect to the current series' default tab.
  const seriesIdNum = seriesIdParam ? Number(seriesIdParam) : 0
  const selected =
    list.find((s) => s.id === seriesIdNum) ?? current ?? list[0]
  const defaultTab = !isStudentView && !selected.published ? 'statement' : allowedTabs[0]
  if (!seriesIdParam || !list.some((s) => s.id === seriesIdNum)) {
    return (
      <Navigate
        to={'/mathcenter/' + year + '/series/' + selected.id + '/' + defaultTab + termSearch}
        replace
      />
    )
  }
  // Validate the tab against this view's allowed set; default-redirect on miss.
  const activeTab = (allowedTabs as readonly string[]).includes(tab ?? '') &&
    (isStudentView || selected.published || tab === 'statement')
    ? (tab as string)
    : null
  if (!activeTab) {
    return (
      <Navigate
        to={'/mathcenter/' + year + '/series/' + selected.id + '/' + defaultTab + termSearch}
        replace
      />
    )
  }

  const selectSeries = (id: number) => {
    if (id === selected.id) {
      setActionsSeriesId((openId) => (openId === id ? null : id))
      return
    }
    setActionsSeriesId(null)
    // Preserve the active tab when switching series.
    navigate('/mathcenter/' + year + '/series/' + id + '/' + activeTab + termSearch)
  }

  const selectedActions = !isStudentView && !isArchived ? (
    <>
      <EditSeriesButton centerId={centerId} series={selected} />
      <DeleteSeriesButton centerId={centerId} series={selected} year={year ?? ''} />
    </>
  ) : undefined

  return (
    <>
      <SeriesStrip
        series={list}
        selectedId={selected.id}
        currentId={current?.id ?? null}
        onSelect={selectSeries}
        showQueueNotifications={!isStudentView}
        selectedActionsOpen={actionsSeriesId === selected.id}
        selectedActions={selectedActions}
        trailing={createCard}
      />

      {isStudentView ? (
        <StudentSeriesView
          series={selected}
          year={year ?? ''}
          tab={activeTab as StudentTab}
          termSearch={termSearch}
        />
      ) : !selected.published ? (
        <SeriesDraftEditor centerId={centerId} series={selected} />
      ) : (
        // Teachers get Очередь / Условие / Разбор / Очно as full-width tabs;
        // разбор carries the statistics + coffin handling, while the
        // center-wide Кондуит owns the shared computer grid.
        <TeacherSeriesView
          centerId={centerId}
          series={selected}
          year={year ?? ''}
          tab={activeTab as TeacherTab}
          termSearch={termSearch}
        />
      )}
    </>
  )
}

type StudentTab = (typeof STUDENT_TAB_IDS)[number]

const STUDENT_TABS: { id: StudentTab; label: string }[] = [
  { id: 'statement', label: 'Условие' },
  { id: 'progress', label: 'Прогресс' },
  { id: 'razbor', label: 'Разбор' },
]

// StudentSeriesView gives students the same tabbed layout as teachers: the
// statement, their own progress, and a read-only «Разбор» of the released
// solutions. The active tab comes from the URL and switching pushes a new route.
function StudentSeriesView({
  series,
  year,
  tab,
  termSearch,
}: {
  series: Series
  year: string
  tab: StudentTab
  termSearch: string
}) {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col gap-4">
      <PillTabs
        value={tab}
        onChange={(t) =>
          navigate('/mathcenter/' + year + '/series/' + series.id + '/' + t + termSearch)
        }
        options={STUDENT_TABS}
        ariaLabel="Раздел серии"
        className="self-start"
      />
      {tab === 'statement' ? (
        <StatementPanel series={series} bare />
      ) : tab === 'progress' ? (
        <StudentSide series={series} />
      ) : (
        <StudentRazbor series={series} />
      )}
    </div>
  )
}

function StudentSide({ series }: { series: Series }) {
  const { data, isPending, isError } = useMySeriesRollup(series.id)
  const closed = isClosed(series.due_at)
  return (
    <AsyncGate isPending={isPending} isError={isError} hasData={!!data}>
      {data ? (
        <StudentProblemListWithCounts
          series={series}
          rollup={data}
          closed={closed}
        />
      ) : null}
    </AsyncGate>
  )
}

function StudentProblemListWithCounts({
  series,
  rollup,
  closed,
}: {
  series: Series
  rollup: MyRollup
  closed: boolean
}) {
  // Count per-subproblem statuses granularly so the summary matches the tiles:
  // the backend's `pending` lumps unsolved with under-review, which reads wrong.
  // "На проверке"/"В очереди" split mirrors the per-tile being_graded flag.
  const exerciseUnlocked = exerciseComplete(
    rollup.problems.flatMap((problem) =>
      problem.subproblems.map((sub) => ({
        problem_number: problem.problem_number,
        current_status: sub.current_status,
      })),
    ),
  )
  let accepted = 0
  let queued = 0
  let grading = 0
  let rejected = 0
  let unsolved = 0
  for (const p of rollup.problems) {
    if (p.problem_number === 0) continue
    for (const s of p.subproblems) {
      if (solvedForCredit(p.problem_number, s.current_status, exerciseUnlocked)) accepted++
      else if (s.current_status === 'rejected') rejected++
      else if (s.current_status === 'submitted' || s.current_status === 'appealed') {
        if (s.being_graded) grading++
        else queued++
      } else unsolved++
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3 text-xs text-muted">
        <span>
          Принято: <span className="font-medium text-status-accepted">{accepted}</span>
        </span>
        <span>
          В очереди: <span className="font-medium text-status-checking">{queued}</span>
        </span>
        <span>
          На проверке: <span className="font-medium text-status-grading">{grading}</span>
        </span>
        <span>
          Отклонено: <span className="font-medium text-status-rejected">{rejected}</span>
        </span>
        <span>
          Не решено: <span className="font-medium text-muted">{unsolved}</span>
        </span>
      </div>
      {closed ? (
        <p className="text-xs text-muted">
          Срок серии прошёл — обычные задачи сдавать нельзя (можно открыть задачу
          и подать апелляцию по отклонённым). Открытые гробы остаются доступны.
        </p>
      ) : null}
      <StudentProblemList
        seriesId={series.id}
        rollup={rollup}
        series={series}
      />
    </div>
  )
}

type TeacherTab = (typeof TEACHER_TAB_IDS)[number]

// TeacherSeriesView gives teachers full-width tabs in workflow order:
// «Очередь», «Условие», «Разбор», then «Очно». The shared computer matrix
// lives only in the center-wide «Кондуит»; the queue stays the compact
// per-series workflow suitable for phones.
function TeacherSeriesView({
  centerId,
  series,
  year,
  tab,
  termSearch,
}: {
  centerId: number
  series: Series
  year: string
  tab: TeacherTab
  termSearch: string
}) {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <PillTabs
          value={tab}
          onChange={(t) =>
            navigate('/mathcenter/' + year + '/series/' + series.id + '/' + t + termSearch)
          }
          options={TEACHER_TABS}
          ariaLabel="Раздел проверки"
          className="shrink-0"
        />
      </div>
      {tab === 'statement' ? (
        <StatementPanel series={series} bare />
      ) : tab === 'razbor' ? (
        <StatsTab series={series} centerId={centerId} />
      ) : tab === 'queue' ? (
        <GraderQueue seriesId={series.id} />
      ) : (
        <OfflineGradingTab centerId={centerId} seriesId={series.id} />
      )}
    </div>
  )
}

const TEACHER_TABS: { id: TeacherTab; label: string }[] = [
  { id: 'queue', label: 'Очередь' },
  { id: 'statement', label: 'Условие' },
  { id: 'razbor', label: 'Разбор' },
  { id: 'offline', label: 'Очно' },
]

// EditSeriesButton is the icon-only «Редактировать серию» control shown after
// the selected series card is clicked again.
function EditSeriesButton({ centerId, series }: { centerId: number; series: Series }) {
  return (
    <UploadSeriesDialog
      key={'edit-' + series.id}
      centerId={centerId}
      series={series}
      trigger={
        <button
          type="button"
          aria-label="Редактировать серию"
          title="Редактировать серию"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface text-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Pencil className="h-4 w-4" aria-hidden />
        </button>
      }
    />
  )
}

// DeleteSeriesButton is the icon-only destructive control next to the edit
// button. Deleting a series cascades to its problems, subproblems and ALL
// student work, so it goes through a confirm dialog. On success we leave the
// (now-gone) series route back to the center, which resolves to the current
// series or the empty state.
function DeleteSeriesButton({
  centerId,
  series,
  year,
}: {
  centerId: number
  series: Series
  year: string
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const del = useDeleteSeries(centerId)

  function onConfirm() {
    setError(null)
    del.mutate(series.id, {
      onSuccess: () => {
        setOpen(false)
        navigate('/mathcenter/' + year)
      },
      onError: (e) =>
        setError(e instanceof APIErrorImpl ? e.message : 'Не удалось удалить серию.'),
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Удалить серию"
          title="Удалить серию"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface text-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogTitle>Удалить серию?</DialogTitle>
        <DialogDescription>
          Серия «{series.display_name}» и все связанные данные — задачи, разборы и
          вся проверка студентов — будут удалены безвозвратно.
        </DialogDescription>
        {error ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={del.isPending}
          >
            Отмена
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={onConfirm}
            disabled={del.isPending}
          >
            {del.isPending ? 'Удаление…' : 'Удалить'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StatsTab({
  series,
  centerId,
}: {
  series: Series
  centerId: number
}) {
  const { data, isPending, isError } = useSeriesProblemStats(series.id)
  return (
    <AsyncGate isPending={isPending} isError={isError} hasData={!!data}>
      {data ? (
        <TeacherProblemStats
          stats={data}
          series={series}
          centerId={centerId}
        />
      ) : null}
    </AsyncGate>
  )
}

// AsyncGate renders the spinner/error states for a query, then its children —
// no title, no container chrome (the tab itself spans full width).
function AsyncGate({
  isPending,
  isError,
  hasData,
  children,
}: {
  isPending: boolean
  isError: boolean
  hasData: boolean
  children: React.ReactNode
}) {
  if (isPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }
  if (isError || !hasData) {
    return <p className="py-6 text-sm text-danger">Не удалось загрузить данные.</p>
  }
  return <>{children}</>
}
