import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiClient, ApiClientProvider, type TokenStore } from '@my239/shared'
import { RegisterPage } from './register-page'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RegisterPage', () => {
  it('prefills and locks the canonical name for a personal student invite', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          valid: true,
          description: 'Личное приглашение',
          role: 'student',
          center_name: 'Матцентр 2030',
          personal_claim: true,
          first_name: 'Иван',
          middle_name: 'Петрович',
          last_name: 'Иванов',
        }),
      ),
    )

    const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={client}>
          <MemoryRouter initialEntries={['/register?token=personal']}>
            <RegisterPage />
          </MemoryRouter>
        </ApiClientProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Имя')).toHaveValue('Иван')
    })
    expect(screen.getByLabelText('Имя')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Отчество (необязательно)')).toHaveValue('Петрович')
    expect(screen.getByLabelText('Отчество (необязательно)')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Фамилия')).toHaveValue('Иванов')
    expect(screen.getByLabelText('Фамилия')).toHaveAttribute('readonly')
    expect(screen.getByText(/Вы регистрируете личный аккаунт ученика/)).toBeInTheDocument()
  })
})
