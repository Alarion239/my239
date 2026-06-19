// Homework thread data layer: the per-(student, subproblem) submission /
// grading timeline plus the teacher queue, grid, and stats. TanStack Query
// hooks that run unchanged on web and React Native — UI and routing stay
// platform-specific. Mutations write the fresh ThreadView back into the cache
// and invalidate every list view that reflects the new state.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type {
  GradePayload,
  GraderStats,
  GridResponse,
  QueueItem,
  SubmitOrAppealPayload,
  SubproblemContext,
  ThreadView,
  UploadURLsResponse,
} from '../types'
import type { ApiClient } from '../api/client'
import { useApiClient } from './context'
import { queryKeys } from './keys'

// --- Queries -----------------------------------------------------------------

// useThread fetches one thread's full timeline + cache state by thread id.
export function useThread(threadId: number) {
  const client = useApiClient()
  return useQuery<ThreadView>({
    queryKey: queryKeys.thread(threadId),
    queryFn: () =>
      client.request<ThreadView>('/homework/threads/by-id/' + threadId),
    enabled: threadId > 0,
  })
}

// useSubproblemContext fetches the context needed before a thread exists (the
// first-submission flow): series due-date + problem/series identifiers.
export function useSubproblemContext(subproblemId: number) {
  const client = useApiClient()
  return useQuery<SubproblemContext>({
    queryKey: queryKeys.subproblemContext(subproblemId),
    queryFn: () =>
      client.request<SubproblemContext>(
        '/homework/subproblems/' + subproblemId,
      ),
    enabled: subproblemId > 0,
  })
}

// useGraderQueue lists submissions/appeals awaiting grading in a series.
// `mine` filters to the calling grader's own claims + appeals routed back.
export function useGraderQueue(seriesId: number, mine: boolean) {
  const client = useApiClient()
  return useQuery<QueueItem[]>({
    queryKey: queryKeys.graderQueue(seriesId, mine),
    queryFn: () =>
      client.request<QueueItem[]>(
        '/homework/series/' + seriesId + '/queue' + (mine ? '?mine=true' : ''),
      ),
    enabled: seriesId > 0,
  })
}

// useTeacherGrid fetches the students × subproblems status grid for a series.
export function useTeacherGrid(seriesId: number) {
  const client = useApiClient()
  return useQuery<GridResponse>({
    queryKey: queryKeys.teacherGrid(seriesId),
    queryFn: () =>
      client.request<GridResponse>('/homework/series/' + seriesId + '/grid'),
    enabled: seriesId > 0,
  })
}

// useGraderStats fetches the at-a-glance grading workload for a center.
export function useGraderStats(centerId: number) {
  const client = useApiClient()
  return useQuery<GraderStats>({
    queryKey: queryKeys.graderStats(centerId),
    queryFn: () =>
      client.request<GraderStats>(
        '/homework/centers/' + centerId + '/grader-stats',
      ),
    enabled: centerId > 0,
  })
}

// --- Cache plumbing ----------------------------------------------------------

// applyThread writes a fresh ThreadView into the thread cache and invalidates
// every list view that reflects its state (the student rollup, teacher stats,
// the queue in both `mine` variants, the grid, and the center grader stats).
function applyThread(qc: QueryClient, thread: ThreadView): void {
  qc.setQueryData(queryKeys.thread(thread.id), thread)
  qc.invalidateQueries({ queryKey: queryKeys.myRollup(thread.series_id) })
  qc.invalidateQueries({ queryKey: queryKeys.problemStats(thread.series_id) })
  qc.invalidateQueries({ queryKey: queryKeys.teacherGrid(thread.series_id) })
  qc.invalidateQueries({ queryKey: queryKeys.graderStats(thread.math_center_id) })
  // Both `mine=true|false` queue variants share this prefix.
  qc.invalidateQueries({
    queryKey: ['homework', 'series', thread.series_id, 'queue'],
  })
}

// --- Mutations ---------------------------------------------------------------

// useSubmitAttempt submits (or resubmits) a student attempt for a subproblem.
// The thread is found-or-created server-side; the returned ThreadView is the
// new state.
export function useSubmitAttempt(subproblemId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SubmitOrAppealPayload) =>
      client.request<ThreadView>(
        '/homework/threads/' + subproblemId + '/submit',
        { method: 'POST', body: payload },
      ),
    onSuccess: (thread) => applyThread(qc, thread),
  })
}

// useAppealGrade files an appeal against the current rejection of a subproblem.
export function useAppealGrade(subproblemId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SubmitOrAppealPayload) =>
      client.request<ThreadView>(
        '/homework/threads/' + subproblemId + '/appeal',
        { method: 'POST', body: payload },
      ),
    onSuccess: (thread) => applyThread(qc, thread),
  })
}

// useClaimThread acquires the 15-minute grading lock on a thread.
export function useClaimThread(threadId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      client.request<ThreadView>(
        '/homework/threads/by-id/' + threadId + '/claim',
        { method: 'POST' },
      ),
    onSuccess: (thread) => applyThread(qc, thread),
  })
}

// useGradeThread records a verdict (with required comment + optional photos).
// Requires holding the claim; appeals can only be graded by the original
// grader or an admin.
export function useGradeThread(threadId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: GradePayload) =>
      client.request<ThreadView>(
        '/homework/threads/by-id/' + threadId + '/grade',
        { method: 'POST', body: payload },
      ),
    onSuccess: (thread) => applyThread(qc, thread),
  })
}

// useRetractGrade undoes a verdict (admin or the original grader), returning the
// thread to its prior state. `body` is an optional reason.
export function useRetractGrade(threadId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) =>
      client.request<ThreadView>(
        '/homework/threads/by-id/' + threadId + '/retract',
        { method: 'POST', body: { body } },
      ),
    onSuccess: (thread) => applyThread(qc, thread),
  })
}

// --- Claim heartbeat / release (fire-and-forget, 204) ------------------------

// heartbeatClaim extends the caller's grading lease. Returns void (204).
export function heartbeatClaim(
  client: ApiClient,
  threadId: number,
): Promise<void> {
  return client.request<void>(
    '/homework/threads/by-id/' + threadId + '/claim/heartbeat',
    { method: 'POST' },
  )
}

// releaseClaim voluntarily drops the caller's grading lease. Returns void (204).
export function releaseClaim(
  client: ApiClient,
  threadId: number,
): Promise<void> {
  return client.request<void>(
    '/homework/threads/by-id/' + threadId + '/claim/release',
    { method: 'POST' },
  )
}

// --- Photo upload handshake --------------------------------------------------

// newEventUUID returns 32 hex chars from the platform CSPRNG — used by flows
// that don't go through the upload-urls round-trip (text-only appeals,
// retractions) but still need an event UUID to append.
export function newEventUUID(): string {
  const buf = new Uint8Array(16)
  globalThis.crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

// uploadThreadPhotos runs the presigned-PUT handshake for a submit / appeal /
// grade attachment set: mint upload URLs, PUT each file straight to storage
// (raw — NO auth/act-as headers; the signed URL carries its own credentials),
// and return the event_uuid + object_keys to feed into the finalize call.
// `kind` selects the student vs. grader upload endpoint; `id` is the
// subproblemId (student) or threadId (grader). The no-photos case skips the
// round-trip and mints a UUID client-side.
export async function uploadThreadPhotos(
  client: ApiClient,
  kind: 'student' | 'grader',
  id: number,
  files: File[],
): Promise<{ event_uuid: string; object_keys: string[] }> {
  if (files.length === 0) {
    return { event_uuid: newEventUUID(), object_keys: [] }
  }
  const contentTypes = files.map((f) => f.type || 'image/jpeg')
  const path =
    kind === 'student'
      ? '/homework/threads/' + id + '/upload-urls'
      : '/homework/threads/by-id/' + id + '/upload-urls'
  const minted = await client.request<UploadURLsResponse>(path, {
    method: 'POST',
    body: { content_types: contentTypes },
  })
  // Upload sequentially so a failure surfaces with a known file index.
  for (let i = 0; i < files.length; i++) {
    const slot = minted.slots[i]
    const res = await fetch(slot.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': slot.content_type },
      body: files[i],
    })
    if (!res.ok) {
      throw new Error('Не удалось загрузить фото (' + res.status + ')')
    }
  }
  return {
    event_uuid: minted.event_uuid,
    object_keys: minted.slots.map((s) => s.object_key),
  }
}
