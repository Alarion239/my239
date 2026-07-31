import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiClient, ApiClientProvider, type TokenStore } from '@my239/shared'
import { RazborAccessTab } from './students-tab'

const noopStore: TokenStore = {
  getRefreshToken: async () => null,
  setRefreshToken: async () => {},
  clear: async () => {},
}

function renderTab() {
  const client = new ApiClient({ baseURL: '/api/v1', tokenStore: noopStore })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>
        <RazborAccessTab centerId={7} />
      </ApiClientProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RazborAccessTab', () => {
  it('toggles the written triangle independently and collapses a group', async () => {
    const patches: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/manage/students') && (!init?.method || init.method === 'GET')) {
          return Response.json([
            {
              id: 11,
              user_id: 55,
              group_id: 3,
              group_name: 'А',
              can_view_razbors: true,
              first_name: 'Аня',
              middle_name: null,
              last_name: 'Иванова',
            },
          ])
        }
        if (url.endsWith('/manage/groups')) {
          return Response.json([
            { id: 3, math_center_id: 7, name: 'А', created_at: '2026-01-01' },
          ])
        }
        if (url.endsWith('/manage/razbor-access') && (!init?.method || init.method === 'GET')) {
          return Response.json({
            series: [
              {
                series_id: 101,
                series_number: 4,
                series_name: 'Геометрия',
                written_posted: true,
                video_posted: true,
              },
            ],
            groups: [
              {
                id: 3,
                name: 'А',
                razbor_default_video: true,
                razbor_default_pdf_tex: true,
              },
            ],
            students: [
              {
                student_id: 11,
                user_id: 55,
                group_id: 3,
                group_name: 'А',
                name: 'Аня Иванова',
                razbor_default_video: true,
                razbor_default_pdf_tex: true,
              },
            ],
            cells: [
              {
                student_id: 11,
                group_id: 3,
                series_id: 101,
                can_view_video: true,
                can_view_pdf_tex: true,
              },
            ],
          })
        }
        if (url.endsWith('/manage/razbor-access') && init?.method === 'PATCH') {
          patches.push(JSON.parse(String(init.body)))
          return new Response(null, { status: 204 })
        }
        return Response.json([])
      }),
    )

    renderTab()
    const user = userEvent.setup()
    const written = await screen.findByRole('button', {
      name: /Аня Иванова · серия 4: Письменный разбор/,
    })
    expect(written).toHaveAccessibleName(/доступно/)
    await user.click(written)

    await waitFor(() =>
      expect(patches).toEqual([
        {
          target: 'student',
          mode: 'series',
          format: 'pdf_tex',
          series_id: 101,
          group_id: 0,
          student_id: 11,
          allowed: false,
        },
      ]),
    )

    const collapse = screen.getByRole('button', { name: 'Свернуть группу А' })
    await user.click(collapse)
    expect(screen.queryByRole('button', { name: /Аня Иванова · серия 4/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Развернуть группу А' })).toBeInTheDocument()
  })
})
