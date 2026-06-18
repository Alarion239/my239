// Math center "Серии" (homework series) data layer as TanStack Query hooks.
// Like the other hooks here, these run unchanged on web and React Native — UI
// and routing stay platform-specific. Mutations invalidate the keys that the
// affected views read from.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  MyRollup,
  PdfUploadURL,
  Series,
  SeriesProblemStats,
} from '../types'
import type { CreateSeriesValues } from '../validation/series'
import { useApiClient } from './context'
import { queryKeys } from './keys'

// --- Queries -----------------------------------------------------------------

// useSeriesList fetches every series in a center (teacher-facing list).
export function useSeriesList(centerId: number) {
  const client = useApiClient()
  return useQuery<Series[]>({
    queryKey: queryKeys.seriesList(centerId),
    queryFn: () =>
      client.request<Series[]>(
        '/mathcenter/centers/' + centerId + '/series',
      ),
    enabled: centerId > 0,
  })
}

// useSeries fetches a single series by id.
export function useSeries(seriesId: number) {
  const client = useApiClient()
  return useQuery<Series>({
    queryKey: queryKeys.series(seriesId),
    queryFn: () => client.request<Series>('/mathcenter/series/' + seriesId),
    enabled: seriesId > 0,
  })
}

// useSeriesTex fetches the LaTeX source for a series. Gated behind `enabled`
// since the editor only loads it on demand.
export function useSeriesTex(seriesId: number, enabled: boolean) {
  const client = useApiClient()
  return useQuery<{ tex: string }>({
    queryKey: queryKeys.seriesTex(seriesId),
    queryFn: () =>
      client.request<{ tex: string }>(
        '/mathcenter/series/' + seriesId + '/tex',
      ),
    enabled: enabled && seriesId > 0,
  })
}

// useMySeriesRollup fetches the calling student's own progress on a series.
export function useMySeriesRollup(seriesId: number) {
  const client = useApiClient()
  return useQuery<MyRollup>({
    queryKey: queryKeys.myRollup(seriesId),
    queryFn: () =>
      client.request<MyRollup>('/homework/series/' + seriesId + '/my'),
    enabled: seriesId > 0,
  })
}

// useSeriesProblemStats fetches per-problem aggregate stats across all students
// (teacher-facing).
export function useSeriesProblemStats(seriesId: number) {
  const client = useApiClient()
  return useQuery<SeriesProblemStats>({
    queryKey: queryKeys.problemStats(seriesId),
    queryFn: () =>
      client.request<SeriesProblemStats>(
        '/homework/series/' + seriesId + '/problem-stats',
      ),
    enabled: seriesId > 0,
  })
}

// --- Mutations ---------------------------------------------------------------

// CreateSeriesBody is the wire body for create/update; the form values map
// onto it directly (CreateSeriesValues mirrors these fields).
export type CreateSeriesBody = CreateSeriesValues

// useCreateSeries creates a series in a center and invalidates the center list.
export function useCreateSeries(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateSeriesBody) =>
      client.request<Series>('/mathcenter/centers/' + centerId + '/series', {
        method: 'POST',
        body,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.seriesList(centerId) }),
  })
}

// useUpdateSeries edits a series and invalidates both its detail and the lists
// it may appear in.
export function useUpdateSeries(seriesId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateSeriesBody) =>
      client.request<Series>('/mathcenter/series/' + seriesId, {
        method: 'PUT',
        body,
      }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: queryKeys.series(seriesId) })
      qc.invalidateQueries({
        queryKey: queryKeys.seriesList(updated.math_center_id),
      })
    },
  })
}

// usePutSeriesTex replaces the series LaTeX source (the backend auto-publishes).
export function usePutSeriesTex(seriesId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tex: string) =>
      client.request<Series>('/mathcenter/series/' + seriesId + '/tex', {
        method: 'PUT',
        body: { tex },
      }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: queryKeys.series(seriesId) })
      qc.invalidateQueries({ queryKey: queryKeys.seriesTex(seriesId) })
      qc.invalidateQueries({
        queryKey: queryKeys.seriesList(updated.math_center_id),
      })
    },
  })
}

// useDeleteSeriesTex removes the series LaTeX source.
export function useDeleteSeriesTex(seriesId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      client.request<Series>('/mathcenter/series/' + seriesId + '/tex', {
        method: 'DELETE',
      }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: queryKeys.series(seriesId) })
      qc.invalidateQueries({ queryKey: queryKeys.seriesTex(seriesId) })
      qc.invalidateQueries({
        queryKey: queryKeys.seriesList(updated.math_center_id),
      })
    },
  })
}

// useUploadSeriesPdf orchestrates the three-step PDF upload: ask for a presigned
// URL, PUT the bytes straight to storage (raw — NO auth/act-as headers, that
// request leaves our API), then publish the object key. Returns the updated
// series. `file` is any BodyInit accepted by fetch (Blob/File/ArrayBuffer).
export function useUploadSeriesPdf(seriesId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: Blob): Promise<Series> => {
      const { object_key, upload_url } = await client.request<PdfUploadURL>(
        '/mathcenter/series/' + seriesId + '/pdf/upload-url',
        { method: 'POST' },
      )
      const put = await fetch(upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: file,
      })
      if (!put.ok) {
        throw new Error('PDF upload failed (' + put.status + ')')
      }
      return client.request<Series>(
        '/mathcenter/series/' + seriesId + '/pdf/publish',
        { method: 'POST', body: { object_key } },
      )
    },
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: queryKeys.series(seriesId) })
      qc.invalidateQueries({
        queryKey: queryKeys.seriesList(updated.math_center_id),
      })
    },
  })
}
