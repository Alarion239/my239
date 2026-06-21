import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ApiClient,
  ApiClientProvider,
  type MeResponse,
  type MyRollup,
  type Series,
  type SeriesProblemStats,
  type TokenStore,
  type User,
} from '@my239/shared'
import { AuthProvider } from '../../auth/auth-context'
import { SeriesPage } from './series-page'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

const CENTER_ID = 7
const SERIES_ID = 42

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    username: 'ivanov',
    first_name: 'Иван',
    middle_name: null,
    last_name: 'Иванов',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    is_admin: false,
    is_math_center: true,
    ...overrides,
  }
}

// Two series: an older one and a published upcoming one (the "current").
const seriesList: Series[] = [
  {
    id: 41,
    math_center_id: CENTER_ID,
    number: 1,
    name: 'Делимость',
    display_name: 'Серия 1',
    due_at: '2020-01-01T00:00:00Z',
    published: true,
    published_at: '2019-12-01T00:00:00Z',
    has_pdf: false,
    has_tex: false,
    problems: [],
  },
  {
    id: SERIES_ID,
    math_center_id: CENTER_ID,
    number: 2,
    name: 'Многочлены',
    display_name: 'Серия 2',
    due_at: '2999-01-01T00:00:00Z',
    published: true,
    published_at: '2024-01-01T00:00:00Z',
    has_pdf: false,
    has_tex: false,
    problems: [
      {
        id: 100,
        number: 1,
        display_name: 'Задача 1',
        subproblems: [
          {
            id: 900,
            label: 'а',
            display: 'Задача 1 (а)',
            is_coffin: false,
            has_solution_tex: false,
            has_solution_pdf: false,
          },
          {
            id: 901,
            label: 'б',
            display: 'Задача 1 (б)',
            is_coffin: false,
            has_solution_tex: false,
            has_solution_pdf: false,
          },
        ],
      },
    ],
  },
]

const studentRollup: MyRollup = {
  counts: { accepted: 1, rejected: 0, pending: 1 },
  problems: [
    {
      problem_id: 100,
      problem_number: 1,
      problem_display: 'Задача 1',
      subproblems: [
        { subproblem_id: 1000, subproblem_label: 'а', thread_id: 1, current_status: 'accepted', being_graded: false },
        { subproblem_id: 1001, subproblem_label: 'б', thread_id: 2, current_status: 'submitted', being_graded: true },
      ],
    },
  ],
}

const problemStats: SeriesProblemStats = {
  total_students: 12,
  problems: [
    {
      problem_id: 100,
      problem_number: 1,
      problem_display: 'Задача 1',
      subproblem_id: 900,
      subproblem_label: '',
      accepted: 5,
      appealed: 1,
      rejected: 2,
      submitted: 3,
      unsolved: 1,
    },
  ],
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockFetch(me: MeResponse, user: User) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/auth/me')) return json(user)
      if (url.includes('/mathcenter/me')) return json(me)
      if (url.includes('/mathcenter/centers/' + CENTER_ID + '/series')) return json(seriesList)
      if (url.includes('/homework/series/' + SERIES_ID + '/my')) return json(studentRollup)
      if (url.includes('/homework/series/' + SERIES_ID + '/problem-stats')) return json(problemStats)
      return json([])
    }),
  )
}

function renderPage() {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/mathcenter/' + CENTER_ID]}>
            <Routes>
              <Route path="/mathcenter/:centerId" element={<SeriesPage />} />
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

describe('SeriesPage — student view', () => {
  it('lists the series, marks the current one, and renders status tiles', async () => {
    const me: MeResponse = {
      student: {
        center: { id: CENTER_ID, graduation_year: 2026, grade: 9 },
        group: { id: 1, name: 'А' },
        head_teachers: [],
      },
    }
    mockFetch(me, makeUser())
    renderPage()

    // Both series appear in the strip.
    expect(await screen.findByText('Серия 1')).toBeInTheDocument()
    expect(screen.getByText('Серия 2')).toBeInTheDocument()
    // The upcoming published series is marked current.
    expect(screen.getByText('Текущая')).toBeInTheDocument()

    // The student rollup renders per-subproblem status tiles (no panel heading).
    expect(await screen.findByText('Задача 1')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'а: Принято' })).toBeInTheDocument()
    // Subproblem б is submitted AND claimed (being_graded) → "На проверке".
    expect(screen.getByRole('img', { name: 'б: На проверке' })).toBeInTheDocument()
    // No teacher "create series" card in the student view.
    expect(screen.queryByRole('button', { name: 'Создать серию' })).not.toBeInTheDocument()
  })
})

describe('SeriesPage — teacher view', () => {
  it('renders stat counts and the "Создать серию" card', async () => {
    const me: MeResponse = {
      teacher: {
        centers: [
          {
            id: CENTER_ID,
            graduation_year: 2026,
            grade: 9,
            is_head_teacher: true,
            teachers: [],
            groups: [],
          },
        ],
      },
    }
    mockFetch(me, makeUser())
    renderPage()

    expect(await screen.findByText('Серия 2')).toBeInTheDocument()
    // The "+" create-series card sits at the end of the strip.
    expect(await screen.findByRole('button', { name: 'Создать серию' })).toBeInTheDocument()

    // The Разбор tab (default) renders the per-subproblem stats breakdown
    // full-width — no separate "Статистика" panel heading/container.
    expect(await screen.findByText('Принято:', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })
})
