import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ApiClient,
  ApiClientProvider,
  type HomeworkStatus,
  type ThreadView,
  type TokenStore,
} from '@my239/shared'
import { ThreadActionPanel } from './thread-action-panel'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

function thread(status: HomeworkStatus, dueAt: string): ThreadView {
  return {
    id: 100,
    student_user_id: 1,
    subproblem_id: 42,
    series_id: 7,
    series_due_at: dueAt,
    math_center_id: 1,
    current_status: status,
    created_at: '2030-01-01T09:00:00Z',
    updated_at: '2030-01-01T10:00:00Z',
    users: { '1': 'Аня Смирнова' },
    events: [],
  }
}

function renderPanel(t: ThreadView, closed: boolean) {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <ThreadActionPanel thread={t} role="student" userId={1} closed={closed} />
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

describe('ThreadActionPanel — student', () => {
  it('offers the submit form before the deadline', () => {
    renderPanel(thread('ungraded', '2999-01-01T00:00:00Z'), false)
    expect(
      screen.getByRole('heading', { name: 'Отправить решение' }),
    ).toBeInTheDocument()
  })

  // Regression: after the series deadline a student must not see the submit
  // form (the backend 409s a late submit; the form is removed so they aren't
  // nudged toward it). Appeals stay available — but those live in the timeline,
  // not here. See the prior HomeworkThread behaviour and the plan's gating rule.
  it('hides the submit form after the deadline, even on a rejection', () => {
    renderPanel(thread('rejected', '2000-01-01T00:00:00Z'), true)
    expect(
      screen.queryByRole('heading', { name: /Отправить/ }),
    ).not.toBeInTheDocument()
  })
})
