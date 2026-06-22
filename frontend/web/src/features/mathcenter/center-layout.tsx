import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Card, Spinner } from '../../design/ui'
import {
  looksLikeYear,
  useCenterId,
  useCenterYearFromId,
} from './use-center-id'
import { useCenterEvents } from './use-center-events'
import { CenterIdContext } from './center-id-context'

// CenterLayout is the per-center shell mounted at /mathcenter/:year. It resolves
// the :year segment to an internal center id, redirects legacy numeric-id URLs
// (/mathcenter/{id}/...) to the canonical year URL, gates access, opens the
// single shared SSE stream for the whole center, and renders the active
// sub-page via <Outlet/>.
//
// Year vs legacy id is disambiguated by magnitude (looksLikeYear): graduation
// years are >= 2000; internal ids in this deployment are small. A param < 2000
// is treated as a legacy id and rewritten to its center's graduation year,
// preserving the rest of the path.
export function CenterLayout() {
  const { year, centerId, isResolving, notFound } = useCenterId()
  // useCenterEvents safely no-ops on centerId === 0 / before resolution.
  useCenterEvents(centerId)

  if (!looksLikeYear(year)) {
    return <LegacyCenterRedirect legacyId={year} />
  }
  if (isResolving) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }
  if (notFound) {
    return <NoAccess />
  }
  return (
    <CenterIdContext.Provider value={centerId}>
      <Outlet />
    </CenterIdContext.Provider>
  )
}

// LegacyCenterRedirect rewrites an old /mathcenter/{id}/<suffix> URL to the
// canonical /mathcenter/{year}/<suffix>, resolving id -> graduation year. Uses
// <Navigate replace> so the legacy URL never enters history.
function LegacyCenterRedirect({ legacyId }: { legacyId: number }) {
  const { pathname } = useLocation()
  const { year, isResolving, notFound } = useCenterYearFromId(legacyId)

  if (isResolving) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }
  if (notFound || year === 0) {
    return <NoAccess />
  }
  // Replace the first two segments ("/mathcenter/{id}") with the year URL,
  // keeping whatever suffix the old link carried.
  const suffix = pathname.replace(/^\/mathcenter\/[^/]+/, '')
  return <Navigate to={'/mathcenter/' + year + suffix} replace />
}

function NoAccess() {
  return (
    <Card className="animate-rise px-6 py-16 text-center">
      <p className="text-muted">Нет доступа к этому матцентру.</p>
    </Card>
  )
}
