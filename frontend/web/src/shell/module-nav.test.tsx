import type { ReactNode } from 'react'
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
import { ThemeProvider } from '../design/theme-provider'
import { AppShell } from './app-shell'
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

// A two-teacher-center + one-student-center membership, so the nav builds three
// "Матцентр {year}" modules (deduped — the student center is distinct here).
const mcMe: MeResponse = {
  teacher: {
    centers: [
      { id: 7, graduation_year: 2026, grade: 9, is_head_teacher: false, teachers: [], groups: [] },
      { id: 8, graduation_year: 2025, grade: 10, is_head_teacher: true, teachers: [], groups: [] },
    ],
  },
  student: {
    center: { id: 9, graduation_year: 2024, grade: 11 },
    group: { id: 1, name: 'А' },
    head_teachers: [],
  },
}

function mockFetch(user: User, me: MeResponse = mcMe) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      if (url.includes('/auth/me')) return json(user)
      if (url.includes('/mathcenter/me')) return json(me)
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

    expect(
      (await screen.findAllByRole('link', { name: /Матцентр \d{4}/ })).length,
    ).toBeGreaterThan(0)
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

  it('renders one "Матцентр {year}" module per center, sorted by year desc', async () => {
    const member = makeUser({ is_admin: false })
    mockFetch(member)
    renderShell(<NavRail />, '/mathcenter/7')

    const links = await screen.findAllByRole('link', { name: /Матцентр \d{4}/ })
    const labels = links.map((l) => l.textContent)
    expect(labels).toEqual(['Матцентр 2026', 'Матцентр 2025', 'Матцентр 2024'])
  })

  it('exposes the per-center module tabs in the top bar', async () => {
    const member = makeUser({ is_admin: false })
    mockFetch(member)
    // Centers are addressed by graduation year: center 8 -> /mathcenter/2025.
    renderShell(<TopBar user={member} />, '/mathcenter/2025/series')

    // The active module's "Серии" tab for center 8 (year 2025) shows in the bar.
    expect(await screen.findByRole('link', { name: 'Серии' })).toBeInTheDocument()
  })

  it('toggles the desktop nav rail from the my239 logo', async () => {
    const member = makeUser({ is_admin: false })
    mockFetch(member)
    renderShell(<AppShell />, '/')

    const logo = await screen.findByRole('link', { name: 'my239' })
    const rail = screen.getByRole('complementary', { hidden: true })
    expect(rail).toHaveClass('md:flex')

    await userEvent.click(logo)
    expect(rail).not.toHaveClass('md:flex')
    expect(logo).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(logo)
    expect(rail).toHaveClass('md:flex')
    expect(logo).toHaveAttribute('aria-expanded', 'true')
  })
})
