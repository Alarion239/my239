import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
