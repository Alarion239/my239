import { Link } from 'react-router-dom'
import {
  displayStatusMeta,
  homeworkStatusMeta,
  problemStateFromSubproblems,
  submissionClosedFor,
  type MyRollup,
  type RollupProblem,
  type RollupSubproblem,
  type Series,
  type Subproblem,
} from '@my239/shared'
import { Button, StatusLegend, StatusTile } from '../../design/ui'
import { cn } from '../../design/cn'

export interface StudentProblemListProps {
  centerId: number
  seriesId: number
  rollup: MyRollup
  // The series view carries each subproblem's coffin/release metadata so
  // submission is gated PER SUBPROBLEM: a normal subproblem closes at the
  // deadline, but an open coffin stays submittable past it. Existing threads
  // stay reachable regardless (to appeal).
  series: Series
}

// closedForSub computes the per-subproblem submission gate from the series
// metadata: normal subproblems close at the deadline, open coffins stay open.
function closedForSub(meta: Subproblem | undefined, dueAt: string): boolean {
  return submissionClosedFor({
    is_coffin: meta?.is_coffin ?? false,
    coffin_released_at: meta?.released_at,
    series_due_at: dueAt,
  })
}

function subMetaMap(series: Series): Map<number, Subproblem> {
  const m = new Map<number, Subproblem>()
  for (const p of series.problems) {
    for (const sub of p.subproblems) m.set(sub.id, sub)
  }
  return m
}

// subproblemPath routes to the existing thread when the student has already
// submitted (thread_id > 0), otherwise to the first-submission form keyed by
// subproblem id.
function subproblemPath(
  centerId: number,
  seriesId: number,
  sub: RollupSubproblem,
): string {
  const base = '/mathcenter/' + centerId + '/series/' + seriesId
  return sub.thread_id > 0
    ? base + '/thread/' + sub.thread_id
    : base + '/submit/' + sub.subproblem_id
}

// StudentProblemList shows the calling student's own progress: one row per
// problem with a clickable status tile per subproblem, a problem-level summary
// badge, and a "Сдать" shortcut to the first not-yet-accepted subproblem.
export function StudentProblemList({
  centerId,
  seriesId,
  rollup,
  series,
}: StudentProblemListProps) {
  if (rollup.problems.length === 0) {
    return <p className="py-6 text-sm text-muted">В этой серии пока нет задач.</p>
  }
  const meta = subMetaMap(series)

  return (
    <div className="flex flex-col gap-3">
      {rollup.problems.map((problem) => (
        <ProblemRow
          key={problem.problem_id}
          centerId={centerId}
          seriesId={seriesId}
          problem={problem}
          meta={meta}
          dueAt={series.due_at}
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
  meta,
  dueAt,
}: {
  centerId: number
  seriesId: number
  problem: RollupProblem
  meta: Map<number, Subproblem>
  dueAt: string
}) {
  const summary = problemStateFromSubproblems(
    problem.subproblems.map((s) => s.current_status),
  )
  const summaryMeta = homeworkStatusMeta(summary)
  // First not-yet-accepted subproblem that is still open for submission — where
  // "Сдать" should land. An open coffin keeps the shortcut alive past the
  // deadline; a closed normal subproblem doesn't.
  const next = problem.subproblems.find(
    (s) =>
      s.current_status !== 'accepted' &&
      !closedForSub(meta.get(s.subproblem_id), dueAt),
  )
  const allAccepted = problem.subproblems.every(
    (s) => s.current_status === 'accepted',
  )

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-ink">{problem.problem_display}</div>
        <div className="text-xs text-muted">{summaryMeta.label}</div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {problem.subproblems.map((sub) => {
          const tileLabel =
            sub.subproblem_label +
            ': ' +
            displayStatusMeta(sub.current_status, sub.being_graded).label
          const tile = (
            <StatusTile
              status={sub.current_status}
              beingGraded={sub.being_graded}
              label={tileLabel}
            />
          )
          // A tile links to its thread when one exists; an untouched subproblem
          // links to the submit form only while THAT subproblem is open.
          const interactive =
            sub.thread_id > 0 || !closedForSub(meta.get(sub.subproblem_id), dueAt)
          return interactive ? (
            <Link
              key={sub.subproblem_id}
              to={subproblemPath(centerId, seriesId, sub)}
              title={tileLabel}
              className={cn(
                'rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              )}
            >
              {tile}
            </Link>
          ) : (
            <span key={sub.subproblem_id} title={tileLabel}>
              {tile}
            </span>
          )
        })}
      </div>
      {next ? (
        <Button size="sm" variant="secondary" asChild>
          <Link to={subproblemPath(centerId, seriesId, next)}>Сдать</Link>
        </Button>
      ) : allAccepted ? (
        <Button size="sm" variant="secondary" disabled title="Все подзадачи приняты">
          Сдать
        </Button>
      ) : (
        <Button size="sm" variant="secondary" disabled title="Срок сдачи прошёл">
          Сдать
        </Button>
      )}
    </div>
  )
}
