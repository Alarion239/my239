import { afterEach, describe, expect, it, vi } from 'vitest'
import { openEventStream } from './sse'

// streamResponse builds a Response whose body streams the given chunks, so the
// reader exercises the same ReadableStream/TextDecoder path as production.
function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('openEventStream', () => {
  it('parses event/data frames and ignores comment (heartbeat) lines', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      streamResponse([
        ': connected\n\n',
        'event: grading\ndata: {"center_id":7,"kind":"grading","series_id":42}\n\n',
        ': ping\n\n',
        'event: coffins\ndata: {"center_id":7,"kind":"coffins"}\n\n',
      ]),
    )

    const events: Array<[string, string]> = []
    const controller = new AbortController()

    await openEventStream({
      url: 'http://test.local/api/v1/mathcenter/centers/7/events',
      getToken: () => 'access-1',
      refresh: async () => null,
      onEvent: (kind, data) => {
        events.push([kind, data])
        // Stop after we've seen both real frames so the loop doesn't reconnect.
        if (events.length === 2) controller.abort()
      },
      signal: controller.signal,
    })

    expect(events).toEqual([
      ['grading', '{"center_id":7,"kind":"grading","series_id":42}'],
      ['coffins', '{"center_id":7,"kind":"coffins"}'],
    ])
  })

  it('attaches the bearer token and refreshes once on 401', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(
        streamResponse([
          'event: membership\ndata: {"center_id":7,"kind":"membership"}\n\n',
        ]),
      )

    const controller = new AbortController()
    const refresh = vi.fn(async () => 'access-2')
    const events: Array<[string, string]> = []

    await openEventStream({
      url: 'http://test.local/api/v1/mathcenter/centers/7/events',
      getToken: () => 'access-1',
      refresh,
      onEvent: (kind, data) => {
        events.push([kind, data])
        controller.abort()
      },
      signal: controller.signal,
    })

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(events).toEqual([
      ['membership', '{"center_id":7,"kind":"membership"}'],
    ])
    // First attempt carried the original bearer token.
    const firstInit = fetchMock.mock.calls[0][1] as RequestInit
    expect((firstInit.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer access-1',
    )
  })
})
