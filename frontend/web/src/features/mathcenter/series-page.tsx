import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import {
  currentSeries,
  useMathCenterMe,
  useMySeriesRollup,
  useSeriesList,
  useSeriesProblemStats,
  type MyRollup,
  type Series,
} from '@my239/shared'
import { Card, CardContent, Spinner } from '../../design/ui'
import { cn } from '../../design/cn'
import { useAuth } from '../../auth/auth-context'
import { StatementPanel } from './statement-panel'
import { SeriesStrip } from './series-strip'
import { StudentProblemList } from './student-problem-list'
import { TeacherProblemStats } from './teacher-problem-stats'
import { GraderQueue } from './grader-queue'
import { TeacherGrid } from './teacher-grid'
import { UploadSeriesDialog } from './upload-series-dialog'
import { useSeriesContext } from './use-series-context'

export function SeriesPage() {
  const { centerId: centerIdParam } = useParams<{ centerId: string }>()
  const centerId = Number(centerIdParam)
  const ctx = useSeriesContext(centerId)

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

  return (
    <div className="animate-rise flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-medium text-ink">Серии</h1>
      </header>

      <CenterSeries
        key={centerId}
        centerId={centerId}
        isStudentView={ctx.isStudentView}
      />
    </div>
  )
}

function NotFoundState() {
  return (
    <Card className="animate-rise px-6 py-16 text-center">
      <p className="text-muted">Нет доступа к этому матцентру.</p>
    </Card>
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
  const firstId = teacherCenters[0]?.id ?? studentCenter?.id ?? null

  if (firstId !== null) {
    return <Navigate to={'/mathcenter/' + firstId} replace />
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

// CenterSeries holds the per-center list + selection. Remounted (via key) when
// the center changes so the selected-series state resets cleanly.
function CenterSeries({
  centerId,
  isStudentView,
}: {
  centerId: number
  isStudentView: boolean
}) {
  const { data: list, isPending, isError } = useSeriesList(centerId)
  const current = useMemo(() => (list ? currentSeries(list) : undefined), [list])
  const [selectedId, setSelectedId] = useState<number | null>(null)

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

  const selected =
    list.find((s) => s.id === selectedId) ?? current ?? list[0]

  if (list.length === 0) {
    return (
      <>
        {!isStudentView ? (
          <div className="flex justify-end">
            <UploadSeriesDialog centerId={centerId} />
          </div>
        ) : null}
        <Card className="px-6 py-16 text-center">
          <p className="text-muted">Серий пока нет</p>
        </Card>
      </>
    )
  }

  return (
    <>
      {!isStudentView ? (
        <div className="flex flex-wrap justify-end gap-2">
          <UploadSeriesDialog centerId={centerId} />
          {selected ? (
            <UploadSeriesDialog
              key={'edit-' + selected.id}
              centerId={centerId}
              series={selected}
              trigger={
                <button
                  type="button"
                  className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
                >
                  Редактировать
                </button>
              }
            />
          ) : null}
        </div>
      ) : null}

      <SeriesStrip
        series={list}
        selectedId={selected?.id ?? null}
        currentId={current?.id ?? null}
        onSelect={setSelectedId}
      />

      {selected ? (
        isStudentView ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <StatementPanel series={selected} />
            <Card>
              <CardContent>
                <StudentSide centerId={centerId} series={selected} />
              </CardContent>
            </Card>
          </div>
        ) : (
          <TeacherSeriesView centerId={centerId} series={selected} />
        )
      ) : null}
    </>
  )
}

function StudentSide({ centerId, series }: { centerId: number; series: Series }) {
  const { data, isPending, isError } = useMySeriesRollup(series.id)
  return (
    <SidePanel
      title="Мой прогресс"
      isPending={isPending}
      isError={isError}
      hasData={!!data}
    >
      {data ? (
        <StudentProblemListWithCounts
          centerId={centerId}
          seriesId={series.id}
          rollup={data}
        />
      ) : null}
    </SidePanel>
  )
}

function StudentProblemListWithCounts({
  centerId,
  seriesId,
  rollup,
}: {
  centerId: number
  seriesId: number
  rollup: MyRollup
}) {
  // Count per-subproblem statuses granularly so the summary matches the tiles:
  // the backend's `pending` lumps unsolved with under-review, which reads wrong.
  // "На проверке"/"В очереди" split mirrors the per-tile being_graded flag.
  let accepted = 0
  let queued = 0
  let grading = 0
  let rejected = 0
  let unsolved = 0
  for (const p of rollup.problems) {
    for (const s of p.subproblems) {
      if (s.current_status === 'accepted') accepted++
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
      <StudentProblemList centerId={centerId} seriesId={seriesId} rollup={rollup} />
    </div>
  )
}

type TeacherTab = 'stats' | 'queue' | 'grid'

// TeacherSeriesView gives teachers a top-level switch between "Статистика"
// (kept in the two-column master-detail beside the statement) and the grading
// surfaces "Очередь"/"Таблица", which take the full width — a 60+ student grid
// or a long queue needs the room and doesn't want the statement column.
function TeacherSeriesView({
  centerId,
  series,
}: {
  centerId: number
  series: Series
}) {
  const [tab, setTab] = useState<TeacherTab>('stats')
  const [mine, setMine] = useState(false)
  return (
    <div className="flex flex-col gap-4">
      <TeacherTabBar value={tab} onChange={setTab} />
      {tab === 'stats' ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <StatementPanel series={series} />
          <Card>
            <CardContent>
              <StatsTab series={series} />
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent>
            {tab === 'queue' ? (
              <GraderQueue
                centerId={centerId}
                seriesId={series.id}
                mine={mine}
                onMineChange={setMine}
              />
            ) : (
              <TeacherGrid centerId={centerId} seriesId={series.id} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

const TEACHER_TABS: { id: TeacherTab; label: string }[] = [
  { id: 'stats', label: 'Статистика' },
  { id: 'queue', label: 'Очередь' },
  { id: 'grid', label: 'Таблица' },
]

function TeacherTabBar({
  value,
  onChange,
}: {
  value: TeacherTab
  onChange: (v: TeacherTab) => void
}) {
  return (
    <div
      className="inline-flex self-start rounded-full border border-line bg-surface-muted p-0.5"
      role="tablist"
      aria-label="Раздел проверки"
    >
      {TEACHER_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'rounded-full px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            value === t.id ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:text-ink',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function StatsTab({ series }: { series: Series }) {
  const { data, isPending, isError } = useSeriesProblemStats(series.id)
  return (
    <SidePanel
      title={'Статистика' + (data ? ' · ' + data.total_students + ' учеников' : '')}
      isPending={isPending}
      isError={isError}
      hasData={!!data}
    >
      {data ? <TeacherProblemStats stats={data} /> : null}
    </SidePanel>
  )
}

function SidePanel({
  title,
  isPending,
  isError,
  hasData,
  children,
}: {
  title: string
  isPending: boolean
  isError: boolean
  hasData: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className={cn('font-display text-lg font-medium text-ink')}>{title}</h2>
      {isPending ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : isError || !hasData ? (
        <p className="py-6 text-sm text-danger">Не удалось загрузить данные.</p>
      ) : (
        children
      )}
    </div>
  )
}
