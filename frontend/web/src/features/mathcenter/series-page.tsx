import { useMemo, useState } from 'react'
import {
  currentSeries,
  useMySeriesRollup,
  useSeriesList,
  useSeriesProblemStats,
  type MyRollup,
  type Series,
} from '@my239/shared'
import { Card, CardContent, Spinner } from '../../design/ui'
import { cn } from '../../design/cn'
import { StatementPanel } from './statement-panel'
import { SeriesStrip } from './series-strip'
import { StudentProblemList } from './student-problem-list'
import { TeacherProblemStats } from './teacher-problem-stats'
import { UploadSeriesDialog } from './upload-series-dialog'
import { useSeriesContext } from './use-series-context'

export function SeriesPage() {
  const ctx = useSeriesContext()

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
  if (ctx.centers.length === 0) {
    return (
      <Card className="animate-rise px-6 py-16 text-center">
        <p className="text-muted">У вас пока нет доступа к матцентрам.</p>
      </Card>
    )
  }

  return (
    <div className="animate-rise flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-medium text-ink">Серии</h1>
        {ctx.centers.length > 1 ? (
          <CenterSelector
            centers={ctx.centers}
            value={ctx.centerId}
            onChange={ctx.setCenterId}
          />
        ) : null}
      </header>

      <CenterSeries
        key={ctx.centerId}
        centerId={ctx.centerId}
        isStudentView={ctx.isStudentView}
      />
    </div>
  )
}

function CenterSelector({
  centers,
  value,
  onChange,
}: {
  centers: { id: number; label: string }[]
  value: number
  onChange: (id: number) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      <span>Центр</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {centers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
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
        <div className="grid gap-6 lg:grid-cols-2">
          <StatementPanel series={selected} />
          <DetailSide series={selected} isStudentView={isStudentView} />
        </div>
      ) : null}
    </>
  )
}

function DetailSide({
  series,
  isStudentView,
}: {
  series: Series
  isStudentView: boolean
}) {
  return (
    <Card>
      <CardContent>
        {isStudentView ? (
          <StudentSide series={series} />
        ) : (
          <TeacherSide series={series} />
        )}
      </CardContent>
    </Card>
  )
}

function StudentSide({ series }: { series: Series }) {
  const { data, isPending, isError } = useMySeriesRollup(series.id)
  return (
    <SidePanel
      title="Мой прогресс"
      isPending={isPending}
      isError={isError}
      hasData={!!data}
    >
      {data ? <StudentProblemListWithCounts seriesId={series.id} rollup={data} /> : null}
    </SidePanel>
  )
}

function StudentProblemListWithCounts({
  seriesId,
  rollup,
}: {
  seriesId: number
  rollup: MyRollup
}) {
  // Count per-subproblem statuses granularly so the summary matches the tiles:
  // the backend's `pending` lumps unsolved with under-review, which reads wrong.
  let accepted = 0
  let checking = 0
  let rejected = 0
  let unsolved = 0
  for (const p of rollup.problems) {
    for (const s of p.subproblems) {
      if (s.current_status === 'accepted') accepted++
      else if (s.current_status === 'rejected') rejected++
      else if (s.current_status === 'submitted' || s.current_status === 'appealed') checking++
      else unsolved++
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3 text-xs text-muted">
        <span>
          Принято: <span className="font-medium text-status-accepted">{accepted}</span>
        </span>
        <span>
          На проверке: <span className="font-medium text-status-checking">{checking}</span>
        </span>
        <span>
          Отклонено: <span className="font-medium text-status-rejected">{rejected}</span>
        </span>
        <span>
          Не решено: <span className="font-medium text-muted">{unsolved}</span>
        </span>
      </div>
      <StudentProblemList seriesId={seriesId} rollup={rollup} />
    </div>
  )
}

function TeacherSide({ series }: { series: Series }) {
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
