import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys, useApiClient } from '@my239/shared'

// streamEvents is the (optional) SSE surface on the API client. It is provided
// by the live-push feature; until that lands `client.streamEvents` is absent and
// this hook silently no-ops. Typed structurally so this file does not depend on
// the method existing at compile time.
type StreamCapable = {
  streamEvents?: (
    path: string,
    onEvent: (kind: string, data: string) => void,
    signal: AbortSignal,
  ) => Promise<void>
}

// useCenterEvents opens ONE SSE stream for a center and translates each pushed
// `kind` into the matching React Query invalidations, so every open page under
// the center layout refetches the affected GET endpoints. Pauses while the tab
// is hidden (visibilitychange) and reconnects when visible. Cleans up on
// unmount / center change. A no-op when the API client has no SSE support yet.
export function useCenterEvents(centerId: number): void {
  const client = useApiClient()
  const qc = useQueryClient()

  useEffect(() => {
    if (!Number.isFinite(centerId) || centerId <= 0) return
    const stream = (client as unknown as StreamCapable).streamEvents
    if (!stream) return

    let controller: AbortController | null = null

    const start = () => {
      if (controller) return
      controller = new AbortController()
      stream.call(
        client,
        '/mathcenter/centers/' + centerId + '/events',
        (kind: string, data: string) => handle(qc, centerId, kind, data),
        controller.signal,
      ).catch(() => undefined)
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
    /* ignore malformed payloads */
  }
  if (kind === 'grading') {
    if (seriesId > 0) {
      qc.invalidateQueries({ queryKey: queryKeys.myRollup(seriesId) })
      qc.invalidateQueries({ queryKey: queryKeys.problemStats(seriesId) })
      qc.invalidateQueries({ queryKey: queryKeys.teacherGrid(seriesId) })
      qc.invalidateQueries({ queryKey: ['homework', 'series', seriesId, 'queue'] })
    }
    qc.invalidateQueries({ queryKey: queryKeys.centerGrid(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.graderStats(centerId) })
  } else if (kind === 'coffins') {
    qc.invalidateQueries({ queryKey: queryKeys.centerCoffins(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.coffinQueue(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.seriesList(centerId) })
  } else if (kind === 'membership') {
    qc.invalidateQueries({ queryKey: queryKeys.manageGroups(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.manageTeachers(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.manageStudents(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.mathCenterMe })
    qc.invalidateQueries({ queryKey: queryKeys.centerGrid(centerId) })
  }
}
