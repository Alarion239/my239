import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { CenterGridResponse } from '@my239/shared'
import { ConduitTable } from './conduit-page'

vi.mock('@my239/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@my239/shared')>()
  return {
    ...actual,
    useOfflineAccept: () => ({ mutate: vi.fn() }),
    useOfflineUndo: () => ({ mutate: vi.fn() }),
    useSyncGoogleSheets: () => ({ mutate: vi.fn(), isPending: false }),
  }
})

const data: CenterGridResponse = {
  groups: [
    {
      group_id: 1,
      name: '16',
      students: [
        { user_id: 10, name: 'Первый Ученик' },
        { user_id: 20, name: 'Второй Ученик' },
      ],
    },
  ],
  series: [
    {
      series_id: 100,
      number: 1,
      name: 'Серия 1',
      display_name: 'Серия 1',
      due_at: '2099-01-01T00:00:00Z',
      columns: [
        {
          subproblem_id: 1001,
          subproblem_label: '',
          problem_id: 501,
          problem_number: 1,
          column_label: '1',
          is_coffin: false,
        },
        {
          subproblem_id: 1002,
          subproblem_label: '',
          problem_id: 502,
          problem_number: 2,
          column_label: '2',
          is_coffin: false,
        },
        {
          subproblem_id: 1003,
          subproblem_label: '',
          problem_id: 503,
          problem_number: 3,
          column_label: '3',
          is_coffin: false,
        },
      ],
    },
  ],
  cells: {
    '10:1001': {
      thread_id: 1,
      current_status: 'accepted',
      last_grader_name: 'Анна А',
    },
    '20:1001': {
      thread_id: 2,
      current_status: 'accepted',
      last_grader_name: 'Борис Б',
    },
    '20:1002': {
      thread_id: 3,
      current_status: 'accepted',
      last_grader_name: 'Борис Б',
    },
  },
  graders: {},
}

function renderConduit(grid: CenterGridResponse = data) {
  return render(
    <MemoryRouter initialEntries={['/mathcenter/2099/conduit?term_id=1']}>
      <Routes>
        <Route
          path="/mathcenter/:year/conduit"
          element={<ConduitTable centerId={2} termId={1} data={grid} />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

function dataWithStudentCount(count: number): CenterGridResponse {
  return {
    ...data,
    groups: [
      {
        group_id: 1,
        name: '16',
        students: Array.from({ length: count }, (_, index) => ({
          user_id: index + 1,
          name: `Ученик ${String(index + 1).padStart(3, '0')}`,
        })),
      },
    ],
    cells: {},
  }
}

function dataWithColumnCount(count: number): CenterGridResponse {
  return {
    ...data,
    series: [
      {
        ...data.series[0],
        columns: Array.from({ length: count }, (_, index) => ({
          subproblem_id: 1000 + index,
          subproblem_label: '',
          problem_id: 500 + index,
          problem_number: index + 1,
          column_label: String(index + 1),
          is_coffin: false,
        })),
      },
    ],
    cells: {},
  }
}

function exerciseGateData(): CenterGridResponse {
  return {
    ...data,
    series: [
      {
        ...data.series[0],
        columns: [
          {
            subproblem_id: 990,
            subproblem_label: '',
            problem_id: 590,
            problem_number: 0,
            column_label: 'У',
            is_coffin: false,
          },
          {
            subproblem_id: 991,
            subproblem_label: 'a',
            problem_id: 590,
            problem_number: 0,
            column_label: 'Уa',
            is_coffin: false,
          },
          {
            subproblem_id: 1001,
            subproblem_label: '',
            problem_id: 501,
            problem_number: 1,
            column_label: '1',
            is_coffin: false,
          },
        ],
      },
    ],
    cells: {
      '10:990': { thread_id: 90, current_status: 'accepted' },
      '10:991': { thread_id: 91, current_status: 'submitted' },
      '10:1001': { thread_id: 11, current_status: 'accepted' },
      '20:990': { thread_id: 92, current_status: 'accepted' },
      '20:991': { thread_id: 93, current_status: 'accepted' },
      '20:1001': { thread_id: 12, current_status: 'accepted' },
    },
  }
}

function rankingData(): CenterGridResponse {
  return {
    ...data,
    groups: [
      {
        group_id: 1,
        name: '16',
        students: [
          { user_id: 10, name: 'Анна' },
          { user_id: 20, name: 'Борис' },
        ],
      },
      {
        group_id: 2,
        name: '17',
        students: [
          { user_id: 30, name: 'Вера' },
          { user_id: 40, name: 'Глеб' },
        ],
      },
    ],
    cells: {
      '10:1001': { thread_id: 1, current_status: 'accepted' },
      '10:1002': { thread_id: 2, current_status: 'accepted' },
      '10:1003': { thread_id: 3, current_status: 'accepted' },
      '30:1001': { thread_id: 4, current_status: 'accepted' },
      '40:1001': { thread_id: 5, current_status: 'accepted' },
      '40:1002': { thread_id: 6, current_status: 'accepted' },
    },
  }
}

function renderedStudentNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('tbody a')).map(
    (link) => link.textContent ?? '',
  )
}

describe('ConduitTable', () => {
  it('uses the table cells themselves as controls and sorts existing rows', () => {
    const { container } = renderConduit()

    const taskCells = container.querySelectorAll('td[data-conduit-cell]')
    expect(taskCells).toHaveLength(6)
    expect(container.querySelectorAll('tbody button')).toHaveLength(0)

    const sort = screen.getByRole('button', {
      name: 'Сортировать учеников по числу решённых задач',
    })
    fireEvent.click(sort)

    expect(renderedStudentNames(container)).toEqual([
      'Второй Ученик',
      'Первый Ученик',
    ])
  })

  it('links series to its statement and problems to its razbor', () => {
    renderConduit()

    expect(
      screen.getByRole('link', {
        name: 'Серия 1 — открыть условие',
      }),
    ).toHaveAttribute(
      'href',
      '/mathcenter/2099/series/100/statement?term_id=1',
    )
    expect(
      screen.getByRole('link', {
        name: 'Задача 1 — открыть разбор',
      }),
    ).toHaveAttribute(
      'href',
      '/mathcenter/2099/series/100/razbor?term_id=1',
    )
  })

  it('switches groups on one line and offers a center-wide rating', () => {
    const { container } = renderConduit(rankingData())
    const sort = screen.getByRole('button', {
      name: 'Сортировать учеников по числу решённых задач',
    })

    const group16 = screen.getByRole('button', { name: 'Группа 16' })
    const group17 = screen.getByRole('button', { name: 'Группа 17' })
    expect(group16).toHaveAttribute('aria-pressed', 'true')
    expect(group17).toHaveAttribute('aria-pressed', 'false')
    expect(renderedStudentNames(container)).toEqual(['Анна', 'Борис'])

    fireEvent.click(group17)
    expect(group17).toHaveAttribute('aria-pressed', 'true')
    expect(renderedStudentNames(container)).toEqual(['Вера', 'Глеб'])

    // First click: descending rating in the selected group.
    fireEvent.click(sort)
    expect(renderedStudentNames(container)).toEqual(['Глеб', 'Вера'])

    // The same selector line exposes one center-wide rating.
    const centerRating = screen.getByRole('button', { name: 'Общий рейтинг' })
    fireEvent.click(centerRating)
    expect(renderedStudentNames(container)).toEqual([
      'Анна',
      'Глеб',
      'Вера',
      'Борис',
    ])
    expect(centerRating).toHaveAttribute('aria-pressed', 'true')

    // Choosing a group exits the center-wide view; cycling restores alphabetic.
    fireEvent.click(group16)
    fireEvent.click(sort)
    expect(renderedStudentNames(container)).toEqual(['Борис', 'Анна'])

    fireEvent.click(sort)
    expect(renderedStudentNames(container)).toEqual(['Анна', 'Борис'])
    expect(
      screen.queryByRole('button', { name: 'Общий рейтинг' }),
    ).not.toBeInTheDocument()
  })

  it('activates an unsolved cell with mouse or keyboard without a nested button', () => {
    const { container } = renderConduit()
    const firstStudent = screen.getByRole('link', { name: 'Первый Ученик' })
      .closest('tr')
    expect(firstStudent).not.toBeNull()

    const emptyCells = within(firstStudent!).getAllByLabelText(
      'Отметить решённым',
    )
    fireEvent.click(emptyCells[0])
    expect(firstStudent).toHaveTextContent('＋')

    fireEvent.keyDown(emptyCells[1], { key: 'Enter' })
    expect(container.querySelectorAll('td[data-conduit-cell]')).toHaveLength(6)
  })

  it('color-codes submitted and appealed cells, including active claims', () => {
    const pendingData: CenterGridResponse = {
      ...data,
      cells: {
        '10:1001': {
          thread_id: 1,
          current_status: 'submitted',
        },
        '10:1002': {
          thread_id: 2,
          current_status: 'appealed',
        },
        '10:1003': {
          thread_id: 3,
          current_status: 'submitted',
          claim_holder_user_id: 99,
          claim_expires_at: '2999-01-01T00:00:00Z',
        },
      },
    }
    renderConduit(pendingData)

    const row = screen.getByRole('link', { name: 'Первый Ученик' }).closest('tr')
    expect(row).not.toBeNull()

    const submitted = within(row!).getByLabelText(
      'В очереди. Отметить решённым',
    )
    expect(submitted).toHaveTextContent('…')
    expect(submitted).toHaveClass(
      'bg-status-checking-soft',
      'text-status-checking',
    )

    const appealed = within(row!).getByLabelText(
      'Апелляция в очереди. Отметить решённым',
    )
    expect(appealed).toHaveTextContent('?')
    expect(appealed).toHaveClass(
      'bg-status-appeal-soft',
      'text-status-appeal',
    )

    const claimed = within(row!).getByLabelText(
      'На проверке. Отметить решённым',
    )
    expect(claimed).toHaveTextContent('◐')
    expect(claimed).toHaveClass(
      'bg-status-grading-soft',
      'text-status-grading',
    )
  })

  it('gates regular credit and totals on the exercise while keeping cells active', () => {
    const { container } = renderConduit(exerciseGateData())
    const firstRow = screen.getByRole('link', { name: 'Первый Ученик' }).closest('tr')!
    const secondRow = screen.getByRole('link', { name: 'Второй Ученик' }).closest('tr')!
    const firstCells = firstRow.querySelectorAll('td[data-conduit-cell]')

    expect(screen.getByRole('link', { name: 'Упражнение У — открыть разбор' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Упражнение Уa — открыть разбор' })).toBeInTheDocument()
    expect(firstCells[0]).toHaveClass('bg-selected/70')
    expect(firstCells[2]).toHaveClass('bg-surface-subtle')
    expect(firstCells[2]).not.toHaveAttribute('aria-disabled')
    expect(firstRow.lastElementChild).toHaveTextContent('0')
    expect(secondRow.lastElementChild).toHaveTextContent('1')

    const totals = Array.from(container.querySelectorAll('tbody tr')).find((row) =>
      row.textContent?.startsWith('Решили'),
    )!
    const totalCells = totals.querySelectorAll('td')
    expect(totalCells[1]).toHaveTextContent('2')
    expect(totalCells[2]).toHaveTextContent('1')
    expect(totalCells[3]).toHaveTextContent('1')
    expect(totalCells[4]).toHaveTextContent('1')
  })

  it('mounts only the visible window for a large student list', () => {
    const largeData = dataWithStudentCount(80)
    const { container } = render(
      <MemoryRouter initialEntries={['/mathcenter/2099/conduit?term_id=1']}>
        <Routes>
          <Route
            path="/mathcenter/:year/conduit"
            element={
              <ConduitTable centerId={2} termId={1} data={largeData} />
            }
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(
      container.querySelectorAll('td[data-conduit-cell]').length,
    ).toBeLessThan(80 * 3)
    expect(
      container.querySelector('[data-conduit-virtual-spacer="bottom"]'),
    ).not.toBeNull()
    expect(
      screen.queryByRole('link', { name: 'Ученик 080' }),
    ).not.toBeInTheDocument()
  })

  it('mounts only the visible task columns in student rows', () => {
    const wideData = dataWithColumnCount(100)
    const { container } = render(
      <MemoryRouter initialEntries={['/mathcenter/2099/conduit?term_id=1']}>
        <Routes>
          <Route
            path="/mathcenter/:year/conduit"
            element={<ConduitTable centerId={2} termId={1} data={wideData} />}
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(
      container.querySelectorAll('td[data-conduit-cell]').length,
    ).toBeLessThan(100 * 2)
    expect(
      container.querySelector('[data-conduit-column-spacer="right"]'),
    ).not.toBeNull()
  })
})
