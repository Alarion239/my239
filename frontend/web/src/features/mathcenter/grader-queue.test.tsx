import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiClient, ApiClientProvider, type TokenStore } from '@my239/shared'
import { GraderQueue } from './grader-queue'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

const queueItem = {
  thread_id: 55,
  student_user_id: 1,
  student_name: 'Аня Смирнова',
  subproblem_id: 42,
  subproblem_label: 'б',
  problem_number: 3,
  problem_display: 'Задача 3',
  current_status: 'submitted',
  updated_at: '2030-01-01T10:00:00Z',
}

function stubFetch() {
  let mineRequested = false
  const fetchMock = vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.includes('/grader-stats')) {
      return new Response(
        JSON.stringify({
          pending_count: 4,
          my_claimed_count: 1,
          my_appeals_count: 2,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (typeof url === 'string' && url.includes('/queue')) {
      if (url.includes('mine=true')) mineRequested = true
      return new Response(JSON.stringify([queueItem]), {
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
  return () => mineRequested
}

function Harness() {
  const [mine, setMine] = useState(false)
  return (
    <GraderQueue centerId={1} seriesId={7} mine={mine} onMineChange={setMine} />
  )
}

function renderQueue() {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <MemoryRouter>
          <Harness />
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
    stubFetch()
    renderQueue()

    expect(await screen.findByText('Аня Смирнова')).toBeInTheDocument()
    expect(screen.getByText('Задача 3 (б)')).toBeInTheDocument()
    // The row links to the thread page.
    const link = document.querySelector('a[href="/mathcenter/1/series/7/thread/55"]')
    expect(link).not.toBeNull()
  })

  it('refetches with ?mine=true when "Только мои" is toggled', async () => {
    const wasMineRequested = stubFetch()
    const user = userEvent.setup()
    renderQueue()

    await screen.findByText('Аня Смирнова')
    expect(wasMineRequested()).toBe(false)

    await user.click(screen.getByLabelText('Только мои'))

    await waitFor(() => expect(wasMineRequested()).toBe(true))
  })
})
