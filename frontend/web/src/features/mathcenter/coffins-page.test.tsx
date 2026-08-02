import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ApiClient,
  ApiClientProvider,
  type Coffin,
  type MeResponse,
  type TokenStore,
  type User,
} from '@my239/shared'
import { AuthProvider } from '../../auth/auth-context'
import { CenterIdContext, CenterTermContext } from './center-id-context'
import { CoffinsPage } from './coffins-page'

const CENTER_ID = 7
const TERM_ID = 7

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    username: 'student',
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

function makeCoffin(overrides: Partial<Coffin> = {}): Coffin {
  return {
    subproblem_id: 10,
    subproblem_label: 'а',
    problem_id: 1,
    problem_number: 1,
    display: 'Задача 1 (а)',
    series_id: 37,
    series_number: 1,
    series_name: 'Серия',
    math_center_id: CENTER_ID,
    term_id: TERM_ID,
    is_coffin: true,
    released_at: null,
    solution_published_at: null,
    has_solution_tex: false,
    has_solution_pdf: false,
    solution_link: null,
    accepted_count: 0,
    total_count: 0,
    ...overrides,
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderPage({
  entry,
  me,
  coffins,
}: {
  entry: string
  me: MeResponse
  coffins: Coffin[]
}) {
  const user = makeUser()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/auth/me')) return json(user)
      if (url.includes('/mathcenter/me')) return json(me)
      if (url.includes('/mathcenter/centers/' + CENTER_ID + '/coffins')) return json(coffins)
      return json([])
    }),
  )

  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <AuthProvider>
          <CenterIdContext.Provider value={CENTER_ID}>
            <CenterTermContext.Provider value={{ termId: TERM_ID, term: null }}>
              <MemoryRouter initialEntries={[entry]}>
                <Routes>
                  <Route path="/mathcenter/:year/coffins/:tab" element={<CoffinsPage />} />
                </Routes>
              </MemoryRouter>
            </CenterTermContext.Provider>
          </CenterIdContext.Provider>
        </AuthProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CoffinsPage student cards', () => {
  it('uses the colored letter control and removes coffin lifecycle text', async () => {
    const me: MeResponse = {
      student: {
        center: { id: CENTER_ID, graduation_year: 2099, grade: 9 },
        group: { id: 1, name: 'А' },
        head_teachers: [],
      },
    }
    const coffin = makeCoffin({
      current_status: 'submitted',
      being_graded: true,
      thread_id: 11,
    })
    renderPage({
      entry: '/mathcenter/2099/coffins/current?term_id=' + TERM_ID,
      me,
      coffins: [coffin],
    })

    const tile = await screen.findByRole('img', { name: '1а: В очереди' })
    expect(tile).toHaveTextContent('1а')
    expect(tile).toHaveClass('bg-status-checking-soft')
    expect(screen.getByRole('link', { name: '1а: В очереди' })).toHaveAttribute(
      'href',
      '/mathcenter/2099/series/37/thread/11?term_id=7',
    )
    expect(screen.queryByText('Открыт для сдачи')).not.toBeInTheDocument()
    expect(screen.queryByText(/Разобрана/)).not.toBeInTheDocument()
    expect(tile.closest('div.rounded-2xl')).not.toHaveClass('bg-status-checking-soft')
  })

  it('keeps the accepted letter control on solved coffins without lifecycle text', async () => {
    const me: MeResponse = {
      student: {
        center: { id: CENTER_ID, graduation_year: 2099, grade: 9 },
        group: { id: 1, name: 'А' },
        head_teachers: [],
      },
    }
    renderPage({
      entry: '/mathcenter/2099/coffins/solved?term_id=' + TERM_ID,
      me,
      coffins: [makeCoffin({ released_at: '2026-07-01T00:00:00Z', current_status: 'accepted', thread_id: 12, subproblem_label: 'б' })],
    })

    const tile = await screen.findByRole('img', { name: '1б: Принято' })
    expect(tile).toHaveTextContent('1б')
    expect(tile).toHaveClass('bg-status-accepted-soft')
    expect(screen.queryByText('Открыт для сдачи')).not.toBeInTheDocument()
    expect(screen.queryByText(/Разобрана/)).not.toBeInTheDocument()
  })
})

describe('CoffinsPage teacher cards', () => {
  it('removes lifecycle pills while preserving razbor metadata and controls', async () => {
    const me: MeResponse = {
      teacher: {
        centers: [{
          id: CENTER_ID,
          graduation_year: 2099,
          grade: 9,
          is_head_teacher: true,
          teachers: [],
          groups: [],
        }],
      },
    }
    renderPage({
      entry: '/mathcenter/2099/coffins/solved?term_id=' + TERM_ID,
      me,
      coffins: [makeCoffin({
        released_at: '2026-07-01T00:00:00Z',
        has_solution_tex: true,
        solution_published_at: '2026-07-02T00:00:00Z',
        accepted_count: 8,
        total_count: 10,
      })],
    })

    expect(await screen.findByText('Разбор опубликован')).toBeInTheDocument()
    expect(screen.getByText('решили 8 из 10')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Разбор' })).toBeInTheDocument()
    expect(screen.queryByText('Открыт для сдачи')).not.toBeInTheDocument()
    expect(screen.queryByText(/Разобрана/)).not.toBeInTheDocument()
  })
})
