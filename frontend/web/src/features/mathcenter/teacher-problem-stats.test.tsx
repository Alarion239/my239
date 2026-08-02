import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
    solution_published_at: null,
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
          sub({ id: 1000, label: 'а', display: 'Задача 1 (а)', has_solution_tex: true, solution_published_at: '2030-01-01T00:00:00Z' }),
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
    expect(rowWith.className).toContain('bg-status-accepted-soft')
    expect(rowWithout.className).not.toContain('bg-status-accepted-soft')
  })

  it('opens the editing workbench immediately from an empty problem', async () => {
    renderStats()
    const user = userEvent.setup()
    const bar = screen.getByRole('img', { name: /по задаче Задача 1 \(б\)/ })

    await user.click(bar.closest('[role="button"]') as HTMLElement)

    expect(screen.getByRole('region', { name: /Задача 1 \(б\)/ })).toBeInTheDocument()
    expect(screen.queryByText(/Прикрепить разбор/)).not.toBeInTheDocument()

    await user.click(
      screen
        .getByRole('img', { name: /по задаче Задача 1 \(в\)/ })
        .closest('[role="button"]') as HTMLElement,
    )
    expect(screen.getByRole('region', { name: /Задачи 1/ })).toBeInTheDocument()
    const added = screen.getByRole('img', { name: /по задаче Задача 1 \(в\)/ }).closest('[role="button"]') as HTMLElement
    expect(added).toHaveClass('ring-2', 'ring-accent/50')

    await user.click(added)
    expect(added).toHaveAttribute('aria-pressed', 'false')
    expect(added).not.toHaveClass('ring-2', 'ring-accent/50')
    expect(screen.getByRole('region', { name: /Задача 1 \(б\)/ })).toBeInTheDocument()

    await user.click(
      screen
        .getByRole('img', { name: /по задаче Задача 1 \(б\)/ })
        .closest('[role="button"]') as HTMLElement,
    )
    expect(screen.queryByRole('region', { name: /Задача 1 \(б\)/ })).not.toBeInTheDocument()
  })

  it('dismisses the replacement warning on a row click and replaces only from its action', async () => {
    const request = vi.spyOn(ApiClient.prototype, 'request').mockResolvedValue({} as never)
    renderStats()
    const user = userEvent.setup()
    await user.click(
      screen
        .getByRole('img', { name: /по задаче Задача 1 \(б\)/ })
        .closest('[role="button"]') as HTMLElement,
    )
    const existing = screen
      .getByRole('img', { name: /по задаче Задача 1 \(а\)/ })
      .closest('[role="button"]') as HTMLElement

    await user.click(existing)
    expect(screen.getByRole('alert')).toHaveTextContent('прежней группы')
    expect(screen.getByRole('button', { name: 'Добавить в текущий разбор' })).toBeInTheDocument()
    expect(existing).not.toHaveClass('ring-2', 'ring-accent/50')

    request.mockClear()
    await user.click(existing)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(existing).not.toHaveClass('ring-2', 'ring-accent/50')
    expect(request).not.toHaveBeenCalled()

    await user.click(existing)
    await user.click(screen.getByRole('button', { name: 'Добавить в текущий разбор' }))
    expect(existing).toHaveClass('ring-2', 'ring-accent/50')
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('/mathcenter/subproblem-solutions/group', {
        method: 'POST',
        body: { subproblem_ids: [1001, 1000] },
      })
    })
  })

  it('opens the inline workbench and keeps the close control outside the trigger', async () => {
    renderStats()
    const user = userEvent.setup()
    await user.click(
      screen
        .getByRole('img', { name: /по задаче Задача 1 \(б\)/ })
        .closest('[role="button"]') as HTMLElement,
    )

    expect(screen.getByRole('region', { name: 'Задача 1 (б)' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('region', { name: /Задача 1 \(б\)/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Прикрепить разбор/)).not.toBeInTheDocument()
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

    const workbench = screen.getByRole('region', { name: 'Задачи 1' })
    const title = within(workbench).getByRole('heading', { name: 'Задачи 1' })
    const header = title.closest('header') as HTMLElement
    const formatTabs = within(workbench).getByRole('tablist', { name: 'Формат разбора' })
    const edit = within(workbench).getByRole('button', { name: 'Редактировать' })

    expect(header).toContainElement(formatTabs)
    expect(header).toContainElement(edit)
    expect(edit).toHaveTextContent('')
    expect(edit.querySelector('svg')).not.toBeNull()
    expect(within(workbench).queryByText(/Общий разбор|Подзадач в группе|^Просмотр$/)).not.toBeInTheDocument()

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
    const link = screen.getByRole('textbox', { name: 'Ссылка на видео' })
    await user.clear(link)
    await user.type(link, 'https://example.com/updated')

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        '/mathcenter/subproblems/1000/solution/link',
        {
          method: 'PUT',
          body: { link: 'https://example.com/updated' },
        },
      )
      expect(request).toHaveBeenCalledWith(
        '/mathcenter/subproblems/1001/solution/link',
        {
          method: 'PUT',
          body: { link: 'https://example.com/updated' },
        },
      )
      expect(request).toHaveBeenCalledWith(
        '/mathcenter/subproblem-solutions/group',
        {
          method: 'POST',
          body: { subproblem_ids: [1000, 1001] },
        },
      )
    }, { timeout: 3000 })
  })
})
