import { useMemo, useState } from 'react'
import { useMathCenterMe, useMathCenters } from '@my239/shared'
import { useAuth } from '../../auth/auth-context'

// AccessibleCenter is one math center the current user can view on this page,
// with a human label derived from its cohort (graduation year / grade).
export interface AccessibleCenter {
  id: number
  label: string
}

// SeriesContext is the resolved center selection + role for the Series page.
export interface SeriesContext {
  isLoading: boolean
  isError: boolean
  // Every center the user can choose between (teacher centers + own student
  // center, or — for an admin with no membership — every center).
  centers: AccessibleCenter[]
  centerId: number
  setCenterId: (id: number) => void
  // True when the selected center is the user's own student center: the page
  // then shows the student (rollup) view. Otherwise it shows the teacher view
  // (real teachers and admins acting as a teacher).
  isStudentView: boolean
}

function centerLabel(graduationYear: number, grade: number): string {
  return graduationYear + ' выпуск · ' + grade + ' класс'
}

// useSeriesContext resolves which centers the user can see, tracks the selected
// one, and decides whether the student or teacher view applies. An admin who is
// neither teacher nor student falls back to the full admin center list so they
// can still pick any center (always a teacher view in that case).
export function useSeriesContext(): SeriesContext {
  const { user } = useAuth()
  const me = useMathCenterMe()
  const isAdmin = user?.is_admin ?? false

  const studentCenter = me.data?.student?.center ?? null

  // Admins with no membership get the admin list as a fallback source.
  const teacherCount = me.data?.teacher?.centers?.length ?? 0
  const needsAdminFallback =
    isAdmin && teacherCount === 0 && studentCenter === null && me.isSuccess
  const adminCenters = useMathCenters()
  const adminEnabled = needsAdminFallback && adminCenters.isSuccess

  const centers = useMemo<AccessibleCenter[]>(() => {
    const out: AccessibleCenter[] = []
    const seen = new Set<number>()
    const push = (c: AccessibleCenter) => {
      if (seen.has(c.id)) return
      seen.add(c.id)
      out.push(c)
    }
    for (const c of me.data?.teacher?.centers ?? []) {
      push({ id: c.id, label: centerLabel(c.graduation_year, c.grade) })
    }
    const student = me.data?.student?.center
    if (student) {
      push({
        id: student.id,
        label: centerLabel(student.graduation_year, student.grade),
      })
    }
    if (needsAdminFallback && adminCenters.data) {
      for (const c of adminCenters.data) {
        push({ id: c.id, label: c.graduation_year + ' выпуск' })
      }
    }
    return out
  }, [me.data, needsAdminFallback, adminCenters.data])

  // Selection: explicit user choice wins; otherwise default to the first center.
  const [selected, setSelected] = useState<number | null>(null)
  const fallbackId = centers[0]?.id ?? 0
  const known = selected !== null && centers.some((c) => c.id === selected)
  const centerId = known ? selected : fallbackId

  const isStudentView = studentCenter?.id === centerId

  const isLoading = me.isPending || (needsAdminFallback && adminCenters.isPending)
  const isError =
    me.isError || (adminEnabled ? false : needsAdminFallback && adminCenters.isError)

  return {
    isLoading,
    isError,
    centers,
    centerId,
    setCenterId: setSelected,
    isStudentView,
  }
}
