import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import {
  ApiClient,
  ApiClientProvider,
  type Series,
  type TokenStore,
} from '@my239/shared'
import { SeriesDraftEditor } from './series-draft-editor'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

const draft: Series = {
  id: 55,
  math_center_id: 7,
  term_id: 9,
  number: 3,
  name: 'Геометрия',
  display_name: 'Серия 3. Геометрия',
  due_at: '2030-01-01T12:00:00Z',
  published: false,
  has_pdf: false,
  has_tex: false,
  problems: [],
}

function renderEditor() {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <MemoryRouter initialEntries={['/mathcenter/2026/series/55/statement?term_id=9']}>
          <Routes>
            <Route path="/mathcenter/:year/series/:seriesId/:tab" element={<SeriesDraftEditor centerId={7} series={draft} />} />
          </Routes>
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('SeriesDraftEditor', () => {
  it('normalizes body-only LaTeX and saves newly created problem cards', async () => {
    const user = userEvent.setup()
    const requests: Array<{ url: string; method?: string; body?: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      requests.push({ url, method: init?.method, body })
      if (url.includes('/latex-preamble')) {
        return new Response(JSON.stringify({ preamble: '\\documentclass{article}' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(draft), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    renderEditor()
    await user.type(screen.getByPlaceholderText('Введите условие и формулы без преамбулы…'), 'Текст $x$.')
    await user.click(screen.getByRole('button', { name: 'Сохранить LaTeX' }))
    await waitFor(() => expect(requests.some((request) => request.url.endsWith('/series/55/tex'))).toBe(true))
    const texRequest = requests.find((request) => request.url.endsWith('/series/55/tex'))
    expect(texRequest?.body).toMatchObject({ tex: expect.stringContaining('\\begin{document}') })
    expect(texRequest?.body).toMatchObject({ tex: expect.stringContaining('Текст $x$.') })

    await user.click(screen.getByRole('button', { name: 'Добавить задачу' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить задачи' }))
    await waitFor(() => expect(requests.some((request) => request.method === 'PUT' && request.url.endsWith('/series/55'))).toBe(true))
    const problemRequest = requests.find((request) => request.method === 'PUT' && request.url.endsWith('/series/55'))
    expect(problemRequest?.body).toMatchObject({
      number: 3,
      problems: [{ number: 1, subproblem_count: 0 }],
    })
  })
})
