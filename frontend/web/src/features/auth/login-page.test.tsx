import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiClient, ApiClientProvider, type TokenStore } from '@my239/shared'
import { LoginPage } from './login-page'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

function renderLogin() {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

describe('LoginPage', () => {
  it('shows client-side validation errors before hitting the network', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByLabelText('Имя пользователя'), 'ab')
    await user.click(screen.getByRole('button', { name: 'Войти' }))

    expect(await screen.findByText('Минимум 3 символа')).toBeInTheDocument()
    expect(await screen.findByText('Введите пароль')).toBeInTheDocument()
  })

  it('lowercases the username as the user types', async () => {
    const user = userEvent.setup()
    renderLogin()

    const username = screen.getByLabelText('Имя пользователя') as HTMLInputElement
    await user.type(username, 'IVAN')

    expect(username.value).toBe('ivan')
  })

  it('renders the link to registration', () => {
    renderLogin()
    expect(screen.getByRole('link', { name: 'Зарегистрироваться' })).toHaveAttribute(
      'href',
      '/register',
    )
  })
})
