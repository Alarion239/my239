import {beforeEach, describe, expect, it, vi} from 'vitest'
import {
    createSeries,
    deleteSeries,
    downloadSeriesPDF,
    fetchSeriesPDFObjectURL,
    getSeries,
    listSeriesForCenter,
    publishSeries,
    type Series,
    updateSeries,
} from './series'

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
        problems: [],
        ...overrides,
    }
}

describe('series API client', () => {
    let authedFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
        authedFetch = vi.fn()
    })

    it('listSeriesForCenter targets the per-center collection endpoint', async () => {
        authedFetch.mockResolvedValue([mockSeries()])
        const out = await listSeriesForCenter(authedFetch as never, 42)
        expect(authedFetch).toHaveBeenCalledWith('/mathcenter/centers/42/series')
        expect(out).toHaveLength(1)
    })

    it('getSeries hits the singular endpoint', async () => {
        authedFetch.mockResolvedValue(mockSeries())
        await getSeries(authedFetch as never, 100)
        expect(authedFetch).toHaveBeenCalledWith('/mathcenter/series/100')
    })

    it('createSeries POSTs the JSON payload to the center collection', async () => {
        authedFetch.mockResolvedValue(mockSeries())
        const payload = {
            number: 3,
            name: 'Геометрия',
            due_at: '2026-07-01T10:00:00Z',
            problems: [{number: 0, subproblem_count: 2}, {number: 1, subproblem_count: 0}],
        }
        await createSeries(authedFetch as never, 42, payload)
        expect(authedFetch).toHaveBeenCalledWith('/mathcenter/centers/42/series', {body: payload})
    })

    it('updateSeries uses PUT with the full payload', async () => {
        authedFetch.mockResolvedValue(mockSeries())
        const payload = {number: 1, name: 'A', due_at: '2026-01-01T00:00:00Z', problems: [{number: 1, subproblem_count: 0}]}
        await updateSeries(authedFetch as never, 100, payload)
        expect(authedFetch).toHaveBeenCalledWith('/mathcenter/series/100', {method: 'PUT', body: payload})
    })

    it('deleteSeries uses DELETE', async () => {
        authedFetch.mockResolvedValue(undefined)
        await deleteSeries(authedFetch as never, 100)
        expect(authedFetch).toHaveBeenCalledWith('/mathcenter/series/100', {method: 'DELETE'})
    })

    it('publishSeries drives the presigned-PUT handshake: upload-url → PUT → publish', async () => {
        // The function uses authedFetch for both the upload-url mint and
        // the publish call, and plain global fetch for the unauthenticated
        // PUT to the presigned URL.
        const key = 'mathcenter/series/100.pdf'
        authedFetch.mockImplementation(async (path: string) => {
            if (path === '/mathcenter/series/100/pdf/upload-url') {
                return {object_key: key, upload_url: 'https://minio.local/presigned'}
            }
            if (path === '/mathcenter/series/100/pdf/publish') {
                return mockSeries({has_pdf: true})
            }
            throw new Error(`unexpected path ${path}`)
        })
        const fetchMock = vi.fn(async () => ({ok: true, status: 200} as Response))
        const originalFetch = globalThis.fetch
        globalThis.fetch = fetchMock as never
        try {
            const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'series.pdf', {type: 'application/pdf'})
            const out = await publishSeries(authedFetch as never, 100, file)
            expect(out.has_pdf).toBe(true)

            // Mint
            expect(authedFetch).toHaveBeenNthCalledWith(1, '/mathcenter/series/100/pdf/upload-url', {method: 'POST'})
            // Direct PUT to MinIO/Yandex with the right Content-Type so the
            // signature verifies on the bucket side.
            expect(fetchMock).toHaveBeenCalledTimes(1)
            const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
            const [putURL, putInit] = call
            expect(putURL).toBe('https://minio.local/presigned')
            expect(putInit.method).toBe('PUT')
            expect((putInit.headers as Record<string, string>)['Content-Type']).toBe('application/pdf')
            // Finalize
            expect(authedFetch).toHaveBeenNthCalledWith(2, '/mathcenter/series/100/pdf/publish', {body: {object_key: key}})
        } finally {
            globalThis.fetch = originalFetch
        }
    })

    it('publishSeries surfaces a PUT failure from the bucket', async () => {
        authedFetch.mockImplementation(async (path: string) => {
            if (path === '/mathcenter/series/7/pdf/upload-url') {
                return {object_key: 'k', upload_url: 'https://minio.local/p'}
            }
            throw new Error(`unexpected path ${path}`)
        })
        const fetchMock = vi.fn(async () => ({ok: false, status: 403} as Response))
        const originalFetch = globalThis.fetch
        globalThis.fetch = fetchMock as never
        try {
            await expect(publishSeries(authedFetch as never, 7, new Blob(['x']))).rejects.toThrow(/403/)
            // Publish must NOT be called if the upload itself failed.
            expect(authedFetch).toHaveBeenCalledTimes(1)
        } finally {
            globalThis.fetch = originalFetch
        }
    })

    it('fetchSeriesPDFObjectURL forces application/pdf when the server sent the wrong type', async () => {
        const originalCreate = URL.createObjectURL
        URL.createObjectURL = vi.fn(() => 'blob:forced-pdf')

        const wrongTypeBlob = new Blob(['pdfbytes'], {type: 'application/octet-stream'})
        const raw = vi.fn(async () => ({blob: async () => wrongTypeBlob} as Response))
        try {
            const url = await fetchSeriesPDFObjectURL(raw as never, 100)
            expect(url).toBe('blob:forced-pdf')
            // The blob handed to createObjectURL must have been re-typed to PDF
            // so the browser's PDF viewer kicks in instead of "save as".
            const blobArg = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob
            expect(blobArg.type).toBe('application/pdf')
        } finally {
            URL.createObjectURL = originalCreate
        }
    })

    it('fetchSeriesPDFObjectURL passes the original blob through when type is already correct', async () => {
        const originalCreate = URL.createObjectURL
        URL.createObjectURL = vi.fn(() => 'blob:passthrough')

        const goodBlob = new Blob(['pdfbytes'], {type: 'application/pdf'})
        const raw = vi.fn(async () => ({blob: async () => goodBlob} as Response))
        try {
            await fetchSeriesPDFObjectURL(raw as never, 100)
            const blobArg = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob
            expect(blobArg).toBe(goodBlob)
        } finally {
            URL.createObjectURL = originalCreate
        }
    })

    it('downloadSeriesPDF triggers a save-as with a sanitized filename', async () => {
        // jsdom doesn't implement createObjectURL/revokeObjectURL; stub them.
        const originalCreate = URL.createObjectURL
        const originalRevoke = URL.revokeObjectURL
        URL.createObjectURL = vi.fn(() => 'blob:mock')
        URL.revokeObjectURL = vi.fn()

        const raw = vi.fn(async () => ({blob: async () => new Blob(['pdfbytes'], {type: 'application/pdf'})} as Response))
        const series = mockSeries({display_name: 'Серия 1. Алгебра/раздел "1"'})

        const clicked: HTMLAnchorElement[] = []
        const originalClick = HTMLAnchorElement.prototype.click
        HTMLAnchorElement.prototype.click = function () {
            clicked.push(this as HTMLAnchorElement)
        }
        try {
            await downloadSeriesPDF(raw as never, series)
        } finally {
            HTMLAnchorElement.prototype.click = originalClick
            URL.createObjectURL = originalCreate
            URL.revokeObjectURL = originalRevoke
        }

        expect(raw).toHaveBeenCalledWith('/mathcenter/series/100/pdf')
        expect(clicked).toHaveLength(1)
        // Slashes and quotes must be removed; everything else is preserved.
        expect(clicked[0].download).toBe('Серия 1. Алгебра_раздел _1_.pdf')
        expect(clicked[0].href).toContain('blob:mock')
    })
})
