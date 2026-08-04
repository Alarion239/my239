import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  APIErrorImpl,
  currentSeries,
  isClosed,
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
import { usePhoneViewport } from '../../use-phone-viewport'
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
const STUDENT_LAPTOP_TAB_IDS = ['tasks', 'razbor'] as const
const STUDENT_PHONE_TAB_IDS = ['statement', 'progress', 'razbor'] as const
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
    <div className="flex flex-col gap-6">
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
    <Card className="px-6 py-12 text-center">
      <p className="text-lg font-medium text-text">Вы ещё не распределены в группу.</p>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
        Попросите одного из руководителей матцентра назначить вас в учебную группу.
      </p>
      {headTeachers.length > 0 ? (
        <div className="mx-auto mt-5 max-w-sm text-left">
          <p className="text-xs font-medium uppercase tracking-wide text-text-subtle">Руководители</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-text">
            {headTeachers.map((teacher) => <li key={teacher.display_name}>{teacher.display_name}</li>)}
          </ul>
        </div>
      ) : null}
    </Card>
  )
}

function NotFoundState() {
  return (
    <Card className="px-6 py-16 text-center">
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
            'flex w-56 shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-control bg-surface p-4 text-muted transition-colors',
            highlight && 'border-selected-border bg-selected text-selected-text ring-2 ring-focus',
            'hover:border-selected-border hover:text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
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
    <Card className="px-6 py-16 text-center">
      <p className="text-muted">Вы не состоите ни в одном матцентре.</p>
      {isAdmin ? (
        <p className="mt-2 text-sm text-muted">
          Откройте{' '}
          <Link
            to="/admin/users"
            className="font-medium text-link underline-offset-4 hover:underline"
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
  const isPhone = usePhoneViewport()
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

  const allowedTabs = isStudentView
    ? isPhone
      ? STUDENT_PHONE_TAB_IDS
      : STUDENT_LAPTOP_TAB_IDS
    : isPhone
      ? TEACHER_TAB_IDS
      : TEACHER_TAB_IDS.filter((tabID) => tabID !== 'offline')
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
          isPhone={isPhone}
        />
      ) : !selected.published ? (
        <SeriesDraftEditor centerId={centerId} series={selected} />
      ) : (
        // Teachers get the queue, statement, and razbor on laptop; the
        // phone-only offline workflow adds «Очно». The center-wide Кондуит
        // owns the shared computer grid.
        <TeacherSeriesView
          centerId={centerId}
          series={selected}
          year={year ?? ''}
          tab={activeTab as TeacherTab}
          termSearch={termSearch}
          isPhone={isPhone}
        />
      )}
    </>
  )
}

type StudentTab =
  | (typeof STUDENT_LAPTOP_TAB_IDS)[number]
  | (typeof STUDENT_PHONE_TAB_IDS)[number]

const STUDENT_LAPTOP_TABS: { id: (typeof STUDENT_LAPTOP_TAB_IDS)[number]; label: string }[] = [
  { id: 'tasks', label: 'Задачи' },
  { id: 'razbor', label: 'Разбор' },
]

const STUDENT_PHONE_TABS: { id: (typeof STUDENT_PHONE_TAB_IDS)[number]; label: string }[] = [
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
  isPhone,
}: {
  series: Series
  year: string
  tab: StudentTab
  termSearch: string
  isPhone: boolean
}) {
  const navigate = useNavigate()
  const tabs = isPhone ? STUDENT_PHONE_TABS : STUDENT_LAPTOP_TABS
  return (
    <div className="flex flex-col gap-4">
      <PillTabs
        value={tab}
        onChange={(t) =>
          navigate('/mathcenter/' + year + '/series/' + series.id + '/' + t + termSearch)
        }
        options={tabs}
        ariaLabel="Раздел серии"
        className="self-start"
      />
      {!isPhone && tab === 'tasks' ? (
        <StudentTasks series={series} />
      ) : tab === 'statement' ? (
        <StatementPanel series={series} bare />
      ) : tab === 'progress' ? (
        <StudentSide series={series} />
      ) : (
        <StudentRazbor series={series} />
      )}
    </div>
  )
}

// StudentTasks combines the statement and personal progress into the same
// laptop master/detail frame used by the teacher razbor view. Each side gets
// half the available width; phones retain the separate tabs for easier focus.
function StudentTasks({ series }: { series: Series }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-0">
      <div className="min-w-0 md:w-1/2 md:pr-4">
        <StatementPanel series={series} bare />
      </div>
      <div className="min-w-0 md:w-1/2 md:border-l md:border-border md:pl-4">
        <StudentSide series={series} />
      </div>
    </div>
  )
}

function StudentSide({ series }: { series: Series }) {
  const { data, isPending, isError } = useMySeriesRollup(series.id)
  const closed = isClosed(series.due_at)
  return (
    <AsyncGate isPending={isPending} isError={isError} hasData={!!data}>
      {data ? (
        <StudentProblemListWithNotice
          series={series}
          rollup={data}
          closed={closed}
        />
      ) : null}
    </AsyncGate>
  )
}

function StudentProblemListWithNotice({
  series,
  rollup,
  closed,
}: {
  series: Series
  rollup: MyRollup
  closed: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
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

// TeacherSeriesView gives teachers full-width tabs in workflow order. The
// shared computer matrix lives only in the center-wide «Кондуит»; the queue
// stays the compact per-series workflow suitable for phones.
function TeacherSeriesView({
  centerId,
  series,
  year,
  tab,
  termSearch,
  isPhone,
}: {
  centerId: number
  series: Series
  year: string
  tab: TeacherTab
  termSearch: string
  isPhone: boolean
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
          options={isPhone ? TEACHER_TABS : TEACHER_TABS.filter((option) => option.id !== 'offline')}
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
          className="pointer-events-auto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-control bg-surface/90 text-muted shadow-lg transition-all hover:-translate-y-0.5 hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
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
          className="pointer-events-auto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-control bg-surface/90 text-muted shadow-lg transition-all hover:-translate-y-0.5 hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
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
  const [searchParams] = useSearchParams()
  const selectedCoffinId = Number(searchParams.get('coffin_subproblem_id'))
  const initialSubproblemId = Number.isInteger(selectedCoffinId) && selectedCoffinId > 0 ? selectedCoffinId : undefined
  return (
    <AsyncGate isPending={isPending} isError={isError} hasData={!!data}>
      {data ? (
        <TeacherProblemStats
          stats={data}
          series={series}
          centerId={centerId}
          initialSubproblemId={initialSubproblemId}
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
