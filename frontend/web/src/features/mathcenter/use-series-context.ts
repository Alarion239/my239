import { useMathCenterMe } from '@my239/shared'
import { useAuth } from '../../auth/auth-context'

// SeriesContext is the resolved access decision + role for one center's Series
// page. The center is fixed by the route (:centerId); this hook only decides
// whether the user may view it and which view (student vs teacher) applies.
export interface SeriesContext {
  isLoading: boolean
  isError: boolean
  // True once data has loaded and the user may view this center: a teacher of
  // it, its student, or an admin (who may view any center).
  hasAccess: boolean
  // True when this is the user's own student center: the page shows the student
  // (rollup) view. Otherwise the teacher view (real teachers and admins).
  isStudentView: boolean
}

// useSeriesContext resolves access to one center and the role view. Admins may
// view any center (always as a teacher view, unless it's also their own student
// center).
export function useSeriesContext(centerId: number): SeriesContext {
  const { user } = useAuth()
  const me = useMathCenterMe()
  const isAdmin = user?.is_admin ?? false

  const teacherCenters = me.data?.teacher?.centers ?? []
  const studentCenter = me.data?.student?.center ?? null

  const isTeacher = teacherCenters.some((c) => c.id === centerId)
  const isStudentView = studentCenter?.id === centerId
  const hasAccess = isAdmin || isTeacher || isStudentView

  return {
    isLoading: me.isPending,
    isError: me.isError,
    hasAccess,
    isStudentView,
  }
}
