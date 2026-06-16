import { Outlet } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'
import { NavRail } from './nav-rail'
import { TopBar } from './top-bar'

// AppShell is the authenticated chrome: persistent nav rail (md+), a top bar,
// and the routed content region. Every module renders into <Outlet/>.
export function AppShell() {
  const { user } = useAuth()
  // RequireAuth guarantees a user before this renders, but guard defensively.
  if (!user) return null

  return (
    <div className="flex min-h-screen bg-paper">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10">
          <div className="mx-auto w-full max-w-5xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
