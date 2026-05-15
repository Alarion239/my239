import {render, screen, waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {ReactElement} from 'react'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {AuthState, AuthedRawOpts} from '../../auth'
import {AuthContext} from '../../auth'
import type {Series} from '../../api/series'
import {parseDateTimeLocal, SeriesPanel, toDateTimeLocal} from './SeriesPanel'

function mockSeries(overrides: Partial<Series> = {}): Series {
    return {
        id: 100,
        math_center_id: 42,
        number: 1,
        name: 'Алгебра',
        display_name: 'Серия 1. Алгебра',
        due_at: '2026-06-01T15:00:00Z',
        published: false,
        published_at: null,
        has_pdf: false,
        problems: [{id: 500, number: 0, display_name: 'Упражнение', subproblems: ['a', 'b']}],
        ...overrides,
    }
}

interface FakeAuth {
    authedFetch: ReturnType<typeof vi.fn>
    authedFetchRaw: ReturnType<typeof vi.fn>
}

// makeAuth builds a path-dispatching auth pair. We register routes BEFORE
// rendering so the panel's mount-time effects find them; any unmocked path
// raises a clear error instead of silently returning undefined (which used to
// crash the panel when state updates outran the test plan).
function makeAuth(
    routes: Record<string, unknown> = {},
    rawRoutes: Record<string, () => Response> = {},
): FakeAuth {
    const authedFetch = vi.fn(async (path: string) => {
        if (!(path in routes)) throw new Error(`unmocked authedFetch path: ${path}`)
        return routes[path]
    })
    const authedFetchRaw = vi.fn(async (path: string) => {
        if (!(path in rawRoutes)) throw new Error(`unmocked authedFetchRaw path: ${path}`)
        return rawRoutes[path]()
    })
    return {authedFetch, authedFetchRaw}
}

function renderWithAuth(node: ReactElement, auth: FakeAuth) {
    const value: AuthState = {
        user: null,
        loading: false,
        async login() {/* unused */
        },
        async register() {/* unused */
        },
        async logout() {/* unused */
        },
        authedFetch: auth.authedFetch as <T>(p: string, o?: {method?: string; body?: unknown}) => Promise<T>,
        authedFetchRaw: auth.authedFetchRaw as (p: string, o?: AuthedRawOpts) => Promise<Response>,
    }
    render(<AuthContext.Provider value={value}>{node}</AuthContext.Provider>)
}

describe('SeriesPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('shows the empty state when the center has no series', async () => {
        const auth = makeAuth({'/mathcenter/centers/42/series': []})
        renderWithAuth(<SeriesPanel centerID={42} isTeacher={false}/>, auth)

        await waitFor(() => expect(auth.authedFetch).toHaveBeenCalledWith('/mathcenter/centers/42/series'))
        expect(await screen.findByText(/Серий пока нет/i)).toBeInTheDocument()
    })

    it('lists series returned by the API', async () => {
        const auth = makeAuth({
            '/mathcenter/centers/42/series': [
                mockSeries({id: 100, display_name: 'Серия 1. Алгебра', published: true, has_pdf: true}),
                mockSeries({id: 101, display_name: 'Серия 2. Геометрия'}),
            ],
        })
        renderWithAuth(<SeriesPanel centerID={42} isTeacher={false}/>, auth)

        expect(await screen.findByText('Серия 1. Алгебра')).toBeInTheDocument()
        expect(screen.getByText('Серия 2. Геометрия')).toBeInTheDocument()
        expect(screen.getByText(/опубликована/)).toBeInTheDocument()
        expect(screen.getByText(/PDF загружен/)).toBeInTheDocument()
    })

    it('hides the create button for non-teachers', async () => {
        const auth = makeAuth({'/mathcenter/centers/42/series': []})
        renderWithAuth(<SeriesPanel centerID={42} isTeacher={false}/>, auth)

        await waitFor(() => expect(auth.authedFetch).toHaveBeenCalled())
        expect(screen.queryByText(/Создать серию/i)).not.toBeInTheDocument()
    })

    it('shows the create button for teachers and opens the editor on click', async () => {
        const auth = makeAuth({'/mathcenter/centers/42/series': []})
        renderWithAuth(<SeriesPanel centerID={42} isTeacher={true}/>, auth)

        const createBtn = await screen.findByText(/Создать серию/i)
        await userEvent.click(createBtn)
        expect(screen.getByText(/Новая серия/i)).toBeInTheDocument()
        // The default scaffold has problem 0 + problem 1 (so the form is usable
        // immediately without having to click "+ Добавить задачу").
        expect(screen.getAllByText(/Подзадач: 0/).length).toBeGreaterThanOrEqual(2)
    })

    it('opens the detail view when a series row is clicked, and a teacher sees the action buttons', async () => {
        const detail = mockSeries({has_pdf: true, published: true})
        const auth = makeAuth({
            '/mathcenter/centers/42/series': [detail],
            '/mathcenter/series/100': detail,
        })
        renderWithAuth(<SeriesPanel centerID={42} isTeacher={true}/>, auth)

        const row = await screen.findByText('Серия 1. Алгебра')
        await userEvent.click(row)

        await waitFor(() => expect(auth.authedFetch).toHaveBeenCalledWith('/mathcenter/series/100'))
        expect(await screen.findByText(/Редактировать/)).toBeInTheDocument()
        expect(screen.getByText(/Удалить серию/)).toBeInTheDocument()
        expect(screen.getByText(/Скачать PDF/)).toBeInTheDocument()
        expect(screen.getByText(/Заменить PDF/)).toBeInTheDocument()
        // The "Задачи" / "Подзадачи: a, b" list was removed from
        // SeriesDetail — that information is now visible as columns
        // in the adjacent teacher spreadsheet, so duplicating it was
        // pure noise. The series header + status + action buttons are
        // all the detail view needs.
    })

    it('students see no edit/upload affordances and no download until a PDF exists', async () => {
        const noPDF = mockSeries({has_pdf: false, published: true})
        const auth = makeAuth({
            '/mathcenter/centers/42/series': [noPDF],
            '/mathcenter/series/100': noPDF,
        })
        renderWithAuth(<SeriesPanel centerID={42} isTeacher={false}/>, auth)

        await userEvent.click(await screen.findByText('Серия 1. Алгебра'))
        await waitFor(() => expect(auth.authedFetch).toHaveBeenCalledWith('/mathcenter/series/100'))

        expect(screen.queryByText(/Редактировать/)).not.toBeInTheDocument()
        expect(screen.queryByText(/Удалить серию/)).not.toBeInTheDocument()
        expect(screen.queryByText(/Загрузить PDF/)).not.toBeInTheDocument()
        expect(screen.queryByText(/Заменить PDF/)).not.toBeInTheDocument()
        expect(screen.queryByText(/Скачать PDF/)).not.toBeInTheDocument()
        expect(screen.queryByText(/Просмотреть PDF/)).not.toBeInTheDocument()
    })

    it('clicking the same series row twice collapses the detail back to the list', async () => {
        const detail = mockSeries({has_pdf: false, published: true})
        const auth = makeAuth({
            '/mathcenter/centers/42/series': [detail],
            '/mathcenter/series/100': detail,
        })
        renderWithAuth(<SeriesPanel centerID={42} isTeacher={true}/>, auth)

        const row = await screen.findByText('Серия 1. Алгебра')
        await userEvent.click(row)

        // First click opens the detail — actions visible.
        expect(await screen.findByText(/Редактировать/)).toBeInTheDocument()

        // Second click collapses it — actions gone, list still shown.
        await userEvent.click(row)
        await waitFor(() => expect(screen.queryByText(/Редактировать/)).not.toBeInTheDocument())
        expect(screen.queryByText(/Удалить серию/)).not.toBeInTheDocument()
        // The row itself is still in the list.
        expect(screen.getByText('Серия 1. Алгебра')).toBeInTheDocument()
    })

    it('clicking "Просмотреть PDF" fetches the bytes, mounts an iframe, and revokes the URL on toggle-off', async () => {
        // Stub Object URL APIs — jsdom doesn't implement them.
        const originalCreate = URL.createObjectURL
        const originalRevoke = URL.revokeObjectURL
        URL.createObjectURL = vi.fn(() => 'blob:preview-mock')
        const revoke = vi.fn()
        URL.revokeObjectURL = revoke

        try {
            const detail = mockSeries({has_pdf: true, published: true})
            const pdfBytes = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], {type: 'application/pdf'})
            const auth = makeAuth(
                {
                    '/mathcenter/centers/42/series': [detail],
                    '/mathcenter/series/100': detail,
                },
                {
                    '/mathcenter/series/100/pdf': () => ({
                        blob: async () => pdfBytes,
                    } as Response),
                },
            )
            renderWithAuth(<SeriesPanel centerID={42} isTeacher={false}/>, auth)

            await userEvent.click(await screen.findByText('Серия 1. Алгебра'))
            const previewBtn = await screen.findByText('Просмотреть PDF')
            await userEvent.click(previewBtn)

            // The iframe lands in the DOM with the blob URL as src.
            const iframe = await waitFor(() => {
                const node = document.querySelector('iframe')
                if (!node) throw new Error('no iframe yet')
                return node
            })
            expect(iframe.getAttribute('src')).toBe('blob:preview-mock')
            expect(auth.authedFetchRaw).toHaveBeenCalledWith('/mathcenter/series/100/pdf')
            expect(screen.getByText(/Скрыть PDF/)).toBeInTheDocument()

            // Toggle off → iframe gone, URL revoked.
            await userEvent.click(screen.getByText(/Скрыть PDF/))
            await waitFor(() => expect(document.querySelector('iframe')).toBeNull())
            expect(revoke).toHaveBeenCalledWith('blob:preview-mock')
        } finally {
            URL.createObjectURL = originalCreate
            URL.revokeObjectURL = originalRevoke
        }
    })
})

// The two helpers do quite a lot of validation work (see the create form), so
// they get their own focused tests. Keeping them here rather than in a sibling
// utils file because the helpers are co-owned by the panel.
describe('series datetime helpers', () => {
    it('toDateTimeLocal formats an ISO string in local time as YYYY-MM-DD HH:MM', () => {
        // Use a Date constructed via local components so the test is timezone-stable.
        const local = new Date(2026, 4, 15, 18, 30) // May 15 2026 18:30 local
        const out = toDateTimeLocal(local.toISOString())
        expect(out).toBe('2026-05-15 18:30')
    })

    it('toDateTimeLocal falls back to a future default when given no input', () => {
        // We can't pin "tomorrow" but we can assert the format and that it's in the future.
        const out = toDateTimeLocal()
        expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    })

    it('parseDateTimeLocal accepts both space and T separators', () => {
        const space = parseDateTimeLocal('2026-05-15 18:30')
        const tee = parseDateTimeLocal('2026-05-15T18:30')
        expect(space).not.toBeNull()
        expect(tee).not.toBeNull()
        expect(space!.getTime()).toBe(tee!.getTime())
    })

    it('parseDateTimeLocal rejects malformed input', () => {
        expect(parseDateTimeLocal('not a date')).toBeNull()
        expect(parseDateTimeLocal('2026/05/15 18:30')).toBeNull()
        // Wrong number of digits → reject (we don't want to silently parse '26-1-1 1:1')
        expect(parseDateTimeLocal('26-1-1 1:1')).toBeNull()
    })
})
