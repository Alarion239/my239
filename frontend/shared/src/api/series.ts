// Math center series API client. Mirrors backend/internal/handlers/mathcenter
// shapes 1:1; the helpers are tiny so callers can stay declarative without
// every page hand-rolling URLs.

import type {AuthedFetch, AuthedFetchRaw} from './http'

export interface SeriesProblem {
    id: number
    number: number
    display_name: string
    subproblems: string[]
}

export interface Series {
    id: number
    math_center_id: number
    number: number
    name: string
    display_name: string
    due_at: string
    published: boolean
    published_at?: string | null
    has_pdf: boolean
    has_tex: boolean
    problems: SeriesProblem[]
}

// ProblemSpec is the shape sent on create/update — the server expands the
// subproblem labels (a, b, …) from `subproblem_count`, so we don't ship them.
export interface ProblemSpec {
    number: number
    subproblem_count: number
}

export interface SeriesPayload {
    number: number
    name: string
    // ISO-8601 string. Caller is responsible for the conversion (Date.toISOString).
    due_at: string
    problems: ProblemSpec[]
}


export function listSeriesForCenter(authedFetch: AuthedFetch, centerID: number): Promise<Series[]> {
    return authedFetch<Series[]>(`/mathcenter/centers/${centerID}/series`)
}

export function getSeries(authedFetch: AuthedFetch, id: number): Promise<Series> {
    return authedFetch<Series>(`/mathcenter/series/${id}`)
}

export function createSeries(authedFetch: AuthedFetch, centerID: number, payload: SeriesPayload): Promise<Series> {
    return authedFetch<Series>(`/mathcenter/centers/${centerID}/series`, {body: payload})
}

export function updateSeries(authedFetch: AuthedFetch, id: number, payload: SeriesPayload): Promise<Series> {
    return authedFetch<Series>(`/mathcenter/series/${id}`, {method: 'PUT', body: payload})
}

export function deleteSeries(authedFetch: AuthedFetch, id: number): Promise<void> {
    return authedFetch<void>(`/mathcenter/series/${id}`, {method: 'DELETE'})
}

// publishSeries uploads (or overwrites) the series PDF using the
// client-direct presigned-PUT flow:
//   1. POST /pdf/upload-url → { object_key, upload_url } from our backend
//   2. PUT the file body straight to that URL (no auth — the URL is signed)
//   3. POST /pdf/publish with the returned object_key to commit the row
//
// All bytes go client ↔ Yandex/MinIO; the backend only sees the small JSON
// envelopes. The server still enforces "must be application/pdf" and the
// 1 MiB cap when it HEADs the uploaded object in step 3.
export async function publishSeries(authedFetch: AuthedFetch, id: number, file: File | Blob): Promise<Series> {
    const presigned = await authedFetch<{object_key: string; upload_url: string}>(
        `/mathcenter/series/${id}/pdf/upload-url`,
        {method: 'POST'},
    )
    // The presigned URL embeds the SigV4 signature — adding our own bearer
    // would mismatch the signed headers, so we use plain fetch here.
    const putRes = await fetch(presigned.upload_url, {
        method: 'PUT',
        headers: {'Content-Type': 'application/pdf'},
        body: file,
    })
    if (!putRes.ok) {
        throw new Error(`upload failed (${putRes.status})`)
    }
    return await authedFetch<Series>(
        `/mathcenter/series/${id}/pdf/publish`,
        {body: {object_key: presigned.object_key}},
    )
}

// fetchSeriesPDFObjectURL pulls the PDF bytes via the auth-aware fetch
// (which transparently follows the presigned redirect, dropping the bearer
// token on the cross-origin hop) and wraps them in a blob: URL the browser
// can render in <iframe>/<embed> or open in a new tab.
//
// Important: callers OWN the returned URL and must call URL.revokeObjectURL
// when done. Object URLs hold the blob in memory until revoked or the
// document unloads — leaking them is silent but real.
export async function fetchSeriesPDFObjectURL(authedFetchRaw: AuthedFetchRaw, seriesID: number): Promise<string> {
    const res = await authedFetchRaw(`/mathcenter/series/${seriesID}/pdf`)
    const blob = await res.blob()
    // Force the MIME so embedded viewers don't fall back to "download".
    // Some object stores serve PDFs with application/octet-stream headers.
    const pdfBlob = blob.type === 'application/pdf' ? blob : new Blob([blob], {type: 'application/pdf'})
    return URL.createObjectURL(pdfBlob)
}

// downloadSeriesPDF triggers a save-as on the PDF. Reuses the same fetch
// helper so the file in the user's downloads matches what they'd see in the
// inline preview.
export async function downloadSeriesPDF(authedFetchRaw: AuthedFetchRaw, series: Series): Promise<void> {
    const url = await fetchSeriesPDFObjectURL(authedFetchRaw, series.id)
    const a = document.createElement('a')
    a.href = url
    // Sanitize the filename — Cyrillic is fine, but slashes and quotes break
    // some browsers' download prompts.
    const safe = series.display_name.replace(/[\\/"\n\r\t]/g, '_').trim() || `series-${series.id}`
    a.download = `${safe}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
}

// getSeriesTex fetches the raw LaTeX source for the series. The frontend
// feeds it to a LaTeX.js renderer; the server caps the payload at
// 512 KiB so we don't need streaming.
export async function getSeriesTex(authedFetch: AuthedFetch, id: number): Promise<string> {
    const res = await authedFetch<{tex: string}>(`/mathcenter/series/${id}/tex`)
    return res.tex
}

// setSeriesTex stores or replaces the LaTeX source. Returns the updated
// series view so callers can pick up the freshly-flipped published flag
// (the backend auto-publishes a draft on first save).
export function setSeriesTex(authedFetch: AuthedFetch, id: number, tex: string): Promise<Series> {
    return authedFetch<Series>(`/mathcenter/series/${id}/tex`, {method: 'PUT', body: {tex}})
}

export function deleteSeriesTex(authedFetch: AuthedFetch, id: number): Promise<Series> {
    return authedFetch<Series>(`/mathcenter/series/${id}/tex`, {method: 'DELETE'})
}

