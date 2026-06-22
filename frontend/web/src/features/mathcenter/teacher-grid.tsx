import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  claimIsLive,
  coffinOpen,
  displayStatusMeta,
  useTeacherGrid,
  type GridColumn,
  type GridStudent,
} from '@my239/shared'
import { Input, Spinner, StatusTile } from '../../design/ui'
import { cn } from '../../design/cn'
import {
  coffinCellClasses,
  coffinColumnClasses,
  cornerHeaderCell,
  gridScrollerWithHeight,
  gridTable,
  groupLabel,
  nameCell,
} from './grid-style'

export interface TeacherGridProps {
  centerId: number
  seriesId: number
}

function threadPath(centerId: number, seriesId: number, threadId: number): string {
  return '/mathcenter/' + centerId + '/series/' + seriesId + '/thread/' + threadId
}

// columnHeader renders a compact column label like "3" / "3б", with the full
// problem name available on hover.
function columnHeader(col: GridColumn): string {
  return col.problem_number + (col.subproblem_label ?? '')
}

// TeacherGrid is the students × subproblems status spreadsheet for one series.
// Each filled cell is a StatusTile linking to that thread; empty cells render a
// non-interactive tile. It shares its visual language (borders, sticky rules,
// header look, coffin tint) with the «Кондуит» via grid-style.ts, but stays a
// single header row with no totals (those are conduit-only) and keeps its
// clickable cells. The student filter lives in the corner «Ученик» cell.
export function TeacherGrid({ centerId, seriesId }: TeacherGridProps) {
  const { data, isPending, isError } = useTeacherGrid(seriesId)
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    const matches = q
      ? data.students.filter((s) => s.student_name.toLowerCase().includes(q))
      : data.students
    const out: { name: string; students: GridStudent[] }[] = []
    for (const s of matches) {
      let g = out.find((x) => x.name === s.group_name)
      if (!g) {
        g = { name: s.group_name, students: [] }
        out.push(g)
      }
      g.students.push(s)
    }
    return out
  }, [data, query])

  if (isPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }
  if (isError || !data) {
    return <p className="py-6 text-sm text-danger">Не удалось загрузить таблицу.</p>
  }
  if (data.students.length === 0 || data.columns.length === 0) {
    return <p className="py-6 text-sm text-muted">В серии пока нет данных.</p>
  }

  const colCount = data.columns.length + 1
  const shown = groups.reduce((n, g) => n + g.students.length, 0)

  // One full-width scroll surface (no nested rounded box), filling the area
  // below the series tabs. Matches the «Кондуит».
  return (
    <div className={gridScrollerWithHeight('max-h-[calc(100vh-14rem)]')}>
      <table className={gridTable}>
        <thead>
          <tr>
            {/* Corner cell — holds the student search filter. */}
            <th className={cornerHeaderCell}>
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
                  {shown} из {data.students.length}
                </span>
              </div>
            </th>
            {data.columns.map((col) => {
              const open = col.is_coffin && coffinOpen(col.coffin_released_at)
              return (
                <th
                  key={col.subproblem_id}
                  title={
                    (col.subproblem_label
                      ? col.problem_display + ' (' + col.subproblem_label + ')'
                      : col.problem_display) +
                    (col.is_coffin
                      ? open
                        ? ' — гроб (открыт)'
                        : ' — гроб (разобран)'
                      : '')
                  }
                  className={cn(
                    'sticky top-0 z-20 min-w-9 px-2 py-2 text-center text-xs font-medium',
                    coffinColumnClasses(col.is_coffin, open),
                  )}
                >
                  {columnHeader(col)}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {shown === 0 ? (
            <tr>
              <td colSpan={colCount} className="px-3 py-6 text-sm text-muted">
                Ученик не найден.
              </td>
            </tr>
          ) : (
            groups.map((group) => (
              <GroupRows
                key={group.name}
                group={group}
                columns={data.columns}
                colCount={colCount}
                centerId={centerId}
                seriesId={seriesId}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function GroupRows({
  group,
  columns,
  colCount,
  centerId,
  seriesId,
}: {
  group: { name: string; students: GridStudent[] }
  columns: GridColumn[]
  colCount: number
  centerId: number
  seriesId: number
}) {
  return (
    <>
      <tr className="bg-surface-muted/60">
        <td colSpan={colCount} className="p-0">
          <div className={groupLabel}>{group.name}</div>
        </td>
      </tr>
      {group.students.map((student) => {
        const byId = new Map(student.cells.map((c) => [c.subproblem_id, c]))
        return (
          <tr key={student.student_user_id} className="hover:bg-surface-muted/40">
            <td className={cn(nameCell, 'max-w-44 truncate')}>
              {student.student_name}
            </td>
            {columns.map((col) => {
              const cell = byId.get(col.subproblem_id)
              const status = cell?.current_status ?? 'ungraded'
              const beingGraded = cell ? claimIsLive(cell) : false
              const label =
                columnHeader(col) +
                ': ' +
                displayStatusMeta(status, beingGraded).label
              const open = col.is_coffin && coffinOpen(col.coffin_released_at)
              return (
                <td
                  key={col.subproblem_id}
                  className={cn(
                    'px-2 py-1 text-center',
                    coffinCellClasses(col.is_coffin, open),
                  )}
                >
                  {cell && cell.thread_id > 0 ? (
                    <Link
                      to={threadPath(centerId, seriesId, cell.thread_id)}
                      className="inline-block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      <StatusTile status={status} beingGraded={beingGraded} label={label} />
                    </Link>
                  ) : (
                    <StatusTile status={status} beingGraded={beingGraded} label={label} />
                  )}
                </td>
              )
            })}
          </tr>
        )
      })}
    </>
  )
}
