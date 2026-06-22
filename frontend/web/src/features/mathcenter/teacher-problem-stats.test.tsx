import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ApiClient,
  ApiClientProvider,
  type Series,
  type SeriesProblemStats,
  type Subproblem,
  type TokenStore,
} from '@my239/shared'
import { TeacherProblemStats } from './teacher-problem-stats'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

function sub(overrides: Partial<Subproblem> & Pick<Subproblem, 'id'>): Subproblem {
  return {
    label: 'а',
    display: 'Задача 1 (а)',
    is_coffin: false,
    has_solution_tex: false,
    has_solution_pdf: false,
    solution_link: null,
    solution_group_id: null,
    ...overrides,
  }
}

// One problem with two subproblems: the first carries a разбор, the second does
// not — so we can compare the framed vs unframed rows.
function makeSeries(): Series {
  return {
    id: 42,
    math_center_id: 7,
    number: 1,
    name: 'Тест',
    display_name: 'Серия 1. Тест',
    due_at: '2030-01-01T12:00:00Z',
    published: true,
    has_pdf: false,
    has_tex: false,
    problems: [
      {
        id: 1,
        number: 1,
        display_name: 'Задача 1',
        subproblems: [
          sub({ id: 1000, label: 'а', display: 'Задача 1 (а)', has_solution_tex: true }),
          sub({ id: 1001, label: 'б', display: 'Задача 1 (б)' }),
        ],
      },
    ],
  }
}

function makeStats(): SeriesProblemStats {
  return {
    total_students: 3,
    problems: [
      {
        problem_id: 1,
        problem_number: 1,
        problem_display: 'Задача 1',
        subproblem_id: 1000,
        subproblem_label: 'а',
        accepted: 1,
        appealed: 0,
        rejected: 0,
        submitted: 0,
        unsolved: 2,
      },
      {
        problem_id: 1,
        problem_number: 1,
        problem_display: 'Задача 1',
        subproblem_id: 1001,
        subproblem_label: 'б',
        accepted: 0,
        appealed: 0,
        rejected: 0,
        submitted: 1,
        unsolved: 2,
      },
    ],
  }
}

function renderStats() {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <TeacherProblemStats stats={makeStats()} series={makeSeries()} centerId={7} />
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

describe('TeacherProblemStats — разбор frame', () => {
  it('puts a green frame on rows whose subproblem has a разбор, not on others', () => {
    renderStats()
    // The distribution bar carries a per-row aria-label; the row is its closest
    // [role=button] ancestor.
    const barWith = screen.getByRole('img', { name: /по задаче Задача 1 \(а\)/ })
    const barWithout = screen.getByRole('img', { name: /по задаче Задача 1 \(б\)/ })
    const rowWith = barWith.closest('[role="button"]') as HTMLElement
    const rowWithout = barWithout.closest('[role="button"]') as HTMLElement
    expect(rowWith.className).toContain('border-status-accepted')
    expect(rowWithout.className).not.toContain('border-status-accepted')
  })
})
