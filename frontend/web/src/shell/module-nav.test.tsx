import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ApiClient,
  ApiClientProvider,
  type TokenStore,
  type User,
} from '@my239/shared'
import { AuthProvider } from '../auth/auth-context'
import { ImpersonationProvider } from '../auth/impersonation-context'
import { ThemeProvider } from '../design/theme-provider'
import { TopBar } from './top-bar'
import { NavRail } from './nav-rail'

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

// jsdom lacks matchMedia; ThemeProvider reads it for the initial theme.
function mockMatchMedia() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  )
}

function mockFetch(me: User) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      if (url.includes('/auth/me')) return json(me)
      return json([])
    }),
  )
}

function renderShell(node: ReactNode, initialPath: string) {
  mockMatchMedia()
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <ThemeProvider>
          <ImpersonationProvider>
            <AuthProvider>
              <MemoryRouter initialEntries={[initialPath]}>{node}</MemoryRouter>
            </AuthProvider>
          </ImpersonationProvider>
        </ThemeProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('module navigation', () => {
  it('shows the admin module page tabs in the top bar at /admin/users', async () => {
    const admin = makeUser({ is_admin: true })
    mockFetch(admin)
    renderShell(<TopBar user={admin} />, '/admin/users')

    expect(await screen.findByRole('link', { name: 'Пользователи' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Матцентры' })).toBeInTheDocument()
  })

  it('hides the admin module from the rail for a non-admin', async () => {
    const member = makeUser({ is_admin: false })
    mockFetch(member)
    renderShell(<NavRail />, '/mathcenter')

    expect(await screen.findByRole('link', { name: /Матцентр/ })).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Администрирование' }),
    ).not.toBeInTheDocument()
  })

  it('shows the admin module in the rail for an admin', async () => {
    const admin = makeUser({ is_admin: true })
    mockFetch(admin)
    renderShell(<NavRail />, '/admin/users')

    expect(
      await screen.findByRole('link', { name: 'Администрирование' }),
    ).toBeInTheDocument()
  })
})
