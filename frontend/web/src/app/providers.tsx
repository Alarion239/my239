import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiClientProvider } from '@my239/shared'
import { useState, type ReactNode } from 'react'
import { apiClient } from '../lib/api'
import { ThemeProvider } from '../design/theme-provider'
import { AuthProvider } from '../auth/auth-context'

// AppProviders wires the whole context stack: theme, the React Query cache, the
// shared ApiClient, and the derived auth session.
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  )

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>
          <AuthProvider>{children}</AuthProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
