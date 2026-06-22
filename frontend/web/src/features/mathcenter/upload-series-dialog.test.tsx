import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
        <UploadSeriesDialog centerId={7} defaultNumber={3} />
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('UploadSeriesDialog — step 1 (metadata)', () => {
  it('pre-fills the next series number', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Загрузить серию' }))
    expect(screen.getByLabelText('Номер серии')).toHaveValue(3)
  })

  it('pre-fills a due date (the next session)', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Загрузить серию' }))
    expect(screen.getByLabelText('Срок сдачи')).toHaveValue()
  })

  // Regression: the "Срок сдачи" datetime-local input yields a value like
  // "2030-01-01T12:00" (no seconds / timezone). It must be converted to RFC3339
  // before POSTing, or the backend rejects the body with 400. See PR #17.
  it('creates with an empty problem set and sends due_at as RFC3339', async () => {
    const user = userEvent.setup()
    let sentBody: { due_at: string; problems: unknown[] } | null = null

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (
        typeof url === 'string' &&
        url.endsWith('/mathcenter/centers/7/series') &&
        init?.method === 'POST'
      ) {
        sentBody = JSON.parse(init.body as string)
        return new Response(
          JSON.stringify({
            id: 1,
            math_center_id: 7,
            number: 3,
            name: 'Производные',
            display_name: 'Серия 3. Производные',
            due_at: sentBody!.due_at,
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
    fireEvent.change(screen.getByLabelText('Срок сдачи'), {
      target: { value: '2030-01-01T12:00' },
    })
    await user.click(screen.getByRole('button', { name: 'Далее →' }))

    await waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody!.problems).toEqual([])
    expect(sentBody!.due_at).toBe(new Date('2030-01-01T12:00').toISOString())
    expect(sentBody!.due_at).toMatch(/T\d\d:\d\d:\d\d(\.\d+)?Z$/)

    // After create, the wizard advances to the statement step.
    expect(await screen.findByLabelText('Исходник LaTeX')).toBeInTheDocument()
  })
})
