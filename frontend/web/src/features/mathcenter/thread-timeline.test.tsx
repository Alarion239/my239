import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ApiClient,
  ApiClientProvider,
  type EventView,
  type ThreadView,
  type TokenStore,
} from '@my239/shared'
import { ThreadTimeline } from './thread-timeline'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

function event(partial: Partial<EventView> & Pick<EventView, 'id' | 'kind'>): EventView {
  return {
    event_uuid: 'u' + partial.id,
    actor_user_id: 1,
    body: '',
    created_at: '2030-01-01T10:00:00Z',
    photos: [],
    ...partial,
  }
}

function thread(partial: Partial<ThreadView> = {}): ThreadView {
  return {
    id: 100,
    student_user_id: 1,
    subproblem_id: 42,
    series_id: 7,
    series_due_at: '2030-01-01T00:00:00Z',
    math_center_id: 1,
    current_status: 'rejected',
    created_at: '2030-01-01T09:00:00Z',
    updated_at: '2030-01-01T10:00:00Z',
    users: { '1': 'Аня Смирнова', '2': 'Пётр Иванов' },
    events: [
      event({ id: 1, kind: 'submitted', actor_user_id: 1, body: 'Моё решение прилагаю' }),
      event({
        id: 2,
        kind: 'graded',
        verdict: 'rejected',
        actor_user_id: 2,
        body: 'Нужен пример',
      }),
    ],
    ...partial,
  }
}

function renderTimeline(t: ThreadView, isStudent: boolean, viewerUserId: number) {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <ThreadTimeline thread={t} viewerUserId={viewerUserId} isStudent={isStudent} />
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

describe('ThreadTimeline', () => {
  it('renders event kind headings (verdict-aware)', () => {
    renderTimeline(thread(), false, 2)
    expect(screen.getByText('Решение')).toBeInTheDocument()
    expect(screen.getByText('Отклонено')).toBeInTheDocument()
  })

  it('shows the inline appeal box for the owning student on a rejection', () => {
    renderTimeline(thread({ current_status: 'rejected' }), true, 1)
    expect(
      screen.getByRole('button', { name: 'Отправить апелляцию' }),
    ).toBeInTheDocument()
  })

  it('does not show the appeal box for a teacher viewing a rejection', () => {
    renderTimeline(thread({ current_status: 'rejected' }), false, 2)
    expect(
      screen.queryByRole('button', { name: 'Отправить апелляцию' }),
    ).not.toBeInTheDocument()
  })
})
