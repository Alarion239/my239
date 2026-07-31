import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
          sub({ id: 1002, label: 'в', display: 'Задача 1 (в)' }),
        ],
      },
    ],
  }
}

function makeSharedSeries(): Series {
  const series = makeSeries()
  series.problems[0].subproblems[0] = sub({
    id: 1000,
    label: 'а',
    display: 'Задача 1 (а)',
    solution_link: 'https://example.com/shared',
    solution_group_id: 77,
  })
  series.problems[0].subproblems[1] = sub({
    id: 1001,
    label: 'б',
    display: 'Задача 1 (б)',
    solution_link: 'https://example.com/shared',
    solution_group_id: 77,
  })
  return series
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
      {
        problem_id: 1,
        problem_number: 1,
        problem_display: 'Задача 1',
        subproblem_id: 1002,
        subproblem_label: 'в',
        accepted: 0,
        appealed: 0,
        rejected: 0,
        submitted: 0,
        unsolved: 3,
      },
    ],
  }
}

function renderStats(series = makeSeries()) {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <TeacherProblemStats stats={makeStats()} series={series} centerId={7} />
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

describe('TeacherProblemStats — разбор frame', () => {
  afterEach(() => vi.restoreAllMocks())

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

  it('shows a neutral single-card batch action after selecting a problem', async () => {
    renderStats()
    const user = userEvent.setup()
    const bar = screen.getByRole('img', { name: /по задаче Задача 1 \(б\)/ })

    await user.click(bar.closest('[role="button"]') as HTMLElement)

    const attach = screen.getByRole('button', {
      name: 'Прикрепить разбор 1 задачи',
    })
    const clear = screen.getByRole('button', { name: 'Снять выбор задач' })
    expect(attach).toHaveClass('rounded-xl', 'border-line', 'bg-surface', 'text-ink')
    expect(attach).not.toHaveClass('bg-accent-soft', 'text-accent-ink')
    expect(attach.parentElement).toHaveClass('ml-1')
    expect(clear).toHaveClass('h-7', 'w-7', 'rounded-lg')
    expect(screen.queryByText('Выбрано подзадач: 1')).not.toBeInTheDocument()

    await user.click(
      screen
        .getByRole('img', { name: /по задаче Задача 1 \(в\)/ })
        .closest('[role="button"]') as HTMLElement,
    )
    expect(
      screen.getByRole('button', { name: 'Прикрепить разбор 2 задач' }),
    ).toBeInTheDocument()
  })

  it('opens from the card and keeps the close control outside the trigger', async () => {
    renderStats()
    const user = userEvent.setup()
    await user.click(
      screen
        .getByRole('img', { name: /по задаче Задача 1 \(б\)/ })
        .closest('[role="button"]') as HTMLElement,
    )

    const attach = screen.getByRole('button', {
      name: 'Прикрепить разбор 1 задачи',
    })
    await user.click(attach)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    await user.click(screen.getByRole('button', { name: 'Снять выбор задач' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Прикрепить разбор 1 задачи' })).not.toBeInTheDocument()
  })

  it('highlights every problem covered by the selected shared разбор', async () => {
    renderStats(makeSharedSeries())
    const user = userEvent.setup()
    const firstRow = screen
      .getByRole('img', { name: /по задаче Задача 1 \(а\)/ })
      .closest('[role="button"]') as HTMLElement
    const secondRow = screen
      .getByRole('img', { name: /по задаче Задача 1 \(б\)/ })
      .closest('[role="button"]') as HTMLElement
    const unrelatedRow = screen
      .getByRole('img', { name: /по задаче Задача 1 \(в\)/ })
      .closest('[role="button"]') as HTMLElement

    await user.click(firstRow)

    expect(firstRow).toHaveAttribute('aria-pressed', 'true')
    expect(secondRow).toHaveAttribute('aria-pressed', 'true')
    expect(unrelatedRow).toHaveAttribute('aria-pressed', 'false')
    expect(firstRow).toHaveClass('ring-2', 'ring-accent/50')
    expect(secondRow).toHaveClass('ring-2', 'ring-accent/50')

    await user.click(secondRow)

    expect(firstRow).toHaveAttribute('aria-pressed', 'false')
    expect(secondRow).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: 'Редактировать' })).not.toBeInTheDocument()
  })

  it('keeps a shared разбор together when editing it', async () => {
    const request = vi
      .spyOn(ApiClient.prototype, 'request')
      .mockResolvedValue({} as never)
    renderStats(makeSharedSeries())
    const user = userEvent.setup()

    await user.click(
      screen
        .getByRole('img', { name: /по задаче Задача 1 \(а\)/ })
        .closest('[role="button"]') as HTMLElement,
    )
    await user.click(screen.getByRole('button', { name: 'Редактировать' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить ссылку' }))

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        '/mathcenter/subproblems/1000/solution/link',
        {
          method: 'PUT',
          body: { link: 'https://example.com/shared' },
        },
      )
      expect(request).toHaveBeenCalledWith(
        '/mathcenter/subproblems/1001/solution/link',
        {
          method: 'PUT',
          body: { link: 'https://example.com/shared' },
        },
      )
      expect(request).toHaveBeenCalledWith(
        '/mathcenter/subproblem-solutions/group',
        {
          method: 'POST',
          body: { subproblem_ids: [1000, 1001] },
        },
      )
    })
  })
})
