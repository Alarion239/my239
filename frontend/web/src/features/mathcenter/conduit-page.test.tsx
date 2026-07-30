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

function renderConduit() {
  return render(
    <MemoryRouter initialEntries={['/mathcenter/2099/conduit?term_id=1']}>
      <Routes>
        <Route
          path="/mathcenter/:year/conduit"
          element={<ConduitTable centerId={2} termId={1} data={data} />}
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

describe('ConduitTable', () => {
  it('uses the table cells themselves as controls and sorts existing rows', () => {
    const { container } = renderConduit()

    const taskCells = container.querySelectorAll('td[data-conduit-cell]')
    expect(taskCells).toHaveLength(6)
    expect(container.querySelectorAll('tbody button')).toHaveLength(0)

    const sort = screen.getByRole('button', {
      name: 'Сортировать учеников каждой группы по числу решённых задач',
    })
    fireEvent.click(sort)

    const studentLinks = screen.getAllByRole('link')
    expect(studentLinks.map((link) => link.textContent)).toEqual([
      'Второй Ученик',
      'Первый Ученик',
    ])
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
})
