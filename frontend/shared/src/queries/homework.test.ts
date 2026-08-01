import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type {
  CenterGridResponse,
  CenterGridSeriesCellsResponse,
  ThreadView,
} from '../types'
import { applyCenterGridSeriesCells, applyThreadToCenterGrid } from './homework'
import { queryKeys } from './keys'

const grid: CenterGridResponse = {
  groups: [
    {
      group_id: 1,
      name: '16',
      students: [{ user_id: 10, name: 'Иванов Иван' }],
    },
  ],
  series: [
    {
      series_id: 2,
      number: 1,
      name: 'Первая',
      display_name: 'Серия 1',
      due_at: '2026-08-01T00:00:00Z',
      columns: [
        {
          subproblem_id: 20,
          subproblem_label: '',
          problem_id: 3,
          problem_number: 1,
          column_label: '1',
          is_coffin: false,
        },
      ],
    },
  ],
  cells: {},
  graders: {},
}

const acceptedThread: ThreadView = {
  id: 30,
  student_user_id: 10,
  subproblem_id: 20,
  series_id: 2,
  series_due_at: '2026-08-01T00:00:00Z',
  math_center_id: 2099,
  current_status: 'accepted',
  last_grader_name: 'Александр Белоцерковцев',
  created_at: '2026-07-29T00:00:00Z',
  updated_at: '2026-07-29T00:00:01Z',
  events: [],
  users: {},
}

describe('applyThreadToCenterGrid', () => {
  it('keeps an accepted mark visible in a matching term cache', () => {
    const result = applyThreadToCenterGrid(grid, acceptedThread)

    expect(result?.cells['10:20']).toMatchObject({
      thread_id: 30,
      current_status: 'accepted',
      last_grader_name: 'Александр Белоцерковцев',
    })
  })

  it('does not leak a thread into a different term grid', () => {
    const otherTerm = {
      ...grid,
      series: grid.series.map((series) => ({ ...series, columns: [] })),
    }

    expect(applyThreadToCenterGrid(otherTerm, acceptedThread)).toBe(otherTerm)
  })

  it('matches every term-specific center grid through the shared prefix', () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.centerGrid(2099, 5), grid)

    client.setQueriesData<CenterGridResponse>(
      { queryKey: queryKeys.centerGrids(2099) },
      (current) => applyThreadToCenterGrid(current, acceptedThread),
    )

    expect(
      client.getQueryData<CenterGridResponse>(
        queryKeys.centerGrid(2099, 5),
      )?.cells['10:20']?.current_status,
    ).toBe('accepted')
  })
})

describe('applyCenterGridSeriesCells', () => {
  it('replaces only the affected series cells and keeps unrelated cells', () => {
    const oldCell = {
      thread_id: 1,
      current_status: 'ungraded' as const,
    }
    const freshCell = {
      thread_id: 2,
      current_status: 'accepted' as const,
    }
    const snapshot: CenterGridSeriesCellsResponse = {
      series_id: 2,
      cells: { '10:20': freshCell },
      graders: { '8': 'АК' },
    }
    const result = applyCenterGridSeriesCells(
      {
        ...grid,
        cells: { '10:20': oldCell, '10:99': oldCell },
      },
      snapshot,
    )

    expect(result?.cells).toEqual({ '10:20': freshCell, '10:99': oldCell })
    expect(result?.graders).toEqual({ '8': 'АК' })
  })

  it('does not change a grid that does not contain the series', () => {
    const snapshot: CenterGridSeriesCellsResponse = {
      series_id: 999,
      cells: {},
      graders: {},
    }
    expect(applyCenterGridSeriesCells(grid, snapshot)).toBe(grid)
  })
})
