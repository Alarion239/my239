import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  APIErrorImpl,
  fullName,
  formatDate,
  useAdminTokens,
  useAdminUsers,
  useRevokeToken,
  useSetUserAdmin,
  type InvitationToken,
  type User,
} from '@my239/shared'
import { useAuth } from '../../auth/auth-context'
import {
  Badge,
  Button,
  Card,
  Spinner,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '../../design/ui'
import { ConfirmButton, SectionHeader } from './_shared'
import { CreateTokenDialog } from './create-token-dialog'

// tokenStatus derives a human label from expiry + usage.
function tokenStatus(t: InvitationToken): { label: string; variant: 'success' | 'neutral' | 'danger' } {
  const expired = new Date(t.expires_at).getTime() < Date.now()
  if (expired) return { label: 'Истёк', variant: 'danger' }
  if (t.uses >= t.max_uses) return { label: 'Исчерпан', variant: 'neutral' }
  return { label: 'Активен', variant: 'success' }
}

function UsersTable() {
  const { user: current } = useAuth()
  const { data: users, isPending, isError } = useAdminUsers()
  const setAdmin = useSetUserAdmin()
  const [actionError, setActionError] = useState<string | null>(null)

  if (isPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }
  if (isError || !users) {
    return <p className="py-6 text-sm text-danger">Не удалось загрузить пользователей.</p>
  }
  if (users.length === 0) {
    return <p className="py-6 text-sm text-muted">Пока нет пользователей.</p>
  }

  function toggleAdmin(u: User) {
    setActionError(null)
    setAdmin.mutate(
      { userId: u.id, isAdmin: !u.is_admin },
      {
        onError: (e) => {
          setActionError(
            e instanceof APIErrorImpl ? e.message : 'Не удалось изменить роль.',
          )
        },
      },
    )
  }

  return (
    <>
      {actionError ? <p className="mb-3 text-sm text-danger">{actionError}</p> : null}
      <Table>
        <THead>
          <Tr>
            <Th>Пользователь</Th>
            <Th>Роль</Th>
            <Th>В системе с</Th>
            <Th className="text-right">Действия</Th>
          </Tr>
        </THead>
        <TBody>
          {users.map((u) => {
            const isSelf = current?.id === u.id
            return (
              <Tr key={u.id}>
                <Td>
                  <Link
                    to={'/admin/users/' + u.id}
                    className="font-medium text-ink underline-offset-4 hover:text-accent hover:underline"
                  >
                    {fullName(u)}
                  </Link>
                  <div className="text-xs text-muted">@{u.username}</div>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    {u.is_admin ? <Badge variant="accent">Админ</Badge> : null}
                    {u.is_math_center ? <Badge variant="neutral">Матцентр</Badge> : null}
                    {!u.is_admin && !u.is_math_center ? (
                      <Badge variant="neutral">Участник</Badge>
                    ) : null}
                  </div>
                </Td>
                <Td className="whitespace-nowrap text-muted">{formatDate(u.created_at)}</Td>
                <Td className="text-right">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isSelf || setAdmin.isPending}
                    title={isSelf ? 'Нельзя изменить собственную роль' : undefined}
                    onClick={() => toggleAdmin(u)}
                  >
                    {u.is_admin ? 'Снять админа' : 'Сделать админом'}
                  </Button>
                </Td>
              </Tr>
            )
          })}
        </TBody>
      </Table>
    </>
  )
}

function TokensTable() {
  const { data: tokens, isPending, isError } = useAdminTokens()
  const revoke = useRevokeToken()

  if (isPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }
  if (isError || !tokens) {
    return <p className="py-6 text-sm text-danger">Не удалось загрузить приглашения.</p>
  }
  if (tokens.length === 0) {
    return <p className="py-6 text-sm text-muted">Пока нет приглашений.</p>
  }

  return (
    <Table>
      <THead>
        <Tr>
          <Th>Описание</Th>
          <Th>Использовано</Th>
          <Th>Истекает</Th>
          <Th>Статус</Th>
          <Th className="text-right">Действия</Th>
        </Tr>
      </THead>
      <TBody>
        {tokens.map((t) => {
          const status = tokenStatus(t)
          return (
            <Tr key={t.id}>
              <Td className="font-medium text-ink">{t.description}</Td>
              <Td className="whitespace-nowrap text-muted">
                {t.uses}/{t.max_uses}
              </Td>
              <Td className="whitespace-nowrap text-muted">{formatDate(t.expires_at)}</Td>
              <Td>
                <Badge variant={status.variant}>{status.label}</Badge>
              </Td>
              <Td className="text-right">
                <ConfirmButton
                  variant="ghost"
                  size="sm"
                  disabled={revoke.isPending}
                  onConfirm={() => revoke.mutate(t.id)}
                >
                  Отозвать
                </ConfirmButton>
              </Td>
            </Tr>
          )
        })}
      </TBody>
    </Table>
  )
}

export function UsersPage() {
  return (
    <div className="animate-rise flex flex-col gap-8">
      <section>
        <SectionHeader title="Пользователи" description="Все учётные записи платформы." />
        <Card className="p-2">
          <UsersTable />
        </Card>
      </section>

      <section>
        <SectionHeader
          title="Приглашения"
          description="Ссылки-приглашения для регистрации новых пользователей."
          action={<CreateTokenDialog />}
        />
        <Card className="p-2">
          <TokensTable />
        </Card>
      </section>
    </div>
  )
}
