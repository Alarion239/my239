// Coffins ("гробы") + per-subproblem «Разбор» data layer: the center-wide list
// + teacher actions (mark/unmark/release) and each subproblem's own разбор
// (TeX/PDF/link). Everything keys on the subproblem id (the atomic unit).
// Mutations invalidate the center coffins list AND the center's series list so
// both the Гробы tab and the series Разбор tab refresh.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Coffin, PdfUploadURL } from '../types'
import { useApiClient } from './context'
import { queryKeys } from './keys'

// CoffinAction is the lean response of mark/release/solution actions (no labels
// — the client refetches the list/series view for those).
export interface CoffinAction {
  subproblem_id: number
  is_coffin: boolean
  released_at?: string | null
  has_solution_tex: boolean
  has_solution_pdf: boolean
  solution_link?: string | null
}

// useCenterCoffins lists every coffin subproblem in a center for the Гробы tab.
export function useCenterCoffins(centerId: number) {
  const client = useApiClient()
  return useQuery<Coffin[]>({
    queryKey: queryKeys.centerCoffins(centerId),
    queryFn: () =>
      client.request<Coffin[]>('/mathcenter/centers/' + centerId + '/coffins'),
    enabled: centerId > 0,
  })
}

// useMarkCoffin marks a subproblem as a coffin (teacher), re-opening submission.
export function useMarkCoffin(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (subproblemId: number) =>
      client.request<CoffinAction>(
        '/mathcenter/subproblems/' + subproblemId + '/coffin',
        { method: 'POST' },
      ),
    onSuccess: () => invalidate(qc, centerId),
  })
}

// useUnmarkCoffin clears the coffin flag (the subproblem reverts to the series
// deadline).
export function useUnmarkCoffin(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (subproblemId: number) =>
      client.request<void>(
        '/mathcenter/subproblems/' + subproblemId + '/coffin',
        { method: 'DELETE' },
      ),
    onSuccess: () => invalidate(qc, centerId),
  })
}

// useReleaseCoffin stamps released_at — closing submission + revealing разбор.
export function useReleaseCoffin(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (subproblemId: number) =>
      client.request<CoffinAction>(
        '/mathcenter/subproblems/' + subproblemId + '/solution/release',
        { method: 'POST' },
      ),
    onSuccess: () => invalidate(qc, centerId),
  })
}

// --- per-subproblem «Разбор» -------------------------------------------------

// useSubproblemSolutionTex fetches a subproblem's разбор LaTeX (gated server-side).
export function useSubproblemSolutionTex(subproblemId: number, enabled: boolean) {
  const client = useApiClient()
  return useQuery<{ tex: string }>({
    queryKey: queryKeys.subproblemSolutionTex(subproblemId),
    queryFn: () =>
      client.request<{ tex: string }>(
        '/mathcenter/subproblems/' + subproblemId + '/solution/tex',
      ),
    enabled: enabled && subproblemId > 0,
  })
}

export function usePutSubproblemSolutionTex(subproblemId: number, centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tex: string) =>
      client.request<CoffinAction>(
        '/mathcenter/subproblems/' + subproblemId + '/solution/tex',
        { method: 'PUT', body: { tex } },
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.subproblemSolutionTex(subproblemId),
      })
      invalidate(qc, centerId)
    },
  })
}

export function useUploadSubproblemSolutionPdf(subproblemId: number, centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: Blob): Promise<CoffinAction> => {
      const { object_key, upload_url } = await client.request<PdfUploadURL>(
        '/mathcenter/subproblems/' + subproblemId + '/solution/pdf/upload-url',
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
        '/mathcenter/subproblems/' + subproblemId + '/solution/pdf/publish',
        { method: 'POST', body: { object_key } },
      )
    },
    onSuccess: () => invalidate(qc, centerId),
  })
}

export function useSetSubproblemSolutionLink(subproblemId: number, centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (link: string) =>
      client.request<CoffinAction>(
        '/mathcenter/subproblems/' + subproblemId + '/solution/link',
        { method: 'PUT', body: { link } },
      ),
    onSuccess: () => invalidate(qc, centerId),
  })
}

function invalidate(qc: ReturnType<typeof useQueryClient>, centerId: number) {
  qc.invalidateQueries({ queryKey: queryKeys.centerCoffins(centerId) })
  // The series view carries per-subproblem coffin/разбор metadata; refresh it
  // so the Разбор tab badges + student gating update.
  qc.invalidateQueries({ queryKey: queryKeys.seriesList(centerId) })
}
