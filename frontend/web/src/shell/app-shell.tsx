import { Outlet } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'
import { useImpersonation } from '../auth/impersonation-context'
import { Button } from '../design/ui'
import { NavRail } from './nav-rail'
import { TopBar } from './top-bar'

// AppShell is the authenticated chrome: persistent nav rail (md+), a top bar,
// and the routed content region. Every module renders into <Outlet/>.
export function AppShell() {
  const { user } = useAuth()
  const { actingAs, stop } = useImpersonation()
  // RequireAuth guarantees a user before this renders, but guard defensively.
  if (!user) return null

  return (
    <div className="flex min-h-screen bg-paper">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} />
        {actingAs ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-accent-soft px-4 py-2.5 text-accent-ink sm:px-6 lg:px-10">
            <span className="text-sm font-medium">Просмотр от имени {actingAs.label}</span>
            <Button variant="secondary" size="sm" onClick={stop}>
              Выйти из режима
            </Button>
          </div>
        ) : null}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10">
          <div className="mx-auto w-full max-w-5xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
