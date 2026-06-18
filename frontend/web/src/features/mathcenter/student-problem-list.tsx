import { Link } from 'react-router-dom'
import {
  homeworkStatusMeta,
  problemStateFromSubproblems,
  type MyRollup,
  type RollupProblem,
} from '@my239/shared'
import { Button, StatusLegend, StatusTile } from '../../design/ui'
import { cn } from '../../design/cn'

export interface StudentProblemListProps {
  centerId: number
  seriesId: number
  rollup: MyRollup
}

function submitPath(
  centerId: number,
  seriesId: number,
  subproblemId: number,
): string {
  return (
    '/mathcenter/' + centerId + '/series/' + seriesId + '/submit/' + subproblemId
  )
}

// StudentProblemList shows the calling student's own progress: one row per
// problem with a clickable status tile per subproblem, a problem-level summary
// badge, and a "Сдать" shortcut to the first not-yet-accepted subproblem.
export function StudentProblemList({
  centerId,
  seriesId,
  rollup,
}: StudentProblemListProps) {
  if (rollup.problems.length === 0) {
    return <p className="py-6 text-sm text-muted">В этой серии пока нет задач.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {rollup.problems.map((problem) => (
        <ProblemRow
          key={problem.problem_id}
          centerId={centerId}
          seriesId={seriesId}
          problem={problem}
        />
      ))}
      <StatusLegend className="mt-2" />
    </div>
  )
}

function ProblemRow({
  centerId,
  seriesId,
  problem,
}: {
  centerId: number
  seriesId: number
  problem: RollupProblem
}) {
  const summary = problemStateFromSubproblems(
    problem.subproblems.map((s) => s.current_status),
  )
  const summaryMeta = homeworkStatusMeta(summary)
  // First subproblem that is not yet accepted — where "Сдать" should land.
  const next = problem.subproblems.find((s) => s.current_status !== 'accepted')

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-ink">{problem.problem_display}</div>
        <div className="text-xs text-muted">{summaryMeta.label}</div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {problem.subproblems.map((sub) => (
          <Link
            key={sub.subproblem_id}
            to={submitPath(centerId, seriesId, sub.subproblem_id)}
            title={sub.subproblem_label + ': ' + homeworkStatusMeta(sub.current_status).label}
            className={cn(
              'rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            )}
          >
            <StatusTile
              status={sub.current_status}
              label={
                sub.subproblem_label +
                ': ' +
                homeworkStatusMeta(sub.current_status).label
              }
            />
          </Link>
        ))}
      </div>
      {next ? (
        <Button size="sm" variant="secondary" asChild>
          <Link to={submitPath(centerId, seriesId, next.subproblem_id)}>Сдать</Link>
        </Button>
      ) : (
        <Button size="sm" variant="secondary" disabled title="Все подзадачи приняты">
          Сдать
        </Button>
      )}
    </div>
  )
}
