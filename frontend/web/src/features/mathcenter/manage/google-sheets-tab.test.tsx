import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiClient, ApiClientProvider, type TokenStore } from '@my239/shared'
import { GoogleSheetsTab } from './google-sheets-tab'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

function renderTab() {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <GoogleSheetsTab centerId={7} activeTermId={11} />
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GoogleSheetsTab structure synchronization', () => {
  it('sends the selected term to both synchronization endpoints and shows results', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST' && url.includes('/google-sheets/sync-')) {
        const body = JSON.parse(String(init.body))
        calls.push({ url, body })
        const result = url.endsWith('/sync-students')
          ? { added_to_my239: 2, added_to_sheets: 3, matched: 4, moved: 0, ambiguous: 0 }
          : { added_to_my239: 1, added_to_sheets: 2, matched: 5 }
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.endsWith('/mathcenter/centers/7/terms')) {
        return new Response(JSON.stringify([{
          id: 11,
          math_center_id: 7,
          kind: 'academic',
          display_name: '2026–2027',
          is_active: true,
          created_at: '2026-07-01T00:00:00Z',
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/google-sheets/config')) {
        return new Response(JSON.stringify({ service_account_email: 'sync@example.test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    renderTab()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Синхронизировать учеников' }))
    expect(await screen.findByText(/добавлено в my239 — 2/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Синхронизировать серии' }))
    expect(await screen.findByText(/Серии: добавлено в my239 — 1/)).toBeInTheDocument()

    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[0]).toEqual(expect.objectContaining({ body: { term_id: 11 } }))
    expect(calls[0].url).toContain('/manage/google-sheets/sync-students')
    expect(calls[1].url).toContain('/manage/google-sheets/sync-series')
  })
})
