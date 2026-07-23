import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiClient, ApiClientProvider, type TokenStore } from '@my239/shared'
import {
  GraderInitialsInput,
  emptyGrader,
  type CreditedGrader,
} from './grader-initials-input'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

const teachers = [
  { user_id: 11, name: 'Иван Иванов', initials: 'ИИ' },
  { user_id: 12, name: 'Ирина Петрова', initials: 'ИП' },
]

function renderInput(onChange: (value: CreditedGrader) => void) {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <GraderInitialsInput centerId={42} value={emptyGrader} onChange={onChange} />
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GraderInitialsInput', () => {
  it('keeps the first autocomplete result selected and accepts it on Tab', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ teachers }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const onChange = vi.fn()
    renderInput(onChange)

    const input = await screen.findByRole('textbox', { name: 'Инициалы проверяющего' })
    await userEvent.click(input)
    const options = await screen.findAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[0]).toHaveTextContent('ИИ')

    await userEvent.tab()
    expect(onChange).toHaveBeenLastCalledWith({ userId: 11, name: 'Иван Иванов' })
  })

  it('filters suggestions while typing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ teachers }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    renderInput(() => {})

    const input = await screen.findByRole('textbox', { name: 'Инициалы проверяющего' })
    await userEvent.type(input, 'Петрова')

    expect(screen.getByRole('option')).toHaveTextContent('ИП')
    expect(screen.queryByText('ИИ')).not.toBeInTheDocument()
  })
})
