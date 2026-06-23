// Internal teacher-only comments: notes on a solution thread and notes on a
// student, plus the teacher-facing student profile. Teacher-gated on the
// backend; these hooks run unchanged on web and native.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { InternalNote, StudentProfile } from '../types'
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
export function useStudentProfile(centerId: number, studentUserId: number) {
  const client = useApiClient()
  return useQuery<StudentProfile>({
    queryKey: queryKeys.studentProfile(centerId, studentUserId),
    queryFn: () =>
      client.request<StudentProfile>(studentBasePath(centerId, studentUserId) + '/'),
    enabled: centerId > 0 && studentUserId > 0,
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
      qc.invalidateQueries({ queryKey: queryKeys.centerGrid(centerId) })
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
      qc.invalidateQueries({ queryKey: queryKeys.centerGrid(centerId) })
    },
  })
}
