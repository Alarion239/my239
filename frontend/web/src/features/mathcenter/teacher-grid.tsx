import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  claimIsLive,
  displayStatusMeta,
  useTeacherGrid,
  type GridColumn,
  type GridStudent,
} from '@my239/shared'
import { Input, Spinner, StatusTile } from '../../design/ui'
import { cn } from '../../design/cn'

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

// TeacherGrid is the students × subproblems status spreadsheet. Each filled
// cell is a StatusTile linking to that thread; empty cells (no submission yet)
// render a non-interactive tile. Students are grouped by their group, the
// header + name column stay pinned while scrolling, and a name filter keeps
// large cohorts navigable.
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск ученика…"
          className="h-9 max-w-xs"
          aria-label="Поиск ученика"
        />
        <span className="text-xs text-muted">
          {shown} из {data.students.length}
        </span>
      </div>

      {shown === 0 ? (
        <p className="py-6 text-sm text-muted">Ученик не найден.</p>
      ) : (
        // Bounded scroll box so the sticky header/column pin within it rather
        // than fighting the page + app bar.
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-line bg-surface">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 border-b border-line bg-surface px-3 py-2 text-left text-xs font-medium text-muted">
                  Ученик
                </th>
                {data.columns.map((col) => (
                  <th
                    key={col.subproblem_id}
                    title={
                      (col.subproblem_label
                        ? col.problem_display + ' (' + col.subproblem_label + ')'
                        : col.problem_display) + (col.is_coffin ? ' — гроб' : '')
                    }
                    className={cn(
                      'sticky top-0 z-20 border-b border-line px-2 py-2 text-center text-xs font-medium',
                      col.is_coffin ? 'bg-faint text-white' : 'bg-surface text-muted',
                    )}
                  >
                    {columnHeader(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <GroupRows
                  key={group.name}
                  group={group}
                  columns={data.columns}
                  colCount={colCount}
                  centerId={centerId}
                  seriesId={seriesId}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
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
      <tr>
        <td
          colSpan={colCount}
          className="sticky left-0 z-10 bg-surface-muted px-3 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-faint"
        >
          {group.name}
        </td>
      </tr>
      {group.students.map((student) => {
        const byId = new Map(student.cells.map((c) => [c.subproblem_id, c]))
        return (
          <tr key={student.student_user_id} className="hover:bg-surface-muted">
            <td className="sticky left-0 z-10 max-w-44 truncate bg-surface px-3 py-1 text-ink">
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
              return (
                <td
                  key={col.subproblem_id}
                  className={cn(
                    'px-2 py-1 text-center',
                    col.is_coffin && 'bg-faint/35',
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
