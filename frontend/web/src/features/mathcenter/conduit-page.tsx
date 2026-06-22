import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  coffinOpen,
  useCenterGrid,
  type CenterGridColumn,
  type CenterGridResponse,
  type CenterGridSeries,
} from '@my239/shared'
import { Card, Input, Spinner } from '../../design/ui'
import { cn } from '../../design/cn'
import { useSeriesContext } from './use-series-context'
import {
  coffinCellClasses,
  coffinColumnClasses,
  cornerHeaderCell,
  gridScrollerWithHeight,
  gridTable,
  groupLabel,
  nameCell,
  vert,
} from './grid-style'

export function ConduitPage() {
  const { centerId: centerIdParam } = useParams<{ centerId: string }>()
  const centerId = Number(centerIdParam)
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

  // Fills the full-bleed content region; the grid below is the single scroll
  // surface (see AppShell's full-bleed branch).
  return (
    <div className="h-full">
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
  const [query, setQuery] = useState('')

  const cols: FlatCol[] = useMemo(() => {
    const out: FlatCol[] = []
    for (const s of data.series) {
      s.columns.forEach((col, i) =>
        out.push({ col, seriesId: s.series_id, firstInSeries: i === 0 }),
      )
    }
    return out
  }, [data.series])

  // All students — totals are always computed over the full cohort; the search
  // only hides rows, it never changes the Решили/Решено/итого numbers.
  const students = useMemo(
    () => data.groups.flatMap((g) => g.students),
    [data.groups],
  )

  // Filtered groups for rendering: students whose name matches the query, with
  // empty groups dropped.
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return data.groups
    return data.groups
      .map((g) => ({
        ...g,
        students: g.students.filter((s) => s.name.toLowerCase().includes(q)),
      }))
      .filter((g) => g.students.length > 0)
  }, [data.groups, query])

  const shown = useMemo(
    () => filteredGroups.reduce((n, g) => n + g.students.length, 0),
    [filteredGroups],
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

  // The grid IS the page: it fills the full-bleed region and is the single
  // scroll surface (both axes), like a spreadsheet — no Card, no nested box.
  // Borders / sticky rules / coffin tint are shared with «Таблица» via
  // grid-style so the two grids can't drift apart.
  return (
    <div ref={scrollerRef} className={gridScrollerWithHeight('h-full')}>
      <table className={gridTable}>
        <thead>
          {/* Series band — one header spanning each series' columns. */}
          <tr>
            {/* Corner cell — holds the student search filter. */}
            <th rowSpan={2} className={cornerHeaderCell}>
              <div className="flex flex-col gap-1">
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ученик…"
                  className="h-8 w-full min-w-40"
                  aria-label="Поиск ученика"
                />
                <span className="text-[0.65rem] font-normal text-faint">
                  {shown} из {students.length}
                </span>
              </div>
            </th>
            {data.series.map((s) => (
              <th
                key={s.series_id}
                ref={s.series_id === currentId ? currentThRef : undefined}
                colSpan={s.columns.length}
                className={cn(
                  'sticky top-0 z-20 h-9 whitespace-nowrap border-b border-t border-line bg-surface-muted px-3 text-center font-medium text-ink',
                  vert(true),
                )}
                title={s.display_name}
              >
                Серия {s.number}
              </th>
            ))}
            <th
              rowSpan={2}
              className="sticky right-0 top-0 z-40 border-b border-l border-r border-t border-line bg-surface-muted px-3 py-2 text-center font-medium text-ink"
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
                    'sticky top-9 z-20 min-w-9 border-b border-line px-1.5 py-1 text-center text-xs font-medium',
                    vert(firstInSeries),
                    coffinColumnClasses(col.is_coffin, open),
                  )}
                >
                  {col.column_label}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {filteredGroups.map((g) => (
            <Fragment key={g.group_id}>
              <tr className="bg-surface-muted/60">
                <td colSpan={cols.length + 2} className="border-b border-line p-0">
                  <div className={groupLabel}>{g.name}</div>
                </td>
              </tr>
              {g.students.map((st) => (
                <tr key={st.user_id} className="hover:bg-surface-muted/40">
                  <td className={nameCell}>{st.name}</td>
                  {cols.map(({ col, firstInSeries }) => {
                    const acc = accepted(st.user_id, col.subproblem_id)
                    const open = col.is_coffin && coffinOpen(col.coffin_released_at)
                    return (
                      <td
                        key={col.subproblem_id}
                        className={cn(
                          'border-b border-line px-1.5 py-1.5 text-center',
                          vert(firstInSeries),
                          acc
                            ? 'bg-status-accepted-soft font-medium text-status-accepted'
                            : cn(coffinCellClasses(col.is_coffin, open), 'text-faint'),
                        )}
                      >
                        {acc ? cellInitials(st.user_id, col.subproblem_id) : ''}
                      </td>
                    )
                  })}
                  <td className="sticky right-0 z-10 border-b border-l border-r border-line bg-surface px-3 py-1.5 text-center font-medium text-ink">
                    {rowTotal(st.user_id)}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
          {/* Column totals: people who solved each problem — pinned to the
              bottom so it's always on screen. Always over ALL students. */}
          <tr>
            <td className="sticky bottom-0 left-0 z-30 border-b border-l border-r border-t border-line bg-surface-muted px-3 py-1.5 font-medium text-ink">
              Решили
            </td>
            {cols.map(({ col, firstInSeries }) => (
              <td
                key={col.subproblem_id}
                className={cn(
                  'sticky bottom-0 z-20 border-b border-t border-line bg-surface-muted px-1.5 py-1.5 text-center font-medium text-ink',
                  vert(firstInSeries),
                )}
              >
                {colTotal(col.subproblem_id)}
              </td>
            ))}
            <td className="sticky bottom-0 right-0 z-30 border-b border-l border-r border-t border-line bg-surface-muted px-3 py-1.5 text-center font-medium text-ink">
              {grandTotal}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
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
