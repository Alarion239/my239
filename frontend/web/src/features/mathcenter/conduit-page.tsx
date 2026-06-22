import { Fragment, useEffect, useMemo, useRef } from 'react'
import {
  coffinOpen,
  useCenterGrid,
  type CenterGridColumn,
  type CenterGridResponse,
  type CenterGridSeries,
} from '@my239/shared'
import { Card, Spinner } from '../../design/ui'
import { cn } from '../../design/cn'
import { useSeriesContext } from './use-series-context'
import { useCenterIdContext } from './center-id-context'

export function ConduitPage() {
  const centerId = useCenterIdContext()
  const ctx = useSeriesContext(centerId)

  if (!Number.isFinite(centerId) || centerId <= 0) {
    return <NoAccess />
  }
  if (ctx.isLoading) {
    return <CenteredSpinner />
  }
  // The «Кондуит» is a teacher tool; students don't see it.
  if (!ctx.hasAccess || ctx.isStudentView) {
    return <NoAccess />
  }

  return (
    <div className="flex flex-col gap-4">
      <Conduit centerId={centerId} />
    </div>
  )
}

function Conduit({ centerId }: { centerId: number }) {
  const { data, isPending, isError } = useCenterGrid(centerId)
  if (isPending) return <CenteredSpinner />
  if (isError || !data) {
    return <p className="py-10 text-sm text-danger">Не удалось загрузить кондуит.</p>
  }
  const hasRows = data.groups.some((g) => g.students.length > 0)
  const hasCols = data.series.some((s) => s.columns.length > 0)
  if (!hasRows || !hasCols) {
    return (
      <Card className="px-6 py-16 text-center">
        <p className="text-muted">Пока нет данных: нужны ученики и серии задач.</p>
      </Card>
    )
  }
  return <ConduitTable data={data} />
}

// flatCol is a column with the bookkeeping the table needs: which series it
// belongs to and whether it's the first of that series (for the thick divider).
interface FlatCol {
  col: CenterGridColumn
  seriesId: number
  firstInSeries: boolean
}

// currentSeriesId picks the series to centre on: the soonest deadline at/after
// now, else the latest one.
function currentSeriesId(series: CenterGridSeries[]): number | null {
  const now = Date.now()
  let best: number | null = null
  let bestDue = Infinity
  let last: number | null = null
  let lastDue = -Infinity
  for (const s of series) {
    const due = Date.parse(s.due_at)
    if (Number.isNaN(due)) continue
    if (due >= now && due < bestDue) {
      bestDue = due
      best = s.series_id
    }
    if (due > lastDue) {
      lastDue = due
      last = s.series_id
    }
  }
  return best ?? last
}

function ConduitTable({ data }: { data: CenterGridResponse }) {
  const cols: FlatCol[] = useMemo(() => {
    const out: FlatCol[] = []
    for (const s of data.series) {
      s.columns.forEach((col, i) =>
        out.push({ col, seriesId: s.series_id, firstInSeries: i === 0 }),
      )
    }
    return out
  }, [data.series])

  const students = useMemo(
    () => data.groups.flatMap((g) => g.students),
    [data.groups],
  )

  const accepted = (studentId: number, subId: number): boolean =>
    data.cells[studentId + ':' + subId]?.current_status === 'accepted'

  const cellInitials = (studentId: number, subId: number): string => {
    const cell = data.cells[studentId + ':' + subId]
    if (!cell || cell.current_status !== 'accepted') return ''
    const g = cell.last_grader_user_id
    return (g != null && data.graders[String(g)]) || '✓'
  }

  const rowTotal = (studentId: number): number =>
    cols.reduce((n, c) => n + (accepted(studentId, c.col.subproblem_id) ? 1 : 0), 0)
  const colTotal = (subId: number): number =>
    students.reduce((n, st) => n + (accepted(st.user_id, subId) ? 1 : 0), 0)
  const grandTotal = students.reduce((n, st) => n + rowTotal(st.user_id), 0)

  // Centre the current series on open.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const currentThRef = useRef<HTMLTableCellElement | null>(null)
  const currentId = useMemo(() => currentSeriesId(data.series), [data.series])
  useEffect(() => {
    const scroller = scrollerRef.current
    const el = currentThRef.current
    if (!scroller || !el) return
    const elRect = el.getBoundingClientRect()
    const scRect = scroller.getBoundingClientRect()
    // Bring the series just to the right of the sticky student column (~12rem).
    scroller.scrollLeft += elRect.left - scRect.left - 200
  }, [currentId])

  const divider = 'border-l-2 border-l-line-strong'

  return (
    <Card className="overflow-hidden p-0">
      <div
        ref={scrollerRef}
        className="max-h-[calc(100vh-11rem)] overflow-auto overscroll-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <table className="border-collapse text-sm [&_td]:border [&_td]:border-line [&_th]:border [&_th]:border-line">
          <thead>
            {/* Series band — one header spanning each series' columns. */}
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 top-0 z-40 min-w-44 bg-surface-muted px-3 py-2 text-left font-medium text-ink"
              >
                Ученик
              </th>
              {data.series.map((s) => (
                <th
                  key={s.series_id}
                  ref={s.series_id === currentId ? currentThRef : undefined}
                  colSpan={s.columns.length}
                  className={cn(
                    'sticky top-0 z-20 h-9 whitespace-nowrap bg-surface-muted px-3 text-center font-medium text-ink',
                    divider,
                  )}
                  title={s.display_name}
                >
                  Серия {s.number}
                </th>
              ))}
              <th
                rowSpan={2}
                className="sticky right-0 top-0 z-40 bg-surface-muted px-3 py-2 text-center font-medium text-ink"
              >
                Решено
              </th>
            </tr>
            {/* Per-subproblem column labels. Coffins are tinted — amber while
                open for submission, gray once разобрана (solved). */}
            <tr>
              {cols.map(({ col, firstInSeries }) => {
                const open = col.is_coffin && coffinOpen(col.coffin_released_at)
                return (
                  <th
                    key={col.subproblem_id}
                    title={
                      col.is_coffin
                        ? open
                          ? 'Гроб — открыт'
                          : 'Гроб — разобран'
                        : undefined
                    }
                    className={cn(
                      'sticky top-9 z-20 min-w-9 px-1.5 py-1 text-center text-xs font-medium',
                      open
                        ? 'bg-status-checking text-white'
                        : col.is_coffin
                          ? 'bg-faint text-white'
                          : 'bg-surface-muted text-muted',
                      firstInSeries && divider,
                    )}
                  >
                    {col.column_label}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {data.groups.map((g) => (
              <Fragment key={g.group_id}>
                <tr className="bg-surface-muted/60">
                  <td colSpan={cols.length + 2} className="p-0">
                    <div className="sticky left-0 inline-block px-3 py-1 text-xs font-medium text-muted">
                      {g.name}
                    </div>
                  </td>
                </tr>
                {g.students.map((st) => (
                  <tr key={st.user_id} className="hover:bg-surface-muted/40">
                    <td className="sticky left-0 z-10 min-w-44 whitespace-nowrap bg-surface-muted px-3 py-1.5 text-ink">
                      {st.name}
                    </td>
                    {cols.map(({ col, firstInSeries }) => {
                      const acc = accepted(st.user_id, col.subproblem_id)
                      const open = col.is_coffin && coffinOpen(col.coffin_released_at)
                      return (
                        <td
                          key={col.subproblem_id}
                          className={cn(
                            'px-1.5 py-1.5 text-center',
                            firstInSeries && divider,
                            acc
                              ? 'bg-status-accepted-soft font-medium text-status-accepted'
                              : open
                                ? 'bg-status-checking/25 text-faint'
                                : col.is_coffin
                                  ? 'bg-faint/35 text-faint'
                                  : 'text-faint',
                          )}
                        >
                          {acc ? cellInitials(st.user_id, col.subproblem_id) : ''}
                        </td>
                      )
                    })}
                    <td className="sticky right-0 z-10 bg-surface px-3 py-1.5 text-center font-medium text-ink">
                      {rowTotal(st.user_id)}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {/* Column totals: people who solved each problem — pinned to the
                bottom so it's always on screen. */}
            <tr>
              <td className="sticky bottom-0 left-0 z-30 bg-surface-muted px-3 py-1.5 font-medium text-ink">
                Решили
              </td>
              {cols.map(({ col, firstInSeries }) => (
                <td
                  key={col.subproblem_id}
                  className={cn(
                    'sticky bottom-0 z-20 bg-surface-muted px-1.5 py-1.5 text-center font-medium text-ink',
                    firstInSeries && divider,
                  )}
                >
                  {colTotal(col.subproblem_id)}
                </td>
              ))}
              <td className="sticky bottom-0 right-0 z-30 bg-surface-muted px-3 py-1.5 text-center font-medium text-ink">
                {grandTotal}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function CenteredSpinner() {
  return (
    <div className="flex justify-center py-16">
      <Spinner />
    </div>
  )
}

function NoAccess() {
  return (
    <Card className="px-6 py-16 text-center">
      <p className="text-muted">Нет доступа к кондуиту этого матцентра.</p>
    </Card>
  )
}
