import { Link, useLocation, useParams } from 'react-router-dom'
import {
  exerciseComplete,
  submissionClosedFor,
  type MyRollup,
  type RollupProblem,
  type RollupSubproblem,
  type Series,
  type Subproblem,
} from '@my239/shared'
import { cn } from '../../design/cn'
import { studentStatusMeta, studentSubproblemIdentifier } from './student-status'
import { StudentStatusTile } from './student-status-tile'

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
// problem with a clickable, letter-preserving status tile per subproblem.
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
  const exerciseUnlocked = exerciseComplete(
    rollup.problems.flatMap((problem) =>
      problem.subproblems.map((sub) => ({
        problem_number: problem.problem_number,
        current_status: sub.current_status,
      })),
    ),
  )

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
          exerciseUnlocked={exerciseUnlocked}
        />
      ))}
    </div>
  )
}

function ProblemRow({
  year,
  seriesId,
  problem,
  meta,
  dueAt,
  exerciseUnlocked,
}: {
  year: string
  seriesId: number
  problem: RollupProblem
  meta: Map<number, Subproblem>
  dueAt: string
  exerciseUnlocked: boolean
}) {
  const { search } = useLocation()

  // Submission is done by pressing a subproblem's status tile:
  // an existing thread opens its dialog; an untouched-but-open subproblem opens
  // the submit form. No separate "Сдать" button.
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border bg-surface px-4 py-3',
        problem.problem_number === 0
          ? 'border-selected-border/40 bg-selected/50'
          : !exerciseUnlocked
            ? 'border-border bg-surface-subtle/50 opacity-70'
            : 'border-border',
      )}
    >
      <div className="min-w-[8rem] flex-[0_1_12rem]">
        <div className="font-medium text-text">{problem.problem_display}</div>
      </div>
      <div className="grid min-w-0 flex-[1_1_18rem] grid-cols-[repeat(auto-fit,minmax(2.75rem,1fr))] gap-1.5">
        {problem.subproblems.map((sub) => {
          const statusMeta = studentStatusMeta(sub.current_status)
          const identifier = studentSubproblemIdentifier(
            sub.subproblem_label,
            problem.problem_number,
          )
          const tileLabel = identifier + ': ' + statusMeta.label
          const tile = (
            <StudentStatusTile
              status={sub.current_status}
              identifier={identifier}
            />
          )
          // A tile links to its thread when one exists; an untouched subproblem
          // links to the submit form only while THAT subproblem is open.
          const interactive =
            sub.thread_id > 0 || !closedForSub(meta.get(sub.subproblem_id), dueAt)
          return interactive ? (
            <Link
              key={sub.subproblem_id}
              to={subproblemPath(year, seriesId, sub) + search}
              aria-label={tileLabel}
              className="flex min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {tile}
            </Link>
          ) : (
            <span key={sub.subproblem_id} title={tileLabel} className="flex min-w-0">
              {tile}
            </span>
          )
        })}
      </div>
    </div>
  )
}
