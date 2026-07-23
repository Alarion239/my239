// Math center data layer as TanStack Query hooks. Like the auth hooks, these
// run unchanged on web and React Native — UI and routing stay platform-specific.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MathCenterTerm, MeResponse } from '../types'
import { useApiClient } from './context'
import { queryKeys } from './keys'

// useMathCenterMe fetches the caller's math-center view (teacher and/or student
// roles). Honours the client's act-as header, so an admin impersonating a user
// sees that user's view.
export function useMathCenterMe() {
  const client = useApiClient()
  return useQuery<MeResponse>({
    queryKey: queryKeys.mathCenterMe,
    queryFn: () => client.request<MeResponse>('/mathcenter/me'),
    staleTime: 60_000,
  })
}

export function useMathCenterTerms(centerId: number) {
  const client = useApiClient()
  return useQuery<MathCenterTerm[]>({
    queryKey: queryKeys.mathCenterTerms(centerId),
    queryFn: () =>
      client.request<MathCenterTerm[]>('/mathcenter/centers/' + centerId + '/terms'),
    enabled: centerId > 0,
  })
}

export function useCreateMathCenterTerm(centerId: number) {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { kind: 'academic' | 'camp'; grade: number }) =>
      client.request<MathCenterTerm>('/mathcenter/centers/' + centerId + '/terms', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mathCenterTerms(centerId) })
      qc.invalidateQueries({ queryKey: ['mathcenter', 'centers', centerId] })
    },
  })
}
