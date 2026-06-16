import { createContext, useContext, type ReactNode } from 'react'
import { useMe, type User } from '@my239/shared'

// AuthProvider exposes the current session (derived from the shared useMe
// query) to the rest of the web app. Server state lives in TanStack Query; this
// is just a thin, ergonomic read surface for components and guards.
interface AuthValue {
  user: User | null
  isLoading: boolean
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isPending } = useMe()
  const value: AuthValue = { user: data ?? null, isLoading: isPending }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
