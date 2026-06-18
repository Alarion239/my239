// Admin data layer as TanStack Query hooks. Like the auth hooks, these run
// unchanged on web and React Native — UI and routing stay platform-specific.
// Every endpoint here is admin-gated server-side; non-admins get a 401/403.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  InvitationToken,
  MathCenter,
  MathCenterGroup,
  MathCenterStudent,
  MathCenterTeacher,
  User,
  UserEnrollments,
} from '../types'
import { useApiClient } from './context'
import { queryKeys } from './keys'

// --- Users -------------------------------------------------------------------

// useAdminUsers backs the web "View as" picker: the full user list an admin can
// impersonate.
export function useAdminUsers() {
  const client = useApiClient()
  return useQuery<User[]>({
    queryKey: queryKeys.adminUsers,
    queryFn: () => client.request<User[]>('/admin/users'),
  })
}

export function useSetUserAdmin() {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, isAdmin }: { userId: number; isAdmin: boolean }) =>
      client.request('/admin/users/' + userId + '/admin', {
        method: 'PATCH',
        body: { is_admin: isAdmin },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.adminUsers }),
  })
}

// useAdminUser backs the admin "manage one user" view: a single user record.
export function useAdminUser(userId: number) {
  const client = useApiClient()
  return useQuery<User>({
    queryKey: queryKeys.adminUser(userId),
    queryFn: () => client.request<User>('/admin/users/' + userId),
    enabled: userId > 0,
  })
}

// useUserEnrollments returns the user's teaching + student roles, the data the
// admin user-management UI edits via the mutations below.
export function useUserEnrollments(userId: number) {
  const client = useApiClient()
  return useQuery<UserEnrollments>({
    queryKey: queryKeys.userEnrollments(userId),
    queryFn: () =>
      client.request<UserEnrollments>(
        '/admin/users/' + userId + '/enrollments',
      ),
    enabled: userId > 0,
  })
}

// --- User enrollment management ----------------------------------------------
// Mutations the admin user view uses to add/remove a user's math-center roles.
// Each takes the userId so it can invalidate that user's enrollments cache.

export function useEnrollTeacher() {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      centerId,
      userId,
      isHeadTeacher,
    }: {
      centerId: number
      userId: number
      isHeadTeacher: boolean
    }) =>
      client.request<MathCenterTeacher>(
        '/admin/mathcenter/' + centerId + '/teachers',
        {
          method: 'POST',
          body: { user_id: userId, is_head_teacher: isHeadTeacher },
        },
      ),
    onSuccess: (_data, { userId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.userEnrollments(userId) })
      qc.invalidateQueries({ queryKey: queryKeys.adminUsers })
    },
  })
}

export function useRemoveTeacher() {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      teacherId,
    }: {
      teacherId: number
      userId: number
    }) =>
      client.request('/admin/mathcenter/teachers/' + teacherId, {
        method: 'DELETE',
      }),
    onSuccess: (_data, { userId }) =>
      qc.invalidateQueries({ queryKey: queryKeys.userEnrollments(userId) }),
  })
}

export function useSetTeacherHead() {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      teacherId,
      isHeadTeacher,
    }: {
      teacherId: number
      userId: number
      isHeadTeacher: boolean
    }) =>
      client.request(
        '/admin/mathcenter/teachers/' + teacherId + '/head',
        { method: 'PATCH', body: { is_head_teacher: isHeadTeacher } },
      ),
    onSuccess: (_data, { userId }) =>
      qc.invalidateQueries({ queryKey: queryKeys.userEnrollments(userId) }),
  })
}

export function useEnrollStudent() {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      groupId,
      userId,
    }: {
      groupId: number
      userId: number
    }) =>
      client.request<MathCenterStudent>('/admin/mathcenter/students', {
        method: 'POST',
        body: { user_id: userId, group_id: groupId },
      }),
    onSuccess: (_data, { userId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.userEnrollments(userId) })
      qc.invalidateQueries({ queryKey: queryKeys.adminUsers })
    },
  })
}

export function useRemoveStudent() {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      studentId,
    }: {
      studentId: number
      userId: number
    }) =>
      client.request('/admin/mathcenter/students/' + studentId, {
        method: 'DELETE',
      }),
    onSuccess: (_data, { userId }) =>
      qc.invalidateQueries({ queryKey: queryKeys.userEnrollments(userId) }),
  })
}

// --- Invitation tokens -------------------------------------------------------

export function useAdminTokens() {
  const client = useApiClient()
  return useQuery<InvitationToken[]>({
    queryKey: queryKeys.adminTokens,
    queryFn: () => client.request<InvitationToken[]>('/admin/tokens'),
  })
}

export function useCreateToken() {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      description: string
      max_uses: number
      expires_in_hours: number
    }) =>
      client.request<InvitationToken>('/admin/tokens', {
        method: 'POST',
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.adminTokens }),
  })
}

export function useRevokeToken() {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      client.request('/admin/tokens/' + id, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.adminTokens }),
  })
}

// --- Math centers ------------------------------------------------------------

export function useMathCenters() {
  const client = useApiClient()
  return useQuery<MathCenter[]>({
    queryKey: queryKeys.adminCenters,
    queryFn: () => client.request<MathCenter[]>('/admin/mathcenter'),
  })
}

export function useCreateMathCenter() {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { graduation_year: number }) =>
      client.request<MathCenter>('/admin/mathcenter', {
        method: 'POST',
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.adminCenters }),
  })
}

export function useDeleteMathCenter() {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      client.request('/admin/mathcenter/' + id, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.adminCenters }),
  })
}

// --- Math center groups ------------------------------------------------------

export function useCenterGroups(centerId: number) {
  const client = useApiClient()
  return useQuery<MathCenterGroup[]>({
    queryKey: queryKeys.centerGroups(centerId),
    queryFn: () =>
      client.request<MathCenterGroup[]>(
        '/admin/mathcenter/' + centerId + '/groups',
      ),
    enabled: centerId > 0,
  })
}

export function useCreateGroup(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string }) =>
      client.request<MathCenterGroup>(
        '/admin/mathcenter/' + centerId + '/groups',
        { method: 'POST', body },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.centerGroups(centerId) }),
  })
}

export function useDeleteGroup(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (groupId: number) =>
      client.request(
        '/admin/mathcenter/' + centerId + '/groups/' + groupId,
        { method: 'DELETE' },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.centerGroups(centerId) }),
  })
}
