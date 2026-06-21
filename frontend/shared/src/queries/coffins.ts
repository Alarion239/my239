// Coffins ("гробы") data layer: the center-wide list + teacher actions
// (mark/unmark/release) and the coffin's own «Разбор» (TeX/PDF/link). Mutations
// invalidate the center coffins list so the Гробы tab refreshes.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Coffin, PdfUploadURL } from '../types'
import { useApiClient } from './context'
import { queryKeys } from './keys'

// CoffinAction is the lean response of mark/release/solution actions (no series
// labels — the client refetches the list for those).
export interface CoffinAction {
  id: number
  problem_id: number
  released_at?: string | null
  has_solution_tex: boolean
  has_solution_pdf: boolean
  solution_link?: string | null
}

// useCenterCoffins lists every coffin in a center for the Гробы tab.
export function useCenterCoffins(centerId: number) {
  const client = useApiClient()
  return useQuery<Coffin[]>({
    queryKey: queryKeys.centerCoffins(centerId),
    queryFn: () =>
      client.request<Coffin[]>('/mathcenter/centers/' + centerId + '/coffins'),
    enabled: centerId > 0,
  })
}

// useMarkCoffin marks a problem as a coffin (teacher), re-opening submission.
export function useMarkCoffin(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (problemId: number) =>
      client.request<CoffinAction>(
        '/mathcenter/problems/' + problemId + '/coffin',
        { method: 'POST' },
      ),
    onSuccess: () => invalidateCoffins(qc, centerId),
  })
}

// useUnmarkCoffin removes the coffin (problem reverts to the series deadline).
export function useUnmarkCoffin(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (problemId: number) =>
      client.request<void>('/mathcenter/problems/' + problemId + '/coffin', {
        method: 'DELETE',
      }),
    onSuccess: () => invalidateCoffins(qc, centerId),
  })
}

// useReleaseCoffin stamps released_at — closing submission + revealing разбор.
export function useReleaseCoffin(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (coffinId: number) =>
      client.request<CoffinAction>(
        '/mathcenter/coffins/' + coffinId + '/release',
        { method: 'POST' },
      ),
    onSuccess: () => invalidateCoffins(qc, centerId),
  })
}

// --- coffin «Разбор» ---------------------------------------------------------

// useCoffinSolutionTex fetches a coffin's разбор LaTeX (gated server-side).
export function useCoffinSolutionTex(coffinId: number, enabled: boolean) {
  const client = useApiClient()
  return useQuery<{ tex: string }>({
    queryKey: queryKeys.coffinSolutionTex(coffinId),
    queryFn: () =>
      client.request<{ tex: string }>(
        '/mathcenter/coffins/' + coffinId + '/solution/tex',
      ),
    enabled: enabled && coffinId > 0,
  })
}

export function usePutCoffinSolutionTex(coffinId: number, centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tex: string) =>
      client.request<CoffinAction>(
        '/mathcenter/coffins/' + coffinId + '/solution/tex',
        { method: 'PUT', body: { tex } },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.coffinSolutionTex(coffinId) })
      invalidateCoffins(qc, centerId)
    },
  })
}

export function useUploadCoffinSolutionPdf(coffinId: number, centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: Blob): Promise<CoffinAction> => {
      const { object_key, upload_url } = await client.request<PdfUploadURL>(
        '/mathcenter/coffins/' + coffinId + '/solution/pdf/upload-url',
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
      return client.request<CoffinAction>(
        '/mathcenter/coffins/' + coffinId + '/solution/pdf/publish',
        { method: 'POST', body: { object_key } },
      )
    },
    onSuccess: () => invalidateCoffins(qc, centerId),
  })
}

export function useSetCoffinSolutionLink(coffinId: number, centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (link: string) =>
      client.request<CoffinAction>(
        '/mathcenter/coffins/' + coffinId + '/solution/link',
        { method: 'PUT', body: { link } },
      ),
    onSuccess: () => invalidateCoffins(qc, centerId),
  })
}

function invalidateCoffins(
  qc: ReturnType<typeof useQueryClient>,
  centerId: number,
) {
  qc.invalidateQueries({ queryKey: queryKeys.centerCoffins(centerId) })
}
