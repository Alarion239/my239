import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { MyRollup } from '@my239/shared'
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

function renderList(closed: boolean) {
  render(
    <MemoryRouter>
      <StudentProblemList centerId={1} seriesId={7} rollup={rollup} closed={closed} />
    </MemoryRouter>,
  )
}

describe('StudentProblemList — deadline gating', () => {
  it('keeps "Сдать" active and links untouched subproblems while open', () => {
    renderList(false)
    const submit = screen.getByRole('link', { name: 'Сдать' })
    expect(submit).toHaveAttribute('href', '/mathcenter/1/series/7/submit/10')
    // Untouched subproblem 'а' links to the submit form.
    expect(
      document.querySelector('a[href="/mathcenter/1/series/7/submit/10"]'),
    ).not.toBeNull()
  })

  // Regression: after the deadline the student must not be able to start a new
  // submission — "Сдать" is disabled and the untouched tile is no longer a
  // submit link. The rejected subproblem's thread link stays (to appeal).
  it('disables submission after the deadline but keeps thread links', () => {
    renderList(true)
    const submit = screen.getByRole('button', { name: 'Сдать' })
    expect(submit).toBeDisabled()
    expect(
      document.querySelector('a[href="/mathcenter/1/series/7/submit/10"]'),
    ).toBeNull()
    // The rejected subproblem keeps its thread link (appeal still possible).
    expect(
      document.querySelector('a[href="/mathcenter/1/series/7/thread/55"]'),
    ).not.toBeNull()
  })
})
