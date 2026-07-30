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
})
