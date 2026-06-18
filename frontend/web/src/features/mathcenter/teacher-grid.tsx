import { Link } from 'react-router-dom'
import {
  homeworkStatusMeta,
  useTeacherGrid,
  type GridColumn,
  type GridStudent,
} from '@my239/shared'
import { Spinner, StatusTile } from '../../design/ui'

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
// render a non-interactive tile. Students are grouped by their group.
export function TeacherGrid({ centerId, seriesId }: TeacherGridProps) {
  const { data, isPending, isError } = useTeacherGrid(seriesId)

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

  // Group students by group_name, preserving first-seen order.
  const groups: { name: string; students: GridStudent[] }[] = []
  for (const s of data.students) {
    let g = groups.find((x) => x.name === s.group_name)
    if (!g) {
      g = { name: s.group_name, students: [] }
      groups.push(g)
    }
    g.students.push(s)
  }
  const colCount = data.columns.length + 1

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-surface px-2 py-1 text-left text-xs font-medium text-muted">
              Ученик
            </th>
            {data.columns.map((col) => (
              <th
                key={col.subproblem_id}
                title={
                  col.subproblem_label
                    ? col.problem_display + ' (' + col.subproblem_label + ')'
                    : col.problem_display
                }
                className="px-1 py-1 text-center text-xs font-medium text-muted"
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
          className="px-2 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-faint"
        >
          {group.name}
        </td>
      </tr>
      {group.students.map((student) => {
        const byId = new Map(student.cells.map((c) => [c.subproblem_id, c]))
        return (
          <tr key={student.student_user_id}>
            <td className="sticky left-0 z-10 max-w-40 truncate bg-surface px-2 py-1 text-ink">
              {student.student_name}
            </td>
            {columns.map((col) => {
              const cell = byId.get(col.subproblem_id)
              const status = cell?.current_status ?? 'ungraded'
              const label =
                columnHeader(col) + ': ' + homeworkStatusMeta(status).label
              return (
                <td key={col.subproblem_id} className="px-1 py-1 text-center">
                  {cell && cell.thread_id > 0 ? (
                    <Link
                      to={threadPath(centerId, seriesId, cell.thread_id)}
                      className="inline-block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      <StatusTile status={status} label={label} />
                    </Link>
                  ) : (
                    <StatusTile status={status} label={label} />
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
