// Head-teacher management panel ("Управление") data layer. Every endpoint is
// gated server-side to head teachers (or admins) of the center; non-heads get a
// 403. Mounted at /mathcenter/centers/{centerId}/manage/*.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CenterInvite,
  InviteContext,
  MathCenterGroup,
  MathCenterStudent,
  MathCenterTeacher,
  ManageStudent,
  ManageTeacher,
  UserSearchResult,
} from '../types'
import { useApiClient } from './context'
import { queryKeys } from './keys'

function base(centerId: number): string {
  return '/mathcenter/centers/' + centerId + '/manage'
}

// --- Groups ------------------------------------------------------------------

export function useManageGroups(centerId: number) {
  const client = useApiClient()
  return useQuery<MathCenterGroup[]>({
    queryKey: queryKeys.manageGroups(centerId),
    queryFn: () => client.request<MathCenterGroup[]>(base(centerId) + '/groups'),
    enabled: centerId > 0,
  })
}

export function useManageCreateGroup(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string }) =>
      client.request<MathCenterGroup>(base(centerId) + '/groups', {
        method: 'POST',
        body,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.manageGroups(centerId) }),
  })
}

export function useManageDeleteGroup(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (groupId: number) =>
      client.request(base(centerId) + '/groups/' + groupId, { method: 'DELETE' }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.manageGroups(centerId) }),
  })
}

// --- Teachers ----------------------------------------------------------------

export function useManageTeachers(centerId: number) {
  const client = useApiClient()
  return useQuery<ManageTeacher[]>({
    queryKey: queryKeys.manageTeachers(centerId),
    queryFn: () => client.request<ManageTeacher[]>(base(centerId) + '/teachers'),
    enabled: centerId > 0,
  })
}

export function useManageAddTeacher(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { user_id: number; is_head_teacher: boolean }) =>
      client.request<MathCenterTeacher>(base(centerId) + '/teachers', {
        method: 'POST',
        body,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.manageTeachers(centerId) }),
  })
}

export function useManageSetTeacherHead(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      teacherId,
      isHeadTeacher,
    }: {
      teacherId: number
      isHeadTeacher: boolean
    }) =>
      client.request(base(centerId) + '/teachers/' + teacherId + '/head', {
        method: 'PATCH',
        body: { is_head_teacher: isHeadTeacher },
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.manageTeachers(centerId) }),
  })
}

export function useManageRemoveTeacher(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (teacherId: number) =>
      client.request(base(centerId) + '/teachers/' + teacherId, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.manageTeachers(centerId) }),
  })
}

// --- Students ----------------------------------------------------------------

export function useManageStudents(centerId: number) {
  const client = useApiClient()
  return useQuery<ManageStudent[]>({
    queryKey: queryKeys.manageStudents(centerId),
    queryFn: () => client.request<ManageStudent[]>(base(centerId) + '/students'),
    enabled: centerId > 0,
  })
}

export function useManageAddStudent(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { user_id: number; group_id: number }) =>
      client.request<MathCenterStudent>(base(centerId) + '/students', {
        method: 'POST',
        body,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.manageStudents(centerId) }),
  })
}

export function useManageSetStudentGroup(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ studentId, groupId }: { studentId: number; groupId: number }) =>
      client.request(base(centerId) + '/students/' + studentId + '/group', {
        method: 'PATCH',
        body: { group_id: groupId },
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.manageStudents(centerId) }),
  })
}

export function useManageRemoveStudent(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (studentId: number) =>
      client.request(base(centerId) + '/students/' + studentId, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.manageStudents(centerId) }),
  })
}

// --- User search -------------------------------------------------------------

export function useUserSearch(centerId: number, q: string) {
  const client = useApiClient()
  const query = q.trim()
  return useQuery<UserSearchResult[]>({
    queryKey: queryKeys.userSearch(centerId, query),
    queryFn: () =>
      client.request<UserSearchResult[]>(
        base(centerId) + '/user-search?q=' + encodeURIComponent(query),
      ),
    enabled: centerId > 0 && query.length >= 2,
  })
}

// --- Invites -----------------------------------------------------------------

export function useManageInvites(centerId: number) {
  const client = useApiClient()
  return useQuery<CenterInvite[]>({
    queryKey: queryKeys.manageInvites(centerId),
    queryFn: () => client.request<CenterInvite[]>(base(centerId) + '/invites'),
    enabled: centerId > 0,
  })
}

export function useManageCreateInvite(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      role: 'teacher' | 'student'
      group_id?: number
      is_head_teacher?: boolean
      description: string
      max_uses: number
      expires_in_hours: number
    }) =>
      client.request<CenterInvite>(base(centerId) + '/invites', {
        method: 'POST',
        body,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.manageInvites(centerId) }),
  })
}

export function useManageRevokeInvite(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tokenId: number) =>
      client.request(base(centerId) + '/invites/' + tokenId, { method: 'DELETE' }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.manageInvites(centerId) }),
  })
}

// --- Public invite-context lookup (registration page) ------------------------

export function useInviteContext(token: string) {
  const client = useApiClient()
  return useQuery<InviteContext>({
    queryKey: queryKeys.inviteContext(token),
    queryFn: () =>
      client.request<InviteContext>('/auth/invite/' + encodeURIComponent(token)),
    enabled: token.length > 0,
    retry: false,
  })
}
