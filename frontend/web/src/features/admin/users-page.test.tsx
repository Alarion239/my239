import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ApiClient,
  ApiClientProvider,
  type InvitationToken,
  type TokenStore,
  type User,
} from '@my239/shared'
import { AuthProvider } from '../../auth/auth-context'
import { UsersPage } from './users-page'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

function makeUser(overrides: Partial<User>): User {
  return {
    id: 1,
    username: 'ivanov',
    first_name: 'Иван',
    middle_name: null,
    last_name: 'Иванов',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    is_admin: true,
    is_math_center: false,
    ...overrides,
  }
}

const users: User[] = [
  makeUser({ id: 1, username: 'admin', first_name: 'Анна', last_name: 'Админова', is_admin: true }),
  makeUser({ id: 2, username: 'petrov', first_name: 'Пётр', last_name: 'Петров', is_admin: false }),
]

let postedToken: { description: string; max_uses: number; expires_in_hours: number } | null = null

function mockFetch() {
  postedToken = null
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

      if (url.includes('/auth/me')) return json(users[0])
      if (url.includes('/admin/users') && method === 'GET') return json(users)
      if (url.includes('/admin/tokens') && method === 'POST') {
        postedToken = JSON.parse(init?.body as string)
        const token: InvitationToken = {
          id: 99,
          token: 'INVITE-XYZ-123',
          description: postedToken!.description,
          max_uses: postedToken!.max_uses,
          uses: 0,
          expires_at: '2025-01-01T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z',
        }
        return json(token, 201)
      }
      if (url.includes('/admin/tokens') && method === 'GET') return json([])
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
        <AuthProvider>
          <MemoryRouter>
            <UsersPage />
          </MemoryRouter>
        </AuthProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('UsersPage', () => {
  it('renders users from the API', async () => {
    mockFetch()
    renderPage()

    expect(await screen.findByText('Анна Админова')).toBeInTheDocument()
    expect(screen.getByText('@petrov')).toBeInTheDocument()
  })

  it('creates an invitation token and shows the returned token', async () => {
    mockFetch()
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Создать приглашение' }))

    await user.type(screen.getByLabelText('Описание'), 'Для 11 класса')
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    await waitFor(() => expect(postedToken).not.toBeNull())
    expect(postedToken?.description).toBe('Для 11 класса')

    const tokenField = (await screen.findByLabelText('Токен приглашения')) as HTMLInputElement
    expect(tokenField.value).toBe('INVITE-XYZ-123')
  })
})
