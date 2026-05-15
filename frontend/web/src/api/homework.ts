// Homework API client. Mirrors backend/internal/handlers/homework shapes 1:1.
//
// Photo uploads use a presigned-PUT handshake:
//   1. POST upload-urls → { event_uuid, slots: [{object_key, upload_url}, …] }
//   2. PUT each file to its upload_url with the matching Content-Type (no auth)
//   3. POST submit / appeal / grade with { event_uuid, body, object_keys: [...] }
// This keeps the bytes off our server entirely — they flow client ↔ Yandex.

import type {AuthedRawOpts} from '../auth'

type AuthedFetch = <T>(path: string, opts?: { method?: string; body?: unknown }) => Promise<T>
type AuthedFetchRaw = (path: string, opts?: AuthedRawOpts) => Promise<Response>

// Domain enums kept as union types so handlers can switch with exhaustiveness.
export type ThreadStatus =
    | 'ungraded'
    | 'submitted'
    | 'accepted'
    | 'rejected'
    | 'appealed'

export type EventKind =
    | 'submitted'
    | 'claimed'
    | 'released'
    | 'graded'
    | 'retracted'
    | 'appealed'

export type Verdict = 'accepted' | 'rejected'

export interface PhotoView {
    index: number
    object_key: string
    url: string
    content_type: string
    size_bytes: number
}

export interface EventView {
    id: number
    event_uuid: string
    kind: EventKind
    actor_user_id: number
    body: string
    verdict?: Verdict | null
    refers_to_event_id?: number | null
    created_at: string
    photos: PhotoView[]
}

export interface ThreadView {
    id: number
    student_user_id: number
    subproblem_id: number
    series_id: number
    // ISO-8601. The frontend uses this to gate the submit form so a
    // student can't get a 409 from the backend after the deadline.
    series_due_at: string
    math_center_id: number
    current_status: ThreadStatus
    last_grader_user_id?: number | null
    claim_holder_user_id?: number | null
    claim_expires_at?: string | null
    created_at: string
    updated_at: string
    events: EventView[]
    // Display-name lookup for every user_id that appears on this page
    // (student, last_grader, claim_holder, event actors). Keys are
    // stringified user IDs — JSON object keys are strings, and Go marshals
    // map[int64]string with stringified keys.
    users: Record<string, string>
}

// userNameFromThread renders the display name for a user_id that appears
// on the thread page. Returns a sensible fallback when the id isn't in
// the map (e.g. an old event whose actor was deleted).
export function userNameFromThread(thread: ThreadView, userID: number | null | undefined): string {
    if (userID == null) return ''
    return thread.users[String(userID)] ?? 'неизвестно'
}

export interface UploadSlot {
    index: number
    object_key: string
    upload_url: string
    content_type: string
}

export interface UploadURLsResponse {
    event_uuid: string
    slots: UploadSlot[]
}

// --- Student rollup ---------------------------------------------------------

export interface RollupSubproblem {
    subproblem_id: number
    subproblem_label: string
    thread_id: number
    current_status: ThreadStatus
}

export interface RollupProblem {
    problem_id: number
    problem_number: number
    problem_display: string
    subproblems: RollupSubproblem[]
}

export interface RollupCounts {
    accepted: number
    rejected: number
    pending: number
}

export interface MyRollupResponse {
    counts: RollupCounts
    problems: RollupProblem[]
}

// --- Teacher grid -----------------------------------------------------------

export interface GridColumn {
    subproblem_id: number
    subproblem_label: string
    problem_id: number
    problem_number: number
    problem_display: string
}

export interface GridCell {
    subproblem_id: number
    subproblem_label: string
    problem_id: number
    problem_number: number
    thread_id: number  // 0 when no thread exists yet
    current_status: ThreadStatus
    last_grader_user_id?: number | null
    claim_holder_user_id?: number | null
    claim_expires_at?: string | null
}

export interface GridStudent {
    student_user_id: number
    student_name: string
    group_id: number
    group_name: string
    cells: GridCell[]
}

export interface GridResponse {
    columns: GridColumn[]
    students: GridStudent[]
}

// --- Teacher all-series spreadsheet -----------------------------------------

export interface CenterGridGroup {
    group_id: number
    name: string
    students: {user_id: number; name: string}[]
}

export interface CenterGridColumn {
    subproblem_id: number
    subproblem_label: string
    problem_id: number
    problem_number: number
    // Short header rendered as-is in the spreadsheet — "Упр", "1", "2a"…
    column_label: string
}

export interface CenterGridSeries {
    series_id: number
    number: number
    name: string
    display_name: string
    due_at: string
    columns: CenterGridColumn[]
}

export interface CenterGridCell {
    thread_id: number
    current_status: ThreadStatus
    last_grader_user_id?: number | null
    claim_holder_user_id?: number | null
    claim_expires_at?: string | null
}

// CenterGridResponse keeps cells in a flat map keyed by "<studentId>:<subId>"
// so the frontend can do O(1) lookups while iterating rows × columns.
// Absent keys = "no thread yet" (i.e. ungraded with no submission).
export interface CenterGridResponse {
    groups: CenterGridGroup[]
    series: CenterGridSeries[]
    cells: Record<string, CenterGridCell>
}

export function getCenterGrid(authedFetch: AuthedFetch, centerID: number): Promise<CenterGridResponse> {
    return authedFetch<CenterGridResponse>(`/homework/centers/${centerID}/grid`)
}

export function centerGridCellKey(studentID: number, subproblemID: number): string {
    return `${studentID}:${subproblemID}`
}

// --- Grader queue and stats -------------------------------------------------

export interface QueueItem {
    thread_id: number
    student_user_id: number
    student_name: string
    subproblem_id: number
    subproblem_label: string
    problem_number: number
    problem_display: string
    current_status: ThreadStatus
    last_grader_user_id?: number | null
    claim_holder_user_id?: number | null
    claim_expires_at?: string | null
    updated_at: string
}

export interface GraderStats {
    pending_count: number
    my_claimed_count: number
    my_appeals_count: number
}

// --- API client functions ---------------------------------------------------

export function getMyRollup(authedFetch: AuthedFetch, seriesID: number): Promise<MyRollupResponse> {
    return authedFetch<MyRollupResponse>(`/homework/series/${seriesID}/my`)
}

export function getGrid(authedFetch: AuthedFetch, seriesID: number): Promise<GridResponse> {
    return authedFetch<GridResponse>(`/homework/series/${seriesID}/grid`)
}

export function getGraderQueue(authedFetch: AuthedFetch, seriesID: number, mine: boolean): Promise<QueueItem[]> {
    const qs = mine ? '?mine=true' : ''
    return authedFetch<QueueItem[]>(`/homework/series/${seriesID}/queue${qs}`)
}

export function getGraderStats(authedFetch: AuthedFetch, centerID: number): Promise<GraderStats> {
    return authedFetch<GraderStats>(`/homework/centers/${centerID}/grader-stats`)
}

export function getThread(authedFetch: AuthedFetch, threadID: number): Promise<ThreadView> {
    return authedFetch<ThreadView>(`/homework/threads/by-id/${threadID}`)
}

// SubproblemContext is what the "new submission" page needs before any
// thread exists: the series due-date (to gate the submit form) and the
// problem/series identifiers so navigation can return to the right place.
export interface SubproblemContext {
    subproblem_id: number
    subproblem_label: string
    problem_id: number
    problem_number: number
    problem_display: string
    series_id: number
    math_center_id: number
    series_due_at: string
    series_published_at?: string | null
}

export function getSubproblemContext(authedFetch: AuthedFetch, subproblemID: number): Promise<SubproblemContext> {
    return authedFetch<SubproblemContext>(`/homework/subproblems/${subproblemID}`)
}

// isClosed returns true when the deadline ISO has passed. Centralized so
// every UI surface that branches on "submit / view-only" stays in lockstep.
export function isClosed(dueAt: string | null | undefined): boolean {
    if (!dueAt) return false
    const t = new Date(dueAt).getTime()
    return Number.isFinite(t) && t < Date.now()
}

// requestStudentUploadURLs mints presigned PUT URLs for a student attempt or
// appeal. The thread is found-or-created server-side; the returned event_uuid
// must be echoed back on the matching submit/appeal call.
export function requestStudentUploadURLs(
    authedFetch: AuthedFetch,
    subproblemID: number,
    contentTypes: string[],
): Promise<UploadURLsResponse> {
    return authedFetch<UploadURLsResponse>(`/homework/threads/${subproblemID}/upload-urls`, {
        body: {content_types: contentTypes},
    })
}

// requestGraderUploadURLs mints presigned PUT URLs for a grader comment
// photo. Same shape as the student variant; different auth path on the
// server.
export function requestGraderUploadURLs(
    authedFetch: AuthedFetch,
    threadID: number,
    contentTypes: string[],
): Promise<UploadURLsResponse> {
    return authedFetch<UploadURLsResponse>(`/homework/threads/by-id/${threadID}/upload-urls`, {
        body: {content_types: contentTypes},
    })
}

// uploadFileToSlot performs the client → Yandex PUT for a single photo. The
// presigned URL embeds the auth signature so we deliberately do NOT attach
// our own bearer token here — adding it would invalidate the signature.
// Content-Type must exactly match what the server signed for.
export async function uploadFileToSlot(slot: UploadSlot, file: File | Blob): Promise<void> {
    const res = await fetch(slot.upload_url, {
        method: 'PUT',
        headers: {'Content-Type': slot.content_type},
        body: file,
    })
    if (!res.ok) {
        throw new Error(`upload failed (${res.status})`)
    }
}

export interface SubmitOrAppealPayload {
    event_uuid: string
    body: string
    object_keys: string[]
}

export function submitAttempt(
    authedFetch: AuthedFetch,
    subproblemID: number,
    payload: SubmitOrAppealPayload,
): Promise<ThreadView> {
    return authedFetch<ThreadView>(`/homework/threads/${subproblemID}/submit`, {body: payload})
}

export function appealGrade(
    authedFetch: AuthedFetch,
    subproblemID: number,
    payload: SubmitOrAppealPayload,
): Promise<ThreadView> {
    return authedFetch<ThreadView>(`/homework/threads/${subproblemID}/appeal`, {body: payload})
}

export interface GradePayload {
    verdict: Verdict
    body: string
    event_uuid: string
    object_keys: string[]
}

export function gradeThread(
    authedFetch: AuthedFetch,
    threadID: number,
    payload: GradePayload,
): Promise<ThreadView> {
    return authedFetch<ThreadView>(`/homework/threads/by-id/${threadID}/grade`, {body: payload})
}

export function retractGrade(
    authedFetch: AuthedFetch,
    threadID: number,
    body: string,
): Promise<ThreadView> {
    return authedFetch<ThreadView>(`/homework/threads/by-id/${threadID}/retract`, {body: {body}})
}

export function claimThread(authedFetch: AuthedFetch, threadID: number): Promise<ThreadView> {
    return authedFetch<ThreadView>(`/homework/threads/by-id/${threadID}/claim`, {method: 'POST'})
}

// Heartbeat / release are fire-and-forget from the client side; the server
// returns 204 on success. authedFetch surfaces a 409 as an APIErrorImpl.
export function heartbeatClaim(authedFetchRaw: AuthedFetchRaw, threadID: number): Promise<Response> {
    return authedFetchRaw(`/homework/threads/by-id/${threadID}/claim/heartbeat`, {method: 'POST'})
}

export function releaseClaim(authedFetchRaw: AuthedFetchRaw, threadID: number): Promise<Response> {
    return authedFetchRaw(`/homework/threads/by-id/${threadID}/claim/release`, {method: 'POST'})
}

// newEventUUID returns 32 hex chars from crypto.getRandomValues — used by
// flows that don't go through the upload-urls roundtrip (text-only
// appeals, retractions) but still need an event UUID for the append.
export function newEventUUID(): string {
    const buf = new Uint8Array(16)
    crypto.getRandomValues(buf)
    return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('')
}

// uploadPhotos ties together the upload-url request, the per-file PUTs,
// and the final object_keys list. Returns (event_uuid, object_keys) so
// the caller can feed them into submit / appeal / grade.
export async function uploadPhotos(
    authedFetch: AuthedFetch,
    kind: 'student' | 'grader',
    id: number,
    files: File[],
): Promise<{ event_uuid: string; object_keys: string[] }> {
    if (files.length === 0) {
        // No photos: skip the upload-url round-trip and mint a UUID
        // client-side. The finalize endpoint accepts empty object_keys.
        return {event_uuid: newEventUUID(), object_keys: []}
    }
    const cts = files.map(f => f.type || 'image/jpeg')
    const slots = kind === 'student'
        ? await requestStudentUploadURLs(authedFetch, id, cts)
        : await requestGraderUploadURLs(authedFetch, id, cts)
    // Upload sequentially so a failure surfaces with the file index for
    // user-visible error messages.
    for (let i = 0; i < files.length; i++) {
        await uploadFileToSlot(slots.slots[i], files[i])
    }
    return {
        event_uuid: slots.event_uuid,
        object_keys: slots.slots.map(s => s.object_key),
    }
}

// --- Display helpers --------------------------------------------------------

// statusColor maps a thread status to the design-system color the cell /
// card should render in. Returns a CSS color string from the project palette.
export function statusBackgroundColor(status: ThreadStatus): string {
    switch (status) {
        case 'accepted':
            return '#d1fae5'  // light green
        case 'rejected':
            return '#fee2e2'  // light red
        case 'submitted':
            return '#fef3c7'  // light amber — pending grader action
        case 'appealed':
            return '#ede9fe'  // light violet — appeal pending
        case 'ungraded':
        default:
            return '#f3f4f6'  // neutral gray
    }
}

export function statusBorderColor(status: ThreadStatus): string {
    switch (status) {
        case 'accepted':
            return '#15803d'
        case 'rejected':
            return '#dc2626'
        case 'submitted':
            return '#d97706'
        case 'appealed':
            return '#7c3aed'
        case 'ungraded':
        default:
            return '#d1d5db'
    }
}

// statusLabel returns the single-task form ("Принята", not "Приняты")
// agreeing with the implicit feminine noun "задача" — used by per-tile
// tooltips and the thread header pill, where there is exactly one
// subject. The pluralized forms ("Приняты", "Отклонены", "Проверяются",
// "Не решены") are produced by ruPlural below for the count badges.
export function statusLabel(status: ThreadStatus): string {
    switch (status) {
        case 'accepted':
            return 'Принята'
        case 'rejected':
            return 'Отклонена'
        case 'submitted':
            return 'Проверяется'
        case 'appealed':
            return 'Проверяется'
        case 'ungraded':
        default:
            return 'Не решена'
    }
}

// ruPlural picks the singular vs plural form for a count modifier on an
// implicit feminine noun ("задача"). When the noun itself is omitted, modern
// Russian uses the singular only for numbers ending in 1 (excluding the
// teens 11..19); every other count — including zero — takes the plural.
//
// Examples:
//   1 не решена, 21 не решена, 101 не решена
//   0 не решены, 2 не решены, 5 не решены, 11 не решены, 25 не решены
export function ruPlural(n: number, singular: string, plural: string): string {
    const abs = Math.abs(n)
    const mod10 = abs % 10
    const mod100 = abs % 100
    if (mod10 === 1 && mod100 !== 11) return singular
    return plural
}

// GranularCounts splits the rollup's "pending" into two distinct buckets:
// threads a grader is actively looking at (submitted+appealed = the count
// we surface as "Проверяется") and threads with no submission yet ("Не
// решена"). The server's StudentSeriesCounts row collapses both into
// pending_count, so we recompute these in the frontend from the per-
// subproblem rollup which already arrives with each series.
export interface GranularCounts {
    accepted: number
    rejected: number
    checking: number
    not_solved: number
    total: number
}

export function computeGranularCounts(problems: RollupProblem[]): GranularCounts {
    let accepted = 0
    let rejected = 0
    let checking = 0
    let not_solved = 0
    for (const p of problems) {
        for (const sp of p.subproblems) {
            switch (sp.current_status) {
                case 'accepted':
                    accepted++
                    break
                case 'rejected':
                    rejected++
                    break
                case 'submitted':
                case 'appealed':
                    checking++
                    break
                case 'ungraded':
                default:
                    not_solved++
                    break
            }
        }
    }
    return {accepted, rejected, checking, not_solved, total: accepted + rejected + checking + not_solved}
}

export function eventKindLabel(kind: EventKind, verdict?: Verdict | null): string {
    switch (kind) {
        case 'submitted':
            return 'Решение'
        case 'graded':
            return verdict === 'accepted' ? 'Принято' : 'Отклонено'
        case 'retracted':
            return 'Оценка отозвана'
        case 'appealed':
            return 'Апелляция'
        case 'claimed':
            return 'Взято в проверку'
        case 'released':
            return 'Освобождено'
        default:
            return kind
    }
}
