import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiClient, ApiClientProvider, type TokenStore } from '@my239/shared'
import { StudentsTab } from './students-tab'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

function renderTab() {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <StudentsTab centerId={7} />
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('StudentsTab razbor access', () => {
  it('starts open and sends an explicit restriction for one student', async () => {
    const patches: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (
          url.endsWith('/manage/students') &&
          (!init?.method || init.method === 'GET')
        ) {
          return Response.json([
            {
              id: 11,
              user_id: 55,
              group_id: 3,
              group_name: 'А',
              can_view_razbors: true,
              first_name: 'Аня',
              middle_name: null,
              last_name: 'Иванова',
            },
          ])
        }
        if (url.endsWith('/manage/groups')) {
          return Response.json([
            { id: 3, math_center_id: 7, name: 'А', created_at: '2026-01-01' },
          ])
        }
        if (url.endsWith('/students/11/razbor-access') && init?.method === 'PATCH') {
          patches.push(JSON.parse(String(init.body)))
          return new Response(null, { status: 204 })
        }
        return Response.json([])
      }),
    )

    renderTab()
    const user = userEvent.setup()
    const access = await screen.findByRole('switch', {
      name: 'Закрыть доступ к разборам для Аня Иванова',
    })
    expect(access).toHaveAttribute('aria-checked', 'true')

    await user.click(access)

    await waitFor(() =>
      expect(patches).toEqual([{ can_view_razbors: false }]),
    )
  })
})
