import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ApiClient,
  ApiClientProvider,
  type MathCenter,
  type TokenStore,
} from '@my239/shared'
import { MathCentersPage } from './math-centers-page'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

const centers: MathCenter[] = [
  { id: 1, graduation_year: 2025, created_at: '2024-01-01T00:00:00Z' },
]

let postedCenter: { graduation_year: number } | null = null

function mockFetch() {
  postedCenter = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })

      if (url.includes('/admin/mathcenter') && method === 'GET') return json(centers)
      if (url.includes('/admin/mathcenter') && method === 'POST') {
        postedCenter = JSON.parse(init?.body as string)
        const created: MathCenter = {
          id: 2,
          graduation_year: postedCenter!.graduation_year,
          created_at: '2024-02-01T00:00:00Z',
        }
        return json(created, 201)
      }
      return json([])
    }),
  )
}

function renderPage() {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <MemoryRouter>
          <MathCentersPage />
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MathCentersPage', () => {
  it('renders centers from the API', async () => {
    mockFetch()
    renderPage()
    expect(await screen.findByText('2025')).toBeInTheDocument()
  })

  it('creates a math center', async () => {
    mockFetch()
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Создать матцентр' }))

    const yearField = screen.getByLabelText('Год выпуска') as HTMLInputElement
    await user.clear(yearField)
    await user.type(yearField, '2030')
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    await waitFor(() => expect(postedCenter).not.toBeNull())
    expect(postedCenter?.graduation_year).toBe(2030)
  })
})
