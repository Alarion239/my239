import {
  formatDate,
  fullName,
  initials,
  primaryRole,
  roleLabel,
} from '@my239/shared'
import { useAuth } from '../../auth/auth-context'
import { Avatar, Badge, Card, CardContent } from '../../design/ui'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-3 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right text-sm text-ink">{value}</span>
    </div>
  )
}

export function ProfilePage() {
  const { user } = useAuth()
  if (!user) return null

  return (
    <div className="animate-rise">
      <h1 className="mb-6 font-display text-3xl font-medium text-ink">Профиль</h1>

      <Card>
        <CardContent className="pt-6">
          <div className="mb-5 flex items-center gap-4">
            <Avatar initials={initials(user)} className="h-14 w-14 text-lg" />
            <div className="min-w-0">
              <div className="truncate font-display text-xl font-medium text-ink">
                {fullName(user)}
              </div>
              <div className="text-sm text-muted">@{user.username}</div>
            </div>
          </div>

          <div className="mb-5 flex flex-wrap gap-2">
            <Badge variant="accent">{roleLabel(primaryRole(user))}</Badge>
            {user.is_math_center ? <Badge variant="neutral">Аккаунт матцентра</Badge> : null}
          </div>

          <div>
            <Row label="Имя" value={user.first_name} />
            {user.middle_name ? <Row label="Отчество" value={user.middle_name} /> : null}
            <Row label="Фамилия" value={user.last_name} />
            <Row label="Имя пользователя" value={`@${user.username}`} />
            <Row label="В системе с" value={formatDate(user.created_at)} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
