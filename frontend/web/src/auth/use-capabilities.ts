import { deriveCapabilities, useMathCenterMe, type Capabilities } from '@my239/shared'
import { useAuth } from './auth-context'

// useCapabilities folds the real account (from /auth/me) together with the
// math-center view (from /mathcenter/me, which reflects impersonation) into the
// booleans the UI gates on. useMathCenterMe 401s gracefully to undefined when
// the user holds no math-center role, which deriveCapabilities tolerates.
export function useCapabilities(): Capabilities {
  const { user } = useAuth()
  const { data: me } = useMathCenterMe()
  return deriveCapabilities(user, me)
}
