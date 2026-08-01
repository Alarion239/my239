import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  applyCenterGridSeriesCells,
  fetchCenterGridSeriesCells,
  queryKeys,
  useApiClient,
  type ApiClient,
  type CenterGridResponse,
} from '@my239/shared'

// CenterLayout mounts this hook once per center so every open page under the
// layout shares one SSE stream. Do not mount it from individual pages.

// useCenterEvents opens ONE SSE stream for a center and translates each pushed
// `kind` into the matching React Query refreshes, so every open page under the
// center layout stays current. Mutable series state is fetched sparsely;
// structural changes still invalidate their observed views. Pauses while the
// tab is hidden and reconnects when visible.
export function useCenterEvents(centerId: number): void {
  const client = useApiClient()
  const qc = useQueryClient()

  useEffect(() => {
    if (!Number.isFinite(centerId) || centerId <= 0) return
    let controller: AbortController | null = null
    let connected = false
    const seriesRefresh = new SeriesRefreshQueue(qc, client, centerId)

    const start = () => {
      if (controller) return
      controller = new AbortController()
      client
        .streamEvents(
          '/mathcenter/centers/' + centerId + '/events',
          (kind, data) =>
            handleCenterEvent(qc, centerId, kind, data, (seriesId) =>
              seriesRefresh.schedule(seriesId),
            ),
          controller.signal,
          // The server does not replay events. The first connection races the
          // page snapshot intentionally; later reconnects catch up views that
          // may have missed events while the stream was down or hidden.
          () => {
            if (connected) refreshCenterViews(qc, centerId)
            connected = true
          },
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
      seriesRefresh.dispose()
    }
  }, [centerId, client, qc])
}

interface SeriesRefreshState {
  running: boolean
  dirty: boolean
}

// SeriesRefreshQueue serializes refreshes per series. A burst of grading or
// comment events produces at most one in-flight request and one trailing
// request, while results are applied in completion order.
export class SeriesRefreshQueue {
  private readonly states = new Map<number, SeriesRefreshState>()
  private disposed = false

  constructor(
    private readonly qc: QueryClient,
    private readonly client: ApiClient,
    private readonly centerId: number,
  ) {}

  schedule(seriesId: number): void {
    if (this.disposed || seriesId <= 0) return
    const existing = this.states.get(seriesId)
    if (existing?.running) {
      existing.dirty = true
      return
    }
    const state: SeriesRefreshState = { running: true, dirty: false }
    this.states.set(seriesId, state)
    void this.run(seriesId, state)
  }

  dispose(): void {
    this.disposed = true
    this.states.clear()
  }

  private async run(seriesId: number, state: SeriesRefreshState): Promise<void> {
    do {
      state.dirty = false
      try {
        const snapshot = await this.qc.fetchQuery({
          queryKey: queryKeys.centerGridSeriesCells(this.centerId, seriesId),
          queryFn: () => fetchCenterGridSeriesCells(this.client, this.centerId, seriesId),
          staleTime: 0,
          retry: false,
        })
        if (!this.disposed) {
          this.qc.setQueriesData<CenterGridResponse>(
            { queryKey: queryKeys.centerGrids(this.centerId) },
            (grid) => applyCenterGridSeriesCells(grid, snapshot),
          )
        }
      } catch {
        // Keep the visible grid. A later event or reconnect will retry.
      }
    } while (!this.disposed && state.dirty)

    if (!this.disposed) this.states.delete(seriesId)
  }
}

export function handleCenterEvent(
  qc: QueryClient,
  centerId: number,
  kind: string,
  data: string,
  refreshSeries?: (seriesId: number) => void,
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
      if (refreshSeries) refreshSeries(seriesId)
      else qc.invalidateQueries({ queryKey: queryKeys.centerGrids(centerId) })
    } else {
      qc.invalidateQueries({ queryKey: queryKeys.centerGrids(centerId) })
    }
    qc.invalidateQueries({ queryKey: queryKeys.manageRosterBoard(centerId) })
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
    qc.invalidateQueries({
      queryKey: ['mathcenter', 'manage', centerId, 'razbor-access'],
    })
    qc.invalidateQueries({ queryKey: queryKeys.manageRosterBoard(centerId) })
    // An already-open разбор preview is keyed by subproblem rather than center.
    qc.invalidateQueries({ queryKey: ['mathcenter', 'subproblems'] })
  } else if (kind === 'likbez') {
    qc.invalidateQueries({ queryKey: queryKeys.likbezList(centerId) })
    qc.invalidateQueries({ queryKey: ['mathcenter', 'likbez'] })
  } else if (kind === 'comments') {
    // An internal note was added/edited/removed: refresh the grid marks.
    if (seriesId > 0) {
      qc.invalidateQueries({ queryKey: queryKeys.teacherGrid(seriesId) })
      if (refreshSeries) refreshSeries(seriesId)
      else qc.invalidateQueries({ queryKey: queryKeys.centerGrids(centerId) })
    } else {
      // Student-level notes are represented on roster rows, so the complete
      // center snapshot is still required when no series is attached.
      qc.invalidateQueries({ queryKey: queryKeys.centerGrids(centerId) })
    }
  } else if (kind === 'membership') {
    qc.invalidateQueries({ queryKey: queryKeys.manageGroups(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.manageTeachers(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.manageStudents(centerId) })
    qc.invalidateQueries({ queryKey: queryKeys.manageRosterBoard(centerId) })
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
  qc.invalidateQueries({ queryKey: queryKeys.manageRosterBoard(centerId) })
  qc.invalidateQueries({ queryKey: ['mathcenter', 'centers', centerId] })
  qc.invalidateQueries({ queryKey: ['mathcenter', 'subproblems'] })
}
