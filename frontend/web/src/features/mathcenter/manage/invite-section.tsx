import { useState } from 'react'
import {
  createInviteSchema,
  useManageGroups,
  useManageInvites,
  useManageCreateInvite,
  useManageRevokeInvite,
} from '@my239/shared'
import { Button, Input, Select } from '../../../design/ui'
import { ConfirmButton, SectionHeader } from '../../admin/_shared'

// InviteSection lists and creates center-scoped invite links for one role. The
// link is the registration URL with the token prefilled; a new user who opens
// it is auto-enrolled into this center on registration.
export function InviteSection({
  centerId,
  role,
}: {
  centerId: number
  role: 'teacher' | 'student'
}) {
  const { data: invites } = useManageInvites(centerId)
  const revoke = useManageRevokeInvite(centerId)
  const mine = (invites ?? []).filter((i) => i.role === role)

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <SectionHeader
        title="Пригласить по ссылке"
        description={
          role === 'teacher'
            ? 'Ссылка-приглашение для нового преподавателя.'
            : 'Ссылка-приглашение для нового ученика выбранной группы.'
        }
      />

      {mine.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {mine.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">
                  {inv.description || 'Без описания'}
                </p>
                <p className="text-xs text-muted">
                  Использовано {inv.uses} из {inv.max_uses} · до{' '}
                  {new Date(inv.expires_at).toLocaleDateString('ru-RU')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <CopyLinkButton token={inv.token} />
                <ConfirmButton
                  variant="ghost"
                  size="sm"
                  disabled={revoke.isPending}
                  onConfirm={() => revoke.mutate(inv.id)}
                >
                  Отозвать
                </ConfirmButton>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Активных приглашений нет.</p>
      )}

      <CreateInviteForm centerId={centerId} role={role} />
    </div>
  )
}

function CopyLinkButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false)
  const link = window.location.origin + '/register?token=' + token
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(link).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? 'Скопировано' : 'Копировать ссылку'}
    </Button>
  )
}

function CreateInviteForm({
  centerId,
  role,
}: {
  centerId: number
  role: 'teacher' | 'student'
}) {
  const create = useManageCreateInvite(centerId)
  const { data: groups } = useManageGroups(centerId)

  const [description, setDescription] = useState('')
  const [maxUses, setMaxUses] = useState('30')
  const [expiresHours, setExpiresHours] = useState('336') // 14 days
  const [isHead, setIsHead] = useState(false)
  const [groupId, setGroupId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const body = {
      role,
      description,
      max_uses: Number(maxUses),
      expires_in_hours: Number(expiresHours),
      ...(role === 'teacher'
        ? { is_head_teacher: isHead }
        : { group_id: groupId ? Number(groupId) : undefined }),
    }
    const parsed = createInviteSchema.safeParse(body)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля')
      return
    }
    create.mutate(
      { ...parsed.data, description: parsed.data.description ?? '' },
      {
      onSuccess: () => {
        setDescription('')
        setIsHead(false)
        setGroupId('')
      },
      onError: () => setError('Не удалось создать приглашение'),
      },
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-lg bg-surface-muted p-3">
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Описание (например, «Поток сентября»)"
        aria-label="Описание приглашения"
      />
      <div className="flex flex-wrap items-center gap-2">
        {role === 'student' ? (
          <Select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            aria-label="Группа"
            className="max-w-40"
          >
            <option value="">Группа…</option>
            {(groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        ) : (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={isHead}
              onChange={(e) => setIsHead(e.target.checked)}
            />
            Старший преподаватель
          </label>
        )}
        <Input
          type="number"
          min={1}
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
          aria-label="Макс. использований"
          className="max-w-28"
        />
        <Input
          type="number"
          min={1}
          value={expiresHours}
          onChange={(e) => setExpiresHours(e.target.value)}
          aria-label="Срок (часов)"
          className="max-w-28"
        />
        <Button type="submit" variant="secondary" disabled={create.isPending}>
          Создать ссылку
        </Button>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </form>
  )
}
