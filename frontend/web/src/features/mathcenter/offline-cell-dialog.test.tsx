import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import {
  ApiClient,
  ApiClientProvider,
  type ThreadView,
  type TokenStore,
} from '@my239/shared'
import { OfflineCellDialog } from './offline-cell-dialog'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

const undoneThread: ThreadView = {
  id: 100,
  student_user_id: 1,
  subproblem_id: 42,
  series_id: 7,
  series_due_at: '2030-01-01T00:00:00Z',
  math_center_id: 1,
  current_status: 'ungraded',
  created_at: '2030-01-01T09:00:00Z',
  updated_at: '2030-01-01T10:00:00Z',
  users: { '1': 'Аня Смирнова', '2': 'Пётр Иванов' },
  events: [],
}

function renderDialog() {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={client}>
          <OfflineCellDialog
            open
            onOpenChange={() => {}}
            centerId={1}
            mode="conduit"
            target={{
              studentUserId: 1,
              studentName: 'Аня Смирнова',
              subproblemId: 42,
              columnLabel: '1а',
              threadId: 100,
              status: 'accepted',
              acceptedInitials: 'ПК',
              threadHref: '/mathcenter/2099/series/7/thread/100',
            }}
          />
        </ApiClientProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OfflineCellDialog', () => {
  it('focuses the teacher comment instead of grader initials after undo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/homework/offline/undo') && init?.method === 'POST') {
          return new Response(JSON.stringify(undoneThread), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.endsWith('/homework/threads/by-id/100/notes')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.endsWith('/homework/centers/1/teachers')) {
          return new Response(JSON.stringify({ teachers: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        throw new Error('Unexpected request: ' + url)
      }),
    )
    renderDialog()

    await userEvent.click(screen.getByRole('button', { name: 'Отменить' }))

    const comment = await screen.findByPlaceholderText(
      'Заметка для преподавателей (не видна ученику)…',
    )
    await waitFor(() => expect(comment).toHaveFocus())
    expect(
      screen.getByRole('textbox', { name: 'Инициалы проверяющего' }),
    ).not.toHaveFocus()
  })
})
