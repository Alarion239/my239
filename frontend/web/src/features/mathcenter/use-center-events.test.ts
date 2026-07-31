import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { queryKeys } from '@my239/shared'
import { handleCenterEvent, refreshCenterViews } from './use-center-events'

function queryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function seed(client: QueryClient, key: readonly unknown[]): void {
  client.setQueryData(key, { loaded: true })
}

describe('center live events', () => {
  it('refreshes both the center conduit and shared phone queue after grading', () => {
    const client = queryClient()
    const conduitKey = queryKeys.centerGrid(2, 1)
    const sharedQueueKey = queryKeys.graderQueue(7, false)
    const personalQueueKey = queryKeys.graderQueue(7, true)
    seed(client, conduitKey)
    seed(client, sharedQueueKey)
    seed(client, personalQueueKey)

    handleCenterEvent(
      client,
      2,
      'grading',
      JSON.stringify({ series_id: 7 }),
    )

    expect(client.getQueryState(conduitKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(sharedQueueKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(personalQueueKey)?.isInvalidated).toBe(true)
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
