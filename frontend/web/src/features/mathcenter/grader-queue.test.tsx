import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiClient, ApiClientProvider, type TokenStore } from '@my239/shared'
import { GraderQueue } from './grader-queue'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

const available = {
  thread_id: 55,
  student_user_id: 1,
  student_name: 'Аня Смирнова',
  subproblem_id: 42,
  subproblem_label: 'б',
  problem_number: 3,
  problem_display: 'Задача 3',
  current_status: 'submitted',
  updated_at: '2030-01-01T10:00:00Z',
  claim_holder_user_id: null,
  claim_expires_at: null,
}

// A task the caller currently holds a live claim on (the backend only returns
// the caller's own live claims) — should surface under "В работе".
const claimedByMe = {
  thread_id: 56,
  student_user_id: 2,
  student_name: 'Борис Иванов',
  subproblem_id: 43,
  subproblem_label: 'а',
  problem_number: 4,
  problem_display: 'Задача 4',
  current_status: 'submitted',
  updated_at: '2030-01-01T11:00:00Z',
  claim_holder_user_id: 9,
  claim_expires_at: '2999-01-01T00:00:00Z',
}

function stubFetch(items: unknown[]) {
  const fetchMock = vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.includes('/queue')) {
      return new Response(JSON.stringify(items), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
}

function Harness() {
  return <GraderQueue seriesId={7} />
}

function renderQueue() {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        {/* The queue builds thread links from the :year route segment. */}
        <MemoryRouter initialEntries={['/mathcenter/2026/series/7/queue']}>
          <Routes>
            <Route
              path="/mathcenter/:year/series/:seriesId/:tab"
              element={<Harness />}
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

describe('GraderQueue', () => {
  it('renders a queue row linking to the thread', async () => {
    stubFetch([available])
    renderQueue()

    expect(await screen.findByText('Аня Смирнова')).toBeInTheDocument()
    expect(screen.getByText('Задача 3 (б)')).toBeInTheDocument()
    // The row links to the thread page.
    const link = document.querySelector('a[href="/mathcenter/2026/series/7/thread/55"]')
    expect(link).not.toBeNull()
    // No "только мои" filter any more.
    expect(screen.queryByLabelText('Только мои')).toBeNull()
  })

  it('pulls claimed tasks into a "В работе" section above the available pool', async () => {
    stubFetch([available, claimedByMe])
    renderQueue()

    expect(await screen.findByText('В работе')).toBeInTheDocument()
    expect(screen.getByText('Доступно к проверке')).toBeInTheDocument()
    // The claimed task ("В работе") appears before the available one in the DOM.
    const mine = screen.getByText('Борис Иванов')
    const free = screen.getByText('Аня Смирнова')
    expect(mine.compareDocumentPosition(free) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
