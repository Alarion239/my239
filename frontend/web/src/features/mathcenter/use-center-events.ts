import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys, useApiClient } from '@my239/shared'

// NOTE: this hook is intentionally NOT mounted anywhere yet. CenterLayout (added
// in the routing work) mounts it once per center so every open page under the
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
          (kind, data) => handle(qc, centerId, kind, data),
          controller.signal,
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

function handle(
  qc: ReturnType<typeof useQueryClient>,
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
    qc.invalidateQueries({ queryKey: queryKeys.centerGrid(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.graderStats(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.coffinQueue(centerId) })
  } else if (kind === 'coffins') {
    qc.invalidateQueries({ queryKey: queryKeys.centerCoffins(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.coffinQueue(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.seriesList(centerId) })
  } else if (kind === 'comments') {
    // An internal note was added/edited/removed: refresh the grid marks.
    if (seriesId > 0) {
      qc.invalidateQueries({ queryKey: queryKeys.teacherGrid(seriesId) })
    }
    qc.invalidateQueries({ queryKey: queryKeys.centerGrid(centerId) })
  } else if (kind === 'membership') {
    qc.invalidateQueries({ queryKey: queryKeys.manageGroups(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.manageTeachers(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.manageStudents(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.mathCenterMe })
    qc.invalidateQueries({ queryKey: queryKeys.centerGrid(centerId) })
  }
}
