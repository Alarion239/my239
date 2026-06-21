import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { MyRollup, Series, Subproblem } from '@my239/shared'
import { StudentProblemList } from './student-problem-list'

// One problem with an untouched subproblem (no thread) and a rejected one.
const rollup: MyRollup = {
  counts: { accepted: 0, rejected: 1, pending: 1 },
  problems: [
    {
      problem_id: 1,
      problem_number: 1,
      problem_display: 'Задача 1',
      subproblems: [
        { subproblem_id: 10, subproblem_label: 'а', thread_id: 0, current_status: 'ungraded', being_graded: false },
        { subproblem_id: 11, subproblem_label: 'б', thread_id: 55, current_status: 'rejected', being_graded: false },
      ],
    },
  ],
}

const PAST = '2020-01-01T00:00:00Z'
const FUTURE = '2999-01-01T00:00:00Z'

function sub(over: Partial<Subproblem> & { id: number; label: string }): Subproblem {
  return {
    display: 'Задача 1 (' + over.label + ')',
    is_coffin: false,
    has_solution_tex: false,
    has_solution_pdf: false,
    ...over,
  }
}

function makeSeries(dueAt: string, subproblems: Subproblem[]): Series {
  return {
    id: 7,
    math_center_id: 1,
    number: 1,
    name: 'S',
    display_name: 'Серия 1',
    due_at: dueAt,
    published: true,
    has_pdf: false,
    has_tex: false,
    problems: [{ id: 1, number: 1, display_name: 'Задача 1', subproblems }],
  }
}

function renderList(series: Series) {
  render(
    <MemoryRouter>
      <StudentProblemList centerId={1} seriesId={7} rollup={rollup} series={series} />
    </MemoryRouter>,
  )
}

describe('StudentProblemList — per-subproblem deadline gating', () => {
  // Submission is done by pressing a subproblem's status tile (no "Сдать"
  // button): an untouched-but-open subproblem links to its submit form.
  it('links untouched subproblems to the submit form while open', () => {
    renderList(makeSeries(FUTURE, [sub({ id: 10, label: 'а' }), sub({ id: 11, label: 'б' })]))
    expect(
      document.querySelector('a[href="/mathcenter/1/series/7/submit/10"]'),
    ).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Сдать' })).toBeNull()
  })

  // Regression: after the deadline the student must not be able to start a new
  // submission — the untouched tile is no longer a submit link. The rejected
  // subproblem's thread link stays (to appeal).
  it('disables submission after the deadline but keeps thread links', () => {
    renderList(makeSeries(PAST, [sub({ id: 10, label: 'а' }), sub({ id: 11, label: 'б' })]))
    expect(
      document.querySelector('a[href="/mathcenter/1/series/7/submit/10"]'),
    ).toBeNull()
    // The rejected subproblem keeps its thread link (appeal still possible).
    expect(
      document.querySelector('a[href="/mathcenter/1/series/7/thread/55"]'),
    ).not.toBeNull()
  })

  // Regression: an OPEN coffin stays submittable from the series page past the
  // deadline, even though its sibling normal subproblems are closed.
  it('keeps an open coffin submittable after the deadline', () => {
    renderList(
      makeSeries(PAST, [
        sub({ id: 10, label: 'а', is_coffin: true, released_at: null }),
        sub({ id: 11, label: 'б' }),
      ]),
    )
    expect(
      document.querySelector('a[href="/mathcenter/1/series/7/submit/10"]'),
    ).not.toBeNull()
  })
})
