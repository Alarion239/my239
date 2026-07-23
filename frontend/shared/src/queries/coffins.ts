// Coffins ("гробы") + per-subproblem «Разбор» data layer: the center-wide list
// + teacher actions (mark/unmark/release) and each subproblem's own разбор
// (TeX/PDF/link). Everything keys on the subproblem id (the atomic unit).
// Mutations invalidate the center coffins list AND the center's series list so
// both the Гробы tab and the series Разбор tab refresh.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '../api/client'
import type { Coffin, CoffinQueueItem, PdfUploadURL } from '../types'
import { useApiClient } from './context'
import { queryKeys } from './keys'

// groupSolutions records that the given subproblems share one разбор (so the
// student Разбор view can group + light up the whole set). Called after the
// content has been written to each subproblem.
async function groupSolutions(client: ApiClient, subproblemIds: number[]) {
  await client.request('/mathcenter/subproblem-solutions/group', {
    method: 'POST',
    body: { subproblem_ids: subproblemIds },
  })
}

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
export function useCenterCoffins(centerId: number, termId = 0) {
  const client = useApiClient()
  return useQuery<Coffin[]>({
    queryKey: queryKeys.centerCoffins(centerId, termId),
    queryFn: () =>
      client.request<Coffin[]>('/mathcenter/centers/' + centerId + '/coffins' + (termId > 0 ? '?term_id=' + termId : '')),
    enabled: centerId > 0,
  })
}

// useCoffinQueue fetches the center-wide coffin grading queue (teacher).
export function useCoffinQueue(centerId: number) {
  const client = useApiClient()
  return useQuery<CoffinQueueItem[]>({
    queryKey: queryKeys.coffinQueue(centerId),
    queryFn: () =>
      client.request<CoffinQueueItem[]>(
        '/mathcenter/centers/' + centerId + '/coffin-queue',
      ),
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
  qc.invalidateQueries({ queryKey: ['mathcenter', 'centers', centerId] })
  // The series view carries per-subproblem coffin/разбор metadata; refresh it
  // so the Разбор tab badges + student gating update.
  qc.invalidateQueries({ queryKey: ['mathcenter', 'centers', centerId] })
}

// --- batch «Разбор» (attach one source to several subproblems) ---------------
// Fan out the same разбор content to every selected subproblem, reusing the
// per-subproblem endpoints, then invalidate once. Lets a teacher post one PDF /
// LaTeX / link as the solution for multiple problems at once.

export function usePutSubproblemSolutionTexBatch(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      subproblemIds,
      tex,
    }: {
      subproblemIds: number[]
      tex: string
    }) => {
      await Promise.all(
        subproblemIds.map((id) =>
          client.request<CoffinAction>(
            '/mathcenter/subproblems/' + id + '/solution/tex',
            { method: 'PUT', body: { tex } },
          ),
        ),
      )
      await groupSolutions(client, subproblemIds)
    },
    onSuccess: (_data, { subproblemIds }) => {
      // Refresh each subproblem's cached разбор TeX so an open preview updates.
      for (const id of subproblemIds) {
        qc.invalidateQueries({ queryKey: queryKeys.subproblemSolutionTex(id) })
      }
      invalidate(qc, centerId)
    },
  })
}

export function useSetSubproblemSolutionLinkBatch(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      subproblemIds,
      link,
    }: {
      subproblemIds: number[]
      link: string
    }) => {
      await Promise.all(
        subproblemIds.map((id) =>
          client.request<CoffinAction>(
            '/mathcenter/subproblems/' + id + '/solution/link',
            { method: 'PUT', body: { link } },
          ),
        ),
      )
      await groupSolutions(client, subproblemIds)
    },
    onSuccess: () => invalidate(qc, centerId),
  })
}

export function useUploadSubproblemSolutionPdfBatch(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      subproblemIds,
      file,
    }: {
      subproblemIds: number[]
      file: Blob
    }) => {
      // One presigned upload + publish per subproblem (each owns its object
      // key); the same in-memory file is re-sent so the teacher uploads once.
      for (const id of subproblemIds) {
        const { object_key, upload_url } = await client.request<PdfUploadURL>(
          '/mathcenter/subproblems/' + id + '/solution/pdf/upload-url',
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
        await client.request<CoffinAction>(
          '/mathcenter/subproblems/' + id + '/solution/pdf/publish',
          { method: 'POST', body: { object_key } },
        )
      }
      await groupSolutions(client, subproblemIds)
    },
    onSuccess: () => invalidate(qc, centerId),
  })
}
