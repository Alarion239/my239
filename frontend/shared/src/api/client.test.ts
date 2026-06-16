import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from './client'
import type { TokenStore } from '../ports/token-store'

// An in-memory TokenStore so tests don't touch any platform storage.
function memoryStore(initial: string | null = null): TokenStore {
  let token = initial
  return {
    getRefreshToken: async () => token,
    setRefreshToken: async (t) => {
      token = t
    },
    clear: async () => {
      token = null
    },
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const BASE = 'http://test.local/api/v1'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ApiClient 401 -> refresh -> retry', () => {
  it('refreshes the access token on 401 and retries the original request', async () => {
    const store = memoryStore('refresh-1')
    const client = new ApiClient({ baseURL: BASE, tokenStore: store })

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      // 1) original /auth/me with no access token yet -> 401
      .mockResolvedValueOnce(jsonResponse(401, { code: 'unauthenticated', error: 'no token' }))
      // 2) /auth/refresh -> new pair
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          token_type: 'Bearer',
          expires_in: 900,
        }),
      )
      // 3) retried /auth/me with the fresh access token -> the user
      .mockResolvedValueOnce(jsonResponse(200, { id: 1, username: 'ivan' }))

    const user = await client.me()

    expect(user).toMatchObject({ id: 1, username: 'ivan' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    // The refresh rotated the stored token.
    expect(await store.getRefreshToken()).toBe('refresh-2')
    // The retry carried the new bearer token.
    const retryInit = fetchMock.mock.calls[2][1] as RequestInit
    expect((retryInit.headers as Record<string, string>)['Authorization']).toBe('Bearer access-2')
  })

  it('clears the session and returns null from meOrNull when refresh fails', async () => {
    const store = memoryStore('refresh-dead')
    const client = new ApiClient({ baseURL: BASE, tokenStore: store })

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { code: 'unauthenticated' })) // /auth/me
      .mockResolvedValueOnce(jsonResponse(401, { code: 'token_invalid' })) // /auth/refresh

    const user = await client.meOrNull()

    expect(user).toBeNull()
    expect(await store.getRefreshToken()).toBeNull()
  })

  it('does not attempt a refresh when there is no stored refresh token', async () => {
    const store = memoryStore(null)
    const client = new ApiClient({ baseURL: BASE, tokenStore: store })

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { code: 'unauthenticated' }))

    const user = await client.meOrNull()

    expect(user).toBeNull()
    // Only the original /auth/me — no /auth/refresh call.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('ApiClient.login', () => {
  it('stores the refresh token and returns the user', async () => {
    const store = memoryStore(null)
    const client = new ApiClient({ baseURL: BASE, tokenStore: store })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(200, {
        access_token: 'a',
        refresh_token: 'r',
        token_type: 'Bearer',
        expires_in: 900,
        user: { id: 7, username: 'masha' },
      }),
    )

    const user = await client.login({ username: 'masha', password: 'secret123' })

    expect(user).toMatchObject({ id: 7, username: 'masha' })
    expect(await store.getRefreshToken()).toBe('r')
  })
})
