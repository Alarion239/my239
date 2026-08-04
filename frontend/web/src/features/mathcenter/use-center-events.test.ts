import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { queryKeys, type ApiClient, type CenterGridResponse } from '@my239/shared'
import {
  handleCenterEvent,
  refreshCenterViews,
  SeriesRefreshQueue,
} from './use-center-events'

function queryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function seed(client: QueryClient, key: readonly unknown[]): void {
  client.setQueryData(key, { loaded: true })
}

describe('center live events', () => {
  it('refreshes only the affected series and the shared phone queue after grading', () => {
    const client = queryClient()
    const conduitKey = queryKeys.centerGrid(2, 1)
    const sharedQueueKey = queryKeys.graderQueue(7, false)
    const personalQueueKey = queryKeys.graderQueue(7, true)
    seed(client, conduitKey)
    seed(client, sharedQueueKey)
    seed(client, personalQueueKey)

    const refreshSeries = vi.fn()
    handleCenterEvent(client, 2, 'grading', JSON.stringify({ series_id: 7 }), refreshSeries)

    expect(refreshSeries).toHaveBeenCalledWith(7)
    expect(client.getQueryState(conduitKey)?.isInvalidated).not.toBe(true)
    expect(client.getQueryState(sharedQueueKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(personalQueueKey)?.isInvalidated).toBe(true)
  })

  it('keeps student-level comment events on the full-grid path', () => {
    const client = queryClient()
    const conduitKey = queryKeys.centerGrid(2, 1)
    seed(client, conduitKey)

    handleCenterEvent(client, 2, 'comments', JSON.stringify({ student_id: 9 }))

    expect(client.getQueryState(conduitKey)?.isInvalidated).toBe(true)
  })

  it('invalidates teacher name surfaces after a color change', () => {
    const client = queryClient()
    const profileKey = queryKeys.studentProfile(2, 9)
    const gridKey = queryKeys.centerGrids(2)
    const rosterKey = queryKeys.manageRosterBoard(2)
    const queueKey = queryKeys.coffinQueue(2)
    seed(client, profileKey)
    seed(client, gridKey)
    seed(client, rosterKey)
    seed(client, queueKey)

    handleCenterEvent(client, 2, 'student_name_color', JSON.stringify({ student_user_id: 9 }))

    expect(client.getQueryState(profileKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(gridKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(rosterKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(queueKey)?.isInvalidated).toBe(true)
  })

  it('coalesces rapid refreshes and runs one trailing request', async () => {
    const client = queryClient()
    const gridKey = queryKeys.centerGrid(2, 1)
    const grid: CenterGridResponse = {
      groups: [],
      series: [
        {
          series_id: 7,
          number: 1,
          name: 'S',
          display_name: 'S',
          due_at: '2026-08-01T00:00:00Z',
          columns: [
            {
              subproblem_id: 70,
              subproblem_label: '',
              problem_id: 1,
              problem_number: 1,
              column_label: '1',
              is_coffin: false,
            },
          ],
        },
      ],
      cells: {
        '9:70': { thread_id: 1, current_status: 'ungraded' },
      },
      graders: {},
    }
    client.setQueryData(gridKey, grid)
    const responses: Array<(value: unknown) => void> = []
    const request = vi.fn(
      () => new Promise((resolve) => responses.push(resolve)),
    )
    const queue = new SeriesRefreshQueue(
      client,
      { request } as unknown as ApiClient,
      2,
    )

    queue.schedule(7)
    queue.schedule(7)
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(1)

    responses[0]({
      series_id: 7,
      cells: { '9:70': { thread_id: 2, current_status: 'accepted' } },
      graders: {},
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))

    responses[1]({
      series_id: 7,
      cells: { '9:70': { thread_id: 3, current_status: 'accepted' } },
      graders: {},
    })
    await vi.waitFor(() =>
      expect(client.getQueryData<CenterGridResponse>(gridKey)?.cells['9:70']?.thread_id).toBe(3),
    )

    expect(client.getQueryData<CenterGridResponse>(gridKey)?.cells['9:70']?.thread_id).toBe(3)
    queue.dispose()
  })

  it('catches up active center views after a hidden-tab pause', () => {
    const client = queryClient()
    const conduitKey = queryKeys.centerGrid(2, 1)
    const sharedQueueKey = queryKeys.graderQueue(7, false)
    seed(client, conduitKey)
    seed(client, sharedQueueKey)

    refreshCenterViews(client, 2)

    expect(client.getQueryState(conduitKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(sharedQueueKey)?.isInvalidated).toBe(true)
  })

  it('refreshes the active term and open solution previews after posting a разбор', () => {
    const client = queryClient()
    const coffinsKey = queryKeys.centerCoffins(2, 71)
    const seriesKey = queryKeys.seriesList(2, 71)
    const seriesDetailKey = queryKeys.series(101)
    const accessKey = queryKeys.manageStudentRazborAccess(2, 11)
    const texKey = queryKeys.subproblemSolutionTex(900)
    seed(client, coffinsKey)
    seed(client, seriesKey)
    seed(client, seriesDetailKey)
    seed(client, accessKey)
    seed(client, texKey)

    handleCenterEvent(client, 2, 'coffins', '{"center_id":2}')

    expect(client.getQueryState(coffinsKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(seriesKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(seriesDetailKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(accessKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(texKey)?.isInvalidated).toBe(true)
  })
})
