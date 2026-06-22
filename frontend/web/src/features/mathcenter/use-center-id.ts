import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useMathCenterMe, useMathCenters } from '@my239/shared'
import { useAuth } from '../../auth/auth-context'

export interface CenterResolution {
  // The numeric URL segment as parsed (a graduation year for canonical URLs, a
  // legacy center id when < 2000 — see looksLikeYear).
  year: number
  // The internal center id the year resolves to, or 0 when unresolved.
  centerId: number
  isResolving: boolean
  notFound: boolean
}

// looksLikeYear distinguishes a graduation year from a legacy internal center
// id by magnitude: graduation years are 4-digit (>= 2000); center ids in this
// deployment are small (< 2000). Used to honour old /mathcenter/{id}/... links.
export function looksLikeYear(n: number): boolean {
  return Number.isFinite(n) && n >= 2000
}

// useCenterId resolves the :year URL segment to an internal center id. Members
// resolve from their own /mathcenter/me (teacher centers + their student
// center); admins viewing a center they don't belong to fall back to the admin
// center list (gated on isAdmin so non-admins never fire the 403-ing request).
export function useCenterId(): CenterResolution {
  const { year: yearParam } = useParams<{ year: string }>()
  const year = Number(yearParam)
  const { user } = useAuth()
  const me = useMathCenterMe()
  const isAdmin = user?.is_admin ?? false

  const fromMe = useMemo(() => {
    const teacher = (me.data?.teacher?.centers ?? []).find(
      (c) => c.graduation_year === year,
    )
    if (teacher) return teacher.id
    const student = me.data?.student?.center
    if (student?.graduation_year === year) return student.id
    return 0
  }, [me.data, year])

  const needAdmin = isAdmin && fromMe === 0
  const admin = useMathCenters(needAdmin)
  const fromAdmin = useMemo(
    () => admin.data?.find((c) => c.graduation_year === year)?.id ?? 0,
    [admin.data, year],
  )

  const centerId = fromMe || fromAdmin
  const isResolving = me.isPending || (needAdmin && admin.isPending)
  return {
    year,
    centerId,
    isResolving,
    notFound: !isResolving && centerId === 0,
  }
}

// useCenterYear resolves an internal center id back to its graduation year,
// used by the legacy-id redirect to rewrite /mathcenter/{id}/... to the
// canonical /mathcenter/{year}/... URL. Returns 0 until resolvable.
export function useCenterYearFromId(centerId: number): {
  year: number
  isResolving: boolean
  notFound: boolean
} {
  const { user } = useAuth()
  const me = useMathCenterMe()
  const isAdmin = user?.is_admin ?? false

  const fromMe = useMemo(() => {
    const teacher = (me.data?.teacher?.centers ?? []).find(
      (c) => c.id === centerId,
    )
    if (teacher) return teacher.graduation_year
    const student = me.data?.student?.center
    if (student?.id === centerId) return student.graduation_year
    return 0
  }, [me.data, centerId])

  const needAdmin = isAdmin && fromMe === 0
  const admin = useMathCenters(needAdmin)
  const fromAdmin = useMemo(
    () => admin.data?.find((c) => c.id === centerId)?.graduation_year ?? 0,
    [admin.data, centerId],
  )

  const year = fromMe || fromAdmin
  const isResolving = me.isPending || (needAdmin && admin.isPending)
  return { year, isResolving, notFound: !isResolving && year === 0 }
}
