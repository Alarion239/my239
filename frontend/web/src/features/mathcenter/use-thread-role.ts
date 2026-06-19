import {
  resolveThreadRole,
  useMathCenterMe,
  type ThreadRole,
} from '@my239/shared'
import { useAuth } from '../../auth/auth-context'
import { useImpersonation } from '../../auth/impersonation-context'

export type { ThreadRole }

export interface ThreadRoleResult {
  role: ThreadRole
  userId: number
  isLoading: boolean
}

// useThreadRole gathers the viewer's identity (real account + any active
// impersonation) and math-center memberships, then defers to the pure
// resolveThreadRole. The pure split keeps the impersonation rule (effective
// viewer id = impersonated user) unit-testable. `studentUserId` is the thread
// owner; omit it in the first-submission flow.
export function useThreadRole(
  centerId: number,
  studentUserId?: number,
): ThreadRoleResult {
  const { user } = useAuth()
  const { actingAs } = useImpersonation()
  const me = useMathCenterMe()

  const { role, userId } = resolveThreadRole({
    isAdmin: user?.is_admin ?? false,
    actingAsUserId: actingAs?.id ?? null,
    realUserId: user?.id ?? 0,
    teacherCenterIds: (me.data?.teacher?.centers ?? []).map((c) => c.id),
    studentCenterId: me.data?.student?.center.id ?? null,
    centerId,
    threadStudentUserId: studentUserId,
  })

  return { role, userId, isLoading: me.isPending }
}
