import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiClient, ApiClientProvider, type TokenStore } from '@my239/shared'
import { OfflineGradingTab } from './offline-grading-tab'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

// One student with two subproblems: 1 accepted, 1a not.
const grid = {
  columns: [
    {
      subproblem_id: 900,
      subproblem_label: '',
      problem_id: 500,
      problem_number: 1,
      problem_display: 'Задача 1',
      is_coffin: false,
    },
    {
      subproblem_id: 901,
      subproblem_label: 'a',
      problem_id: 501,
      problem_number: 2,
      problem_display: 'Задача 2',
      is_coffin: false,
    },
  ],
  students: [
    {
      student_user_id: 7,
      student_name: 'Аня Иванова',
      group_id: 10,
      group_name: 'А',
      cells: [
        { subproblem_id: 900, subproblem_label: '', problem_id: 500, problem_number: 1, thread_id: 1, current_status: 'accepted' },
        { subproblem_id: 901, subproblem_label: 'a', problem_id: 501, problem_number: 2, thread_id: 0, current_status: 'ungraded' },
      ],
    },
  ],
}

function stubFetch(onAccept: (body: unknown) => void) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof url === 'string' && url.includes('/series/7/grid')) {
      return new Response(JSON.stringify(grid), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (typeof url === 'string' && url.includes('/offline/accept')) {
      onAccept(JSON.parse(String(init?.body)))
      return new Response(
        JSON.stringify({
          id: 2,
          student_user_id: 7,
          subproblem_id: 901,
          series_id: 7,
          series_due_at: '2030-01-01T00:00:00Z',
          math_center_id: 42,
          current_status: 'accepted',
          created_at: '2030-01-01T00:00:00Z',
          updated_at: '2030-01-01T00:00:00Z',
          events: [],
          users: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
}

function renderTab() {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <MemoryRouter initialEntries={['/mathcenter/2026/series/7/offline']}>
          <Routes>
            <Route
              path="/mathcenter/:year/series/:seriesId/:tab"
              element={<OfflineGradingTab centerId={42} seriesId={7} />}
            />
          </Routes>
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OfflineGradingTab (phone flow)', () => {
  it('picks a student then marks an un-accepted problem solved', async () => {
    const accepts: unknown[] = []
    stubFetch((b) => accepts.push(b))
    renderTab()

    // Roster shows the student with a 1/2 solved count.
    const studentBtn = await screen.findByText('Аня Иванова')
    expect(screen.getByText('1/2')).toBeInTheDocument()
    await userEvent.click(studentBtn)

    // The per-student chips render; tap the un-accepted "2a" chip to mark it.
    const chip = await screen.findByText('2a')
    await userEvent.click(chip.closest('button') as HTMLButtonElement)

    await waitFor(() => expect(accepts).toHaveLength(1))
    // Phone flow credits the session teacher → no grader fields sent.
    expect(accepts[0]).toEqual({ student_user_id: 7, subproblem_id: 901 })
  })
})
