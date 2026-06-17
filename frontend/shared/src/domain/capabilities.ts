// Pure, platform-agnostic derivation of what the current user can do, folding
// the coarse account flags (is_admin) together with the fine math-center view
// (/mathcenter/me). No I/O, no React, no DOM — safe from web, native, or tests.

import type { CenterInfo, MeResponse, TeacherCenterView, User } from '../types'

export interface Capabilities {
  isAdmin: boolean
  // Admins may impersonate other users (the act-as picker); mirrors isAdmin.
  canImpersonate: boolean
  // Centers the user teaches (empty when not a teacher).
  teacherCenters: TeacherCenterView[]
  // The user's own center as a student, or null when not a student.
  studentCenter: CenterInfo | null
  isTeacher: boolean
  isStudent: boolean
}

// deriveCapabilities is the single place that turns raw account + membership
// data into the booleans UI gates on. Tolerates null/undefined inputs (signed
// out, or me not yet loaded).
export function deriveCapabilities(
  user: Pick<User, 'is_admin'> | null,
  me: MeResponse | null | undefined,
): Capabilities {
  const isAdmin = user?.is_admin ?? false
  const teacherCenters = me?.teacher?.centers ?? []
  const studentCenter = me?.student?.center ?? null

  return {
    isAdmin,
    canImpersonate: isAdmin,
    teacherCenters,
    studentCenter,
    isTeacher: teacherCenters.length > 0,
    isStudent: studentCenter !== null,
  }
}
