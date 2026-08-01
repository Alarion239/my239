// Head-teacher management panel ("Управление") data layer. Every endpoint is
// gated server-side to head teachers (or admins) of the center; non-heads get a
// 403. Mounted at /mathcenter/centers/{centerId}/manage/*.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CenterInvite,
  GoogleSheetConfig,
  GoogleSheetLink,
  GoogleSheetSeriesSyncResult,
  GoogleSheetStudentSyncResult,
  GoogleSheetSyncRun,
  GoogleSheetTab,
  InviteContext,
  LatexPreamble,
  MathCenterGroup,
  MathCenterStudent,
  MathCenterTeacher,
  ManageSeriesRazborAccess,
  ManageRazborAccessResponse,
  ManageRosterBoardResponse,
  ManageStudent,
  ManageTeacher,
  UserSearchResult,
} from '../types'
import { useApiClient } from './context'
import { queryKeys } from './keys'

function base(centerId: number): string {
  return '/mathcenter/centers/' + centerId + '/manage'
}

export function useUpdateMathCenterLatexPreamble(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (preamble: string) =>
      client.request<LatexPreamble>(base(centerId) + '/latex-preamble', {
        method: 'PATCH',
        body: { preamble },
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.mathCenterLatexPreamble(centerId) }),
  })
}

// --- Groups ------------------------------------------------------------------

export function useManageGroups(centerId: number, termId = 0) {
  const client = useApiClient()
  return useQuery<MathCenterGroup[]>({
    queryKey: [...queryKeys.manageGroups(centerId), termId],
    queryFn: () => client.request<MathCenterGroup[]>(
      base(centerId) + '/groups' + (termId > 0 ? '?term_id=' + termId : ''),
    ),
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
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.manageGroups(centerId) }),
        qc.invalidateQueries({ queryKey: queryKeys.manageRosterBoard(centerId) }),
      ]),
  })
}

export function useManageDeleteGroup(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (groupId: number) =>
      client.request(base(centerId) + '/groups/' + groupId, { method: 'DELETE' }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.manageGroups(centerId) }),
        qc.invalidateQueries({ queryKey: queryKeys.manageRosterBoard(centerId) }),
      ]),
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

export function useManageRosterBoard(centerId: number) {
  const client = useApiClient()
  return useQuery<ManageRosterBoardResponse>({
    queryKey: queryKeys.manageRosterBoard(centerId),
    queryFn: () => client.request<ManageRosterBoardResponse>(base(centerId) + '/roster-board'),
    enabled: centerId > 0,
  })
}

export function useManageRazborAccess(centerId: number) {
  const client = useApiClient()
  return useQuery<ManageRazborAccessResponse>({
    queryKey: queryKeys.manageRazborAccess(centerId),
    queryFn: () =>
      client.request<ManageRazborAccessResponse>(base(centerId) + '/razbor-access'),
    enabled: centerId > 0,
  })
}

export interface ManageRazborAccessMutation {
  target: 'term' | 'group' | 'student'
  mode: 'series' | 'default'
  format: 'video' | 'pdf_tex'
  seriesId?: number
  groupId?: number
  studentId?: number
  allowed: boolean
}

export function useManageSetRazborAccess(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mutation: ManageRazborAccessMutation) =>
      client.request(base(centerId) + '/razbor-access', {
        method: 'PATCH',
        body: {
          target: mutation.target,
          mode: mutation.mode,
          format: mutation.format,
          series_id: mutation.seriesId ?? 0,
          group_id: mutation.groupId ?? 0,
          student_id: mutation.studentId ?? 0,
          allowed: mutation.allowed,
        },
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.manageRazborAccess(centerId) }),
  })
}

export function useManageAddStudent(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { user_id: number; group_id?: number }) =>
      client.request<MathCenterStudent>(base(centerId) + '/students', {
        method: 'POST',
        body,
      }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.manageStudents(centerId) }),
        qc.invalidateQueries({ queryKey: queryKeys.manageRosterBoard(centerId) }),
      ]),
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
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.manageStudents(centerId) }),
        qc.invalidateQueries({ queryKey: queryKeys.manageRosterBoard(centerId) }),
      ]),
  })
}

export function useManageSetRosterStudentGroup(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  const key = queryKeys.manageRosterBoard(centerId)
  return useMutation({
    mutationFn: ({ userId, groupId }: { userId: number; groupId: number | null }) =>
      client.request(base(centerId) + '/students/' + userId + '/group', {
        method: 'PUT',
        body: { group_id: groupId },
      }),
    onMutate: async ({ userId, groupId }) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<ManageRosterBoardResponse>(key)
      qc.setQueryData<ManageRosterBoardResponse>(key, (current) => {
        if (!current) return current
        return {
          ...current,
          students: current.students.map((student) =>
            student.user_id === userId
              ? { ...student, current_group_id: groupId }
              : student,
          ),
        }
      })
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous)
      qc.invalidateQueries({ queryKey: key })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: queryKeys.manageStudents(centerId) })
    },
  })
}

export function useManageSetStudentRazborAccess(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      studentId,
      canViewRazbors,
    }: {
      studentId: number
      canViewRazbors: boolean
    }) =>
      client.request(base(centerId) + '/students/' + studentId + '/razbor-access', {
        method: 'PATCH',
        body: { can_view_razbors: canViewRazbors },
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.manageStudents(centerId) }),
  })
}

export function useManageStudentSeriesRazborAccess(
  centerId: number,
  studentId: number,
) {
  const client = useApiClient()
  return useQuery<ManageSeriesRazborAccess[]>({
    queryKey: queryKeys.manageStudentRazborAccess(centerId, studentId),
    queryFn: () =>
      client.request<ManageSeriesRazborAccess[]>(
        base(centerId) + '/students/' + studentId + '/razbor-access',
      ),
    enabled: centerId > 0 && studentId > 0,
  })
}

export function useManageSetStudentSeriesRazborAccess(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      studentId,
      seriesId,
      canViewVideo,
      canViewPDFTex,
    }: {
      studentId: number
      seriesId: number
      canViewVideo: boolean
      canViewPDFTex: boolean
    }) =>
      client.request(
        base(centerId) +
          '/students/' +
          studentId +
          '/series/' +
          seriesId +
          '/razbor-access',
        {
          method: 'PATCH',
          body: {
            can_view_video: canViewVideo,
            can_view_pdf_tex: canViewPDFTex,
          },
        },
      ),
    onMutate: async (variables) => {
      const key = queryKeys.manageStudentRazborAccess(
        centerId,
        variables.studentId,
      )
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<ManageSeriesRazborAccess[]>(key)
      qc.setQueryData<ManageSeriesRazborAccess[]>(key, (rows) =>
        rows?.map((row) =>
          row.series_id === variables.seriesId
            ? {
                ...row,
                can_view_video: variables.canViewVideo,
                can_view_pdf_tex: variables.canViewPDFTex,
              }
            : row,
        ),
      )
      return { key, previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        qc.setQueryData(context.key, context.previous)
      }
    },
    onSettled: (_data, _error, variables) =>
      qc.invalidateQueries({
        queryKey: queryKeys.manageStudentRazborAccess(
          centerId,
          variables.studentId,
        ),
      }),
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
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.manageStudents(centerId) }),
        qc.invalidateQueries({ queryKey: queryKeys.manageRosterBoard(centerId) }),
      ]),
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

// --- Google Sheets conduit links -------------------------------------------

export function useGoogleSheetConfig(centerId: number) {
  const client = useApiClient()
  return useQuery<GoogleSheetConfig>({
    queryKey: queryKeys.googleSheetConfig(centerId),
    queryFn: () => client.request('/mathcenter/centers/' + centerId + '/google-sheets/config'),
    enabled: centerId > 0,
  })
}

export function useManageGoogleSheetLinks(centerId: number) {
  const client = useApiClient()
  return useQuery<GoogleSheetLink[]>({
    queryKey: queryKeys.manageGoogleSheetLinks(centerId),
    queryFn: () => client.request(base(centerId) + '/google-sheets/links'),
    enabled: centerId > 0,
  })
}

export function useManageGoogleSheetRuns(centerId: number) {
  const client = useApiClient()
  return useQuery<GoogleSheetSyncRun[]>({
    queryKey: queryKeys.manageGoogleSheetRuns(centerId),
    queryFn: () => client.request(base(centerId) + '/google-sheets/runs'),
    enabled: centerId > 0,
  })
}

export function useDiscoverGoogleSheet(centerId: number) {
  const client = useApiClient()
  return useMutation({
    mutationFn: (spreadsheet_url: string) =>
      client.request<{ spreadsheet_id: string; tabs: GoogleSheetTab[] }>(
        base(centerId) + '/google-sheets/discover',
        { method: 'POST', body: { spreadsheet_url } },
      ),
  })
}

export function useCreateGoogleSheetLink(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      term_id: number
      group_id: number
      link_kind: 'conduit' | 'initials_legend'
      spreadsheet_url: string
      sheet_id: number
    }) =>
      client.request<GoogleSheetLink>(base(centerId) + '/google-sheets/links', {
        method: 'POST', body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.manageGoogleSheetLinks(centerId) }),
  })
}

export function useSetGoogleSheetLinkEnabled(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ linkId, enabled }: { linkId: number; enabled: boolean }) =>
      client.request(base(centerId) + '/google-sheets/links/' + linkId, {
        method: 'PATCH', body: { enabled },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.manageGoogleSheetLinks(centerId) }),
  })
}

export function useDeleteGoogleSheetLink(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (linkId: number) => client.request(base(centerId) + '/google-sheets/links/' + linkId, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.manageGoogleSheetLinks(centerId) }),
  })
}

export function useSyncGoogleSheetStudents(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (term_id: number) =>
      client.request<GoogleSheetStudentSyncResult>(
        base(centerId) + '/google-sheets/sync-students',
        { method: 'POST', body: { term_id } },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.manageStudents(centerId) })
      qc.invalidateQueries({ queryKey: queryKeys.manageGoogleSheetLinks(centerId) })
    },
  })
}

export function useSyncGoogleSheetSeries(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (term_id: number) =>
      client.request<GoogleSheetSeriesSyncResult>(
        base(centerId) + '/google-sheets/sync-series',
        { method: 'POST', body: { term_id } },
      ),
    onSuccess: (_data, termId) => {
      qc.invalidateQueries({ queryKey: queryKeys.seriesList(centerId, termId) })
      qc.invalidateQueries({ queryKey: queryKeys.manageGoogleSheetLinks(centerId) })
    },
  })
}

// Any center teacher can manually synchronize links for the selected term.
export function useSyncGoogleSheets(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (term_id: number) => client.request<{ runs: GoogleSheetSyncRun[] }>(
      '/mathcenter/centers/' + centerId + '/google-sheets/sync',
      { method: 'POST', body: { term_id } },
    ),
    onSettled: (_data, _error, termId) => {
      qc.invalidateQueries({ queryKey: queryKeys.manageGoogleSheetRuns(centerId) })
      qc.invalidateQueries({ queryKey: queryKeys.centerGrid(centerId, termId) })
    },
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
