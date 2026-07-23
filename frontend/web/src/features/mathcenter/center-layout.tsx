import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import { useMathCenterTerms } from '@my239/shared'
import { Card, Spinner } from '../../design/ui'
import {
  looksLikeYear,
  useCenterId,
  useCenterYearFromId,
} from './use-center-id'
import { useCenterEvents } from './use-center-events'
import { CenterIdContext, CenterTermContext } from './center-id-context'

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
      <CenterTermScope centerId={centerId} />
    </CenterIdContext.Provider>
  )
}

function CenterTermScope({ centerId }: { centerId: number }) {
  const { data: terms, isPending, isError } = useMathCenterTerms(centerId)
  const [params, setParams] = useSearchParams()
  if (isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }
  // Keep the existing center usable during a rolling deployment where the web
  // bundle reaches a server before the term migration/routes. Once terms load,
  // every request is explicitly term-scoped.
  if (isError || !terms || terms.length === 0) {
    return (
      <CenterTermContext.Provider value={{ termId: 0, term: null }}>
        <Outlet />
      </CenterTermContext.Provider>
    )
  }
  const requested = Number(params.get('term_id'))
  const term = terms.find((item) => item.id === requested) ?? terms.find((item) => item.is_active) ?? terms[0]

  return (
    <CenterTermContext.Provider value={{ termId: term.id, term }}>
      <div className="flex flex-col gap-4">
        <label className="flex w-fit items-center gap-2 self-end text-sm text-muted">
          <span>{term.is_active ? 'Текущий период' : 'Архив'}</span>
          <select
            value={term.id}
            onChange={(event) => {
              const next = new URLSearchParams(params)
              next.set('term_id', event.target.value)
              setParams(next)
            }}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-ink"
            aria-label="Период матцентра"
          >
            {terms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.display_name}{item.is_active ? ' · текущий' : ''}
              </option>
            ))}
          </select>
        </label>
        <Outlet />
      </div>
    </CenterTermContext.Provider>
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
