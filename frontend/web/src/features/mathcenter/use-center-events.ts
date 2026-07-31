import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { queryKeys, useApiClient } from '@my239/shared'

// CenterLayout mounts this hook once per center so every open page under the
// layout shares one SSE stream. Do not mount it from individual pages.

// useCenterEvents opens ONE SSE stream for a center and translates each pushed
// `kind` into the matching React Query invalidations, so every open page under
// the center layout refetches the affected GET endpoints. Pauses while the tab
// is hidden (visibilitychange) and reconnects when visible. Cleans up on
// unmount / center change.
export function useCenterEvents(centerId: number): void {
  const client = useApiClient()
  const qc = useQueryClient()

  useEffect(() => {
    if (!Number.isFinite(centerId) || centerId <= 0) return
    let controller: AbortController | null = null

    const start = () => {
      if (controller) return
      controller = new AbortController()
      client
        .streamEvents(
          '/mathcenter/centers/' + centerId + '/events',
          (kind, data) => handleCenterEvent(qc, centerId, kind, data),
          controller.signal,
          // The server does not replay events. Refresh on the initial
          // connection and every reconnect so a transient network gap cannot
          // leave either the conduit or phone queue stale.
          () => refreshCenterViews(qc, centerId),
        )
        .catch(() => undefined)
    }
    const stop = () => {
      controller?.abort()
      controller = null
    }
    const onVisibility = () => {
      if (document.hidden) stop()
      else start()
    }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [centerId, client, qc])
}

export function handleCenterEvent(
  qc: QueryClient,
  centerId: number,
  kind: string,
  data: string,
): void {
  let seriesId = 0
  try {
    seriesId = (JSON.parse(data) as { series_id?: number })?.series_id ?? 0
  } catch {
    /* ignore malformed */
  }
  if (kind === 'grading') {
    if (seriesId > 0) {
      qc.invalidateQueries({ queryKey: queryKeys.myRollup(seriesId) })
      qc.invalidateQueries({ queryKey: queryKeys.problemStats(seriesId) })
      qc.invalidateQueries({ queryKey: queryKeys.teacherGrid(seriesId) })
      qc.invalidateQueries({
        queryKey: ['homework', 'series', seriesId, 'queue'],
      })
    }
    qc.invalidateQueries({ queryKey: queryKeys.centerGrids(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.graderStats(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.coffinQueue(centerId) })
  } else if (kind === 'coffins') {
    // Term is part of both the series and coffin query keys. Invalidate the
    // center prefix so whichever current/archive term is open refreshes, not
    // only the legacy term_id=0 key.
    qc.invalidateQueries({
      queryKey: ['mathcenter', 'centers', centerId],
    })
    qc.invalidateQueries({ queryKey: ['mathcenter', 'series'] })
    qc.invalidateQueries({
      queryKey: ['mathcenter', 'manage', centerId, 'students'],
    })
    // An already-open разбор preview is keyed by subproblem rather than center.
    qc.invalidateQueries({ queryKey: ['mathcenter', 'subproblems'] })
  } else if (kind === 'likbez') {
    qc.invalidateQueries({ queryKey: queryKeys.likbezList(centerId) })
    qc.invalidateQueries({ queryKey: ['mathcenter', 'likbez'] })
  } else if (kind === 'comments') {
    // An internal note was added/edited/removed: refresh the grid marks.
    if (seriesId > 0) {
      qc.invalidateQueries({ queryKey: queryKeys.teacherGrid(seriesId) })
    }
    qc.invalidateQueries({ queryKey: queryKeys.centerGrids(centerId) })
  } else if (kind === 'membership') {
    qc.invalidateQueries({ queryKey: queryKeys.manageGroups(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.manageTeachers(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.manageStudents(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.mathCenterMe })
    qc.invalidateQueries({ queryKey: queryKeys.centerGrids(centerId) })
  }
}

// refreshCenterViews repairs gaps in the SSE model: events that happened while
// the document was hidden or the connection was down. Invalidating prefixes is
// cheap because TanStack Query refetches only currently observed views.
export function refreshCenterViews(
  qc: QueryClient,
  centerId: number,
): void {
  qc.invalidateQueries({ queryKey: ['homework', 'series'] })
  qc.invalidateQueries({ queryKey: queryKeys.centerGrids(centerId) })
  qc.invalidateQueries({ queryKey: queryKeys.graderStats(centerId) })
  qc.invalidateQueries({ queryKey: queryKeys.coffinQueue(centerId) })
  qc.invalidateQueries({ queryKey: ['mathcenter', 'centers', centerId] })
  qc.invalidateQueries({ queryKey: ['mathcenter', 'subproblems'] })
}
