// Internal teacher-only comments: notes on a solution thread and notes on a
// student, plus the teacher-facing student profile. Teacher-gated on the
// backend; these hooks run unchanged on web and native.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { InternalNote, StudentNameColorResponse, StudentProfile } from '../types'
import { useApiClient } from './context'
import { queryKeys } from './keys'

// --- Thread notes ------------------------------------------------------------

const threadNotesPath = (threadId: number) =>
  '/homework/threads/by-id/' + threadId + '/notes'

// useThreadNotes lists the internal notes on a solution thread. `enabled` lets
// the caller gate the fetch to teachers only.
export function useThreadNotes(threadId: number, enabled = true) {
  const client = useApiClient()
  return useQuery<InternalNote[]>({
    queryKey: queryKeys.threadNotes(threadId),
    queryFn: () => client.request<InternalNote[]>(threadNotesPath(threadId)),
    enabled: enabled && threadId > 0,
  })
}

export function useCreateThreadNote(threadId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) =>
      client.request<InternalNote>(threadNotesPath(threadId), {
        method: 'POST',
        body: { body },
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.threadNotes(threadId) }),
  })
}

export function useUpdateThreadNote(threadId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { noteId: number; body: string }) =>
      client.request<InternalNote>(threadNotesPath(threadId) + '/' + args.noteId, {
        method: 'PATCH',
        body: { body: args.body },
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.threadNotes(threadId) }),
  })
}

export function useDeleteThreadNote(threadId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (noteId: number) =>
      client.request<void>(threadNotesPath(threadId) + '/' + noteId, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.threadNotes(threadId) }),
  })
}

// --- Student profile + notes -------------------------------------------------

const studentBasePath = (centerId: number, studentUserId: number) =>
  '/mathcenter/centers/' + centerId + '/students/' + studentUserId

const studentNotesPath = (centerId: number, studentUserId: number) =>
  studentBasePath(centerId, studentUserId) + '/notes'

// useStudentProfile fetches a student's identity + group for the teacher page.
export function useStudentProfile(centerId: number, studentUserId: number, enabled = true) {
  const client = useApiClient()
  return useQuery<StudentProfile>({
    queryKey: queryKeys.studentProfile(centerId, studentUserId),
    queryFn: () =>
      client.request<StudentProfile>(studentBasePath(centerId, studentUserId) + '/'),
    enabled: enabled && centerId > 0 && studentUserId > 0,
  })
}

export function useStudentNotes(centerId: number, studentUserId: number) {
  const client = useApiClient()
  return useQuery<InternalNote[]>({
    queryKey: queryKeys.studentNotes(centerId, studentUserId),
    queryFn: () =>
      client.request<InternalNote[]>(studentNotesPath(centerId, studentUserId)),
    enabled: centerId > 0 && studentUserId > 0,
  })
}

// useUpdateStudentNameColor persists the teacher-only name background and
// keeps the open profile responsive while the server and other teacher views
// catch up through the center event stream.
export function useUpdateStudentNameColor(centerId: number, studentUserId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  const key = queryKeys.studentProfile(centerId, studentUserId)
  return useMutation({
    mutationFn: (backgroundHex: string | null) =>
      client.request<StudentNameColorResponse>(studentBasePath(centerId, studentUserId) + '/name-color', {
        method: 'PUT',
        body: { background_hex: backgroundHex },
      }),
    onMutate: async (backgroundHex) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<StudentProfile>(key)
      qc.setQueryData<StudentProfile>(key, (profile) =>
        profile ? { ...profile, background_hex: backgroundHex } : profile,
      )
      return { previous }
    },
    onError: (_error, _backgroundHex, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: queryKeys.centerGrids(centerId) })
      qc.invalidateQueries({ queryKey: queryKeys.manageRosterBoard(centerId) })
    },
  })
}

export function useCreateStudentNote(centerId: number, studentUserId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) =>
      client.request<InternalNote>(studentNotesPath(centerId, studentUserId), {
        method: 'POST',
        body: { body },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.studentNotes(centerId, studentUserId) })
      qc.invalidateQueries({ queryKey: queryKeys.centerGrids(centerId) })
    },
  })
}

export function useUpdateStudentNote(centerId: number, studentUserId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { noteId: number; body: string }) =>
      client.request<InternalNote>(
        studentNotesPath(centerId, studentUserId) + '/' + args.noteId,
        { method: 'PATCH', body: { body: args.body } },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.studentNotes(centerId, studentUserId) }),
  })
}

export function useDeleteStudentNote(centerId: number, studentUserId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (noteId: number) =>
      client.request<void>(studentNotesPath(centerId, studentUserId) + '/' + noteId, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.studentNotes(centerId, studentUserId) })
      qc.invalidateQueries({ queryKey: queryKeys.centerGrids(centerId) })
    },
  })
}
