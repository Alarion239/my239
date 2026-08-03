import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    expect(screen.getByText(/Проверил: Пётр Иванов/)).toBeInTheDocument()
  })

  it('shows the credited in-person grader rather than the shared-computer actor', () => {
    renderTimeline(
      thread({
        current_status: 'accepted',
        events: [
          event({
            id: 3,
            kind: 'accepted_offline',
            verdict: 'accepted',
            actor_user_id: 2,
            credited_grader_name: 'Мария Кузнецова',
          }),
        ],
      }),
      false,
      2,
    )

    expect(
      screen.getByText(/Проверил очно: Мария Кузнецова/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Проверил очно: Пётр Иванов/)).not.toBeInTheDocument()
  })

  it('names who cancelled an in-person accept', () => {
    renderTimeline(
      thread({
        events: [
          event({
            id: 4,
            kind: 'offline_retracted',
            actor_user_id: 2,
          }),
        ],
      }),
      false,
      1,
    )

    expect(
      screen.getByText(/Отменил очный зачёт: Пётр Иванов/),
    ).toBeInTheDocument()
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

  it('opens event photos in the in-page gallery instead of a new-tab link', async () => {
    renderTimeline(
      thread({
        events: [
          event({
            id: 5,
            kind: 'submitted',
            photos: [
              {
                index: 0,
                object_key: 'solution-5',
                url: 'https://cdn.example.test/solution-5.jpg',
                content_type: 'image/jpeg',
                size_bytes: 1,
              },
            ],
          }),
        ],
      }),
      false,
      2,
    )

    expect(screen.queryByRole('link', { name: 'Вложение' })).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Открыть фото 1 из 1' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
  })
})
