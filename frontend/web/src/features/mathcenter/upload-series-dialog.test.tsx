import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiClient, ApiClientProvider, type TokenStore } from '@my239/shared'
import { UploadSeriesDialog } from './upload-series-dialog'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

function renderDialog() {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <UploadSeriesDialog centerId={7} />
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('UploadSeriesDialog — validation', () => {
  it('rejects a series with no problems', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'Загрузить серию' }))
    await user.type(screen.getByLabelText('Название'), 'Тест')
    await user.type(screen.getByLabelText('Срок сдачи'), '2030-01-01T12:00')

    // Remove the only problem row, then submit.
    await user.click(screen.getByRole('button', { name: 'Удалить задачу 1' }))
    await user.click(screen.getByRole('button', { name: 'Создать и продолжить' }))

    expect(await screen.findByText('Добавьте хотя бы одну задачу')).toBeInTheDocument()
  })

  it('rejects duplicate problem numbers', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'Загрузить серию' }))
    await user.type(screen.getByLabelText('Название'), 'Тест')
    await user.type(screen.getByLabelText('Срок сдачи'), '2030-01-01T12:00')

    // Add a second problem and give it the same number as the first.
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    const first = screen.getByLabelText('Номер задачи 1')
    const second = screen.getByLabelText('Номер задачи 2')
    await user.clear(first)
    await user.type(first, '3')
    await user.clear(second)
    await user.type(second, '3')

    await user.click(screen.getByRole('button', { name: 'Создать и продолжить' }))

    expect(await screen.findByText('Номера задач не должны повторяться')).toBeInTheDocument()
  })
})

describe('UploadSeriesDialog — due_at format (regression)', () => {
  // Regression: the "Срок сдачи" datetime-local input yields a value like
  // "2030-01-01T12:00" (no seconds / timezone). It must be converted to RFC3339
  // before POSTing, or the backend rejects the body with 400. See PR #17.
  it('sends due_at as RFC3339, not the raw datetime-local value', async () => {
    const user = userEvent.setup()
    let sentDueAt: string | null = null

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (
        typeof url === 'string' &&
        url.endsWith('/mathcenter/centers/7/series') &&
        init?.method === 'POST'
      ) {
        const body = JSON.parse(init.body as string) as { due_at: string }
        sentDueAt = body.due_at
        return new Response(
          JSON.stringify({
            id: 1,
            math_center_id: 7,
            number: 1,
            name: 'Производные',
            display_name: 'Серия 1. Производные',
            due_at: body.due_at,
            published: false,
            has_pdf: false,
            has_tex: false,
            problems: [],
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Загрузить серию' }))
    await user.type(screen.getByLabelText('Название'), 'Производные')
    await user.type(screen.getByLabelText('Срок сдачи'), '2030-01-01T12:00')
    await user.click(screen.getByRole('button', { name: 'Создать и продолжить' }))

    await waitFor(() => expect(sentDueAt).not.toBeNull())
    // Must be the ISO/RFC3339 form (seconds + Z), NOT the bare datetime-local value.
    expect(sentDueAt).toBe(new Date('2030-01-01T12:00').toISOString())
    expect(sentDueAt).toMatch(/T\d\d:\d\d:\d\d(\.\d+)?Z$/)
    expect(sentDueAt).not.toBe('2030-01-01T12:00')
  })
})
