import { useQueryClient } from '@tanstack/react-query'
import { fullName, type User } from '@my239/shared'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { apiClient } from '../lib/api'

// ActingAs is the lightweight, persisted descriptor of who an admin is currently
// viewing the app as. The id drives the X-Act-As-User-Id header; the label is
// just for display (banner, menus).
export interface ActingAs {
  id: number
  label: string
}

interface ImpersonationValue {
  actingAs: ActingAs | null
  impersonate: (user: User) => void
  stop: () => void
}

const ImpersonationContext = createContext<ImpersonationValue | null>(null)

const STORAGE_KEY = 'my239.actingAs'

function readStored(): ActingAs | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ActingAs>
    if (typeof parsed?.id === 'number' && typeof parsed?.label === 'string') {
      return { id: parsed.id, label: parsed.label }
    }
  } catch {
    // Corrupt/foreign value — ignore and start fresh.
  }
  return null
}

// ImpersonationProvider owns the act-as state for the session. It keeps the
// shared ApiClient header, sessionStorage, and React Query cache in lockstep so
// that domain views always render as the chosen identity.
export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  // Initialise from sessionStorage so a refresh keeps the impersonation active.
  const [actingAs, setActingAs] = useState<ActingAs | null>(() => readStored())

  // On mount, replay the restored value onto the ApiClient (the client is a
  // fresh singleton each load and starts with no act-as header).
  useEffect(() => {
    apiClient.setActingAs(actingAs?.id ?? null)
    // Run once on mount; subsequent changes go through impersonate/stop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const impersonate = useCallback(
    (user: User) => {
      const next: ActingAs = { id: user.id, label: fullName(user) }
      apiClient.setActingAs(next.id)
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      setActingAs(next)
      // Refetch every domain view as the new identity.
      queryClient.invalidateQueries()
    },
    [queryClient],
  )

  const stop = useCallback(() => {
    apiClient.setActingAs(null)
    sessionStorage.removeItem(STORAGE_KEY)
    setActingAs(null)
    queryClient.invalidateQueries()
  }, [queryClient])

  const value = useMemo<ImpersonationValue>(
    () => ({ actingAs, impersonate, stop }),
    [actingAs, impersonate, stop],
  )

  return (
    <ImpersonationContext.Provider value={value}>{children}</ImpersonationContext.Provider>
  )
}

export function useImpersonation(): ImpersonationValue {
  const ctx = useContext(ImpersonationContext)
  if (!ctx) throw new Error('useImpersonation must be used within <ImpersonationProvider>')
  return ctx
}
