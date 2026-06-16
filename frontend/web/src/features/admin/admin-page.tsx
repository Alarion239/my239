import { ShieldCheck } from 'lucide-react'
import { PlaceholderPage } from '../placeholder-page'

// Admin-only stand-in (users, invitation tokens, math-center provisioning).
// Gated by RequireRole in the router.
export function AdminPage() {
  return (
    <PlaceholderPage
      title="Администрирование"
      description="Управление пользователями, приглашениями и матцентрами появится здесь."
      icon={ShieldCheck}
    />
  )
}
