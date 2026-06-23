import { Link, useParams } from 'react-router-dom'
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
import { StatusLegend, StatusTile } from '../../design/ui'
import { cn } from '../../design/cn'

export interface StudentProblemListProps {
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
  year: string,
  seriesId: number,
  sub: RollupSubproblem,
): string {
  const base = '/mathcenter/' + year + '/series/' + seriesId
  return sub.thread_id > 0
    ? base + '/thread/' + sub.thread_id
    : base + '/submit/' + sub.subproblem_id
}

// StudentProblemList shows the calling student's own progress: one row per
// problem with a clickable status tile per subproblem, a problem-level summary
// badge, and a "Сдать" shortcut to the first not-yet-accepted subproblem.
export function StudentProblemList({
  seriesId,
  rollup,
  series,
}: StudentProblemListProps) {
  const { year } = useParams<{ year: string }>()
  if (rollup.problems.length === 0) {
    return <p className="py-6 text-sm text-muted">В этой серии пока нет задач.</p>
  }
  const meta = subMetaMap(series)

  return (
    <div className="flex flex-col gap-3">
      {rollup.problems.map((problem) => (
        <ProblemRow
          key={problem.problem_id}
          year={year ?? ''}
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
  year,
  seriesId,
  problem,
  meta,
  dueAt,
}: {
  year: string
  seriesId: number
  problem: RollupProblem
  meta: Map<number, Subproblem>
  dueAt: string
}) {
  const summary = problemStateFromSubproblems(
    problem.subproblems.map((s) => s.current_status),
  )
  const summaryMeta = homeworkStatusMeta(summary)

  // Submission is done by pressing a subproblem's status tile (its symbol):
  // an existing thread opens its dialog; an untouched-but-open subproblem opens
  // the submit form. No separate "Сдать" button.
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
          // Show the subproblem letter up front on an untouched subproblem, so a
          // row of "a b c" reads as distinct subproblems rather than identical
          // circles. Single-part problems (no letter) keep the ○; attempted
          // subproblems show their status glyph.
          const letterGlyph =
            sub.current_status === 'ungraded' && sub.subproblem_label !== ''
              ? sub.subproblem_label
              : undefined
          const tile = (
            <StatusTile
              status={sub.current_status}
              beingGraded={sub.being_graded}
              label={tileLabel}
              glyph={letterGlyph}
            />
          )
          // A tile links to its thread when one exists; an untouched subproblem
          // links to the submit form only while THAT subproblem is open.
          const interactive =
            sub.thread_id > 0 || !closedForSub(meta.get(sub.subproblem_id), dueAt)
          return interactive ? (
            <Link
              key={sub.subproblem_id}
              to={subproblemPath(year, seriesId, sub)}
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
    </div>
  )
}
