import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ApiClient,
  ApiClientProvider,
  type MathCenter,
  type TokenStore,
  type User,
  type UserEnrollments,
} from '@my239/shared'
import { AuthProvider } from '../../auth/auth-context'
import { UserDetailPage } from './user-detail-page'

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
    is_admin: true,
    is_math_center: false,
    ...overrides,
  }
}

// Logged-in admin (id 1) viewing user id 2.
const currentAdmin = makeUser({ id: 1, username: 'admin', is_admin: true })
const target = makeUser({
  id: 2,
  username: 'petrov',
  first_name: 'Пётр',
  last_name: 'Петров',
  is_admin: false,
})

const centers: MathCenter[] = [
  { id: 10, graduation_year: 2026, created_at: '2024-01-01T00:00:00Z' },
  { id: 11, graduation_year: 2025, created_at: '2024-01-01T00:00:00Z' },
]

const enrollments: UserEnrollments = {
  teaching: [
    {
      teacher_id: 100,
      center_id: 10,
      graduation_year: 2026,
      grade: 9,
      is_head_teacher: true,
    },
  ],
  student: {
    student_id: 200,
    center_id: 11,
    group_id: 1,
    group_name: 'Группа А',
    graduation_year: 2025,
    grade: 10,
  },
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url.includes('/auth/me')) return json(currentAdmin)
      if (url.includes('/admin/users/2/enrollments')) return json(enrollments)
      if (url.includes('/admin/users/1/enrollments'))
        return json({ teaching: [], student: null } satisfies UserEnrollments)
      if (url.includes('/admin/users/2') && method === 'GET') return json(target)
      if (url.includes('/admin/users/1') && method === 'GET') return json(currentAdmin)
      if (url.includes('/admin/mathcenter') && method === 'GET') return json(centers)
      return json([])
    }),
  )
}

function renderPage(userId: number) {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/admin/users/' + userId]}>
            <Routes>
              <Route path="/admin/users/:userId" element={<UserDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('UserDetailPage', () => {
  it('renders the profile, teaching and student enrollments', async () => {
    mockFetch()
    renderPage(2)

    expect(await screen.findByText('Пётр Петров')).toBeInTheDocument()
    expect(screen.getByText('@petrov')).toBeInTheDocument()

    // Teaching: center 2026 with a "Старший" badge.
    expect(await screen.findByText('Матцентр 2026')).toBeInTheDocument()
    expect(screen.getByText('Старший')).toBeInTheDocument()

    // Student: center 2025 + group name.
    expect(
      screen.getByText('Матцентр 2025 · Группа А'),
    ).toBeInTheDocument()
  })

  it('excludes already-taught centers from the "Добавить преподавателем" select', async () => {
    mockFetch()
    renderPage(2)

    // Wait for data, then inspect the teacher-add select. The student section
    // shows the existing student row (not the add-form), so this is the only
    // select on the page.
    await screen.findByText('Матцентр 2026')
    const select = await screen.findByRole('combobox', { name: 'Матцентр' })
    const options = within(select).getAllByRole('option').map((o) => o.textContent)
    // Center 10 (2026) is already taught and must be absent; 11 (2025) remains.
    expect(options).toContain('Выберите матцентр…')
    expect(options).toContain('Матцентр 2025')
    expect(options).not.toContain('Матцентр 2026')
  })

  it('disables the admin toggle when viewing your own account', async () => {
    mockFetch()
    renderPage(1) // current admin's own id

    const toggle = await screen.findByRole('button', { name: /админ/i })
    expect(toggle).toBeDisabled()
  })
})
