// Math center data layer as TanStack Query hooks. Like the auth hooks, these
// run unchanged on web and React Native — UI and routing stay platform-specific.

import { useQuery } from '@tanstack/react-query'
import type { MeResponse, User } from '../types'
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

// useAdminUsers backs the web "View as" picker: the full user list an admin can
// impersonate. Admin-gated server-side; non-admins get a 401/403.
export function useAdminUsers() {
  const client = useApiClient()
  return useQuery<User[]>({
    queryKey: queryKeys.adminUsers,
    queryFn: () => client.request<User[]>('/admin/users'),
  })
}
