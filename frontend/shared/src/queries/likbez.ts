import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Likbez, PdfUploadURL } from '../types'
import type { CreateLikbezBody, UpdateLikbezBody } from '../validation/likbez'
import { useApiClient } from './context'
import { queryKeys } from './keys'

export function useLikbezList(centerId: number) {
  const client = useApiClient()
  return useQuery<Likbez[]>({
    queryKey: queryKeys.likbezList(centerId),
    queryFn: () => client.request<Likbez[]>('/mathcenter/centers/' + centerId + '/likbez'),
    enabled: centerId > 0,
  })
}

export function useLikbez(likbezId: number) {
  const client = useApiClient()
  return useQuery<Likbez>({
    queryKey: queryKeys.likbez(likbezId),
    queryFn: () => client.request<Likbez>('/mathcenter/likbez/' + likbezId),
    enabled: likbezId > 0,
  })
}

export function useLikbezTex(likbezId: number, enabled: boolean) {
  const client = useApiClient()
  return useQuery<{ tex: string }>({
    queryKey: queryKeys.likbezTex(likbezId),
    queryFn: () => client.request<{ tex: string }>('/mathcenter/likbez/' + likbezId + '/tex'),
    enabled: enabled && likbezId > 0,
  })
}

function invalidateLikbez(qc: ReturnType<typeof useQueryClient>, likbezId: number, item: Likbez) {
  qc.invalidateQueries({ queryKey: queryKeys.likbez(likbezId) })
  qc.invalidateQueries({ queryKey: queryKeys.likbezTex(likbezId) })
  qc.invalidateQueries({ queryKey: queryKeys.likbezList(item.math_center_id) })
}

export function useCreateLikbez(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateLikbezBody) => client.request<Likbez>('/mathcenter/centers/' + centerId + '/likbez', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.likbezList(centerId) }),
  })
}

export function useUpdateLikbez(likbezId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateLikbezBody) => client.request<Likbez>('/mathcenter/likbez/' + likbezId, { method: 'PUT', body }),
    onSuccess: (item) => invalidateLikbez(qc, likbezId, item),
  })
}

export function useDeleteLikbez(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (likbezId: number) => client.request<void>('/mathcenter/likbez/' + likbezId, { method: 'DELETE' }),
    onSuccess: (_data, likbezId) => {
      qc.invalidateQueries({ queryKey: queryKeys.likbezList(centerId) })
      qc.removeQueries({ queryKey: queryKeys.likbez(likbezId) })
      qc.removeQueries({ queryKey: queryKeys.likbezTex(likbezId) })
    },
  })
}

export function usePutLikbezTex(likbezId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tex: string) => client.request<Likbez>('/mathcenter/likbez/' + likbezId + '/tex', { method: 'PUT', body: { tex } }),
    onSuccess: (item) => invalidateLikbez(qc, likbezId, item),
  })
}

export function useSetLikbezVideo(likbezId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (link: string) => client.request<Likbez>('/mathcenter/likbez/' + likbezId + '/video', { method: 'PUT', body: { link } }),
    onSuccess: (item) => invalidateLikbez(qc, likbezId, item),
  })
}

export function useUploadLikbezPdf(likbezId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: Blob) => {
      const { object_key, upload_url } = await client.request<PdfUploadURL>('/mathcenter/likbez/' + likbezId + '/pdf/upload-url', { method: 'POST' })
      const put = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file })
      if (!put.ok) throw new Error('PDF upload failed (' + put.status + ')')
      return client.request<Likbez>('/mathcenter/likbez/' + likbezId + '/pdf/publish', { method: 'POST', body: { object_key } })
    },
    onSuccess: (item) => invalidateLikbez(qc, likbezId, item),
  })
}

function useLikbezPublication(likbezId: number, action: 'publish' | 'unpublish') {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => client.request<Likbez>('/mathcenter/likbez/' + likbezId + '/' + action, { method: 'POST' }),
    onSuccess: (item) => invalidateLikbez(qc, likbezId, item),
  })
}

export function usePublishLikbez(likbezId: number) {
  return useLikbezPublication(likbezId, 'publish')
}

export function useUnpublishLikbez(likbezId: number) {
  return useLikbezPublication(likbezId, 'unpublish')
}
