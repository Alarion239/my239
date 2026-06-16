// Auth data layer as TanStack Query hooks. TanStack Query runs on both web and
// React Native, so the entire server-state surface lives here and is reused by
// every client. UI and routing stay platform-specific; this does not.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LoginRequest, RegisterRequest, User } from '../types'
import { useApiClient } from './context'
import { queryKeys } from './keys'

// useMe models the session: User when signed in, null when not. A 401 that
// can't be refreshed resolves to null (via client.meOrNull) rather than an
// error, so callers branch on data, not on error state.
export function useMe() {
  const client = useApiClient()
  return useQuery<User | null>({
    queryKey: queryKeys.me,
    queryFn: () => client.meOrNull(),
    staleTime: 60_000,
    retry: false,
  })
}

export function useLogin() {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LoginRequest) => client.login(body),
    onSuccess: (user) => qc.setQueryData<User | null>(queryKeys.me, user),
  })
}

export function useRegister() {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: RegisterRequest) => client.register(body),
    onSuccess: (user) => qc.setQueryData<User | null>(queryKeys.me, user),
  })
}

export function useLogout() {
  const client = useApiClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => client.logout(),
    onSuccess: () => {
      qc.setQueryData<User | null>(queryKeys.me, null)
      // Drop every other cached query so no signed-in data leaks across a
      // session boundary.
      qc.removeQueries()
    },
  })
}
