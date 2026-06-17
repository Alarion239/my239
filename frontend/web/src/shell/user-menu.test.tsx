import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ApiClient,
  ApiClientProvider,
  type MeResponse,
  type TokenStore,
  type User,
} from '@my239/shared'
import { AuthProvider } from '../auth/auth-context'
import { ImpersonationProvider } from '../auth/impersonation-context'
import { UserMenu } from './user-menu'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

function makeUser(overrides: Partial<User>): User {
  return {
    id: 1,
    username: 'ivanov',
    first_name: 'Иван',
    middle_name: null,
    last_name: 'Иванов',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    is_admin: false,
    is_math_center: false,
    ...overrides,
  }
}

// Mock fetch so the auth + math-center queries resolve deterministically.
function mockFetch(me: User, mathCenter: MeResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/auth/me')) {
        return new Response(JSON.stringify(me), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/mathcenter/me')) {
        return new Response(JSON.stringify(mathCenter), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
}

function renderUserMenu(user: User) {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <ImpersonationProvider>
          <AuthProvider>
            <MemoryRouter>
              <UserMenu user={user} />
            </MemoryRouter>
          </AuthProvider>
        </ImpersonationProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('UserMenu — admin "View as"', () => {
  it('shows the impersonation control for an admin', async () => {
    const admin = makeUser({ is_admin: true })
    mockFetch(admin, {})
    renderUserMenu(admin)

    const trigger = screen.getByRole('button', { name: 'Меню пользователя' })
    await userEvent.click(trigger)

    expect(
      await screen.findByRole('menuitem', { name: 'Просмотр от имени…' }),
    ).toBeInTheDocument()
  })

  it('does not show the impersonation control for a non-admin', async () => {
    const member = makeUser({ is_admin: false })
    mockFetch(member, {})
    renderUserMenu(member)

    const trigger = screen.getByRole('button', { name: 'Меню пользователя' })
    await userEvent.click(trigger)

    // The menu is open (logout is present) but the admin item is absent.
    expect(await screen.findByRole('menuitem', { name: 'Выйти' })).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'Просмотр от имени…' }),
    ).not.toBeInTheDocument()
  })
})
