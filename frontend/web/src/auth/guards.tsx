import { Navigate, Outlet } from 'react-router-dom'
import { primaryRole, type Role } from '@my239/shared'
import { useAuth } from './auth-context'
import { FullPageSpinner } from '../design/ui'

// RequireAuth gates the authenticated app: spinner while the session resolves,
// redirect to /login when signed out, otherwise render the nested routes.
export function RequireAuth() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

// RedirectIfAuthed wraps the public auth pages so a signed-in user never sees
// the login/register forms.
export function RedirectIfAuthed() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <FullPageSpinner />
  if (user) return <Navigate to="/" replace />
  return <Outlet />
}

// RequireRole gates a subtree to a set of coarse account roles. Finer
// math-center permissions are enforced per module against /mathcenter/me.
export function RequireRole({ roles }: { roles: Role[] }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(primaryRole(user))) return <Navigate to="/" replace />
  return <Outlet />
}
