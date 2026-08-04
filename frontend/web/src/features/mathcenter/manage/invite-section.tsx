import { useMemo, useState } from 'react'
import {
  createInviteSchema,
  useManageGroups,
  useManageInvites,
  useManageCreateInvite,
  useManageCreatePersonalInvite,
  useManagePersonalInviteStudents,
  useManageRevokeInvite,
  isUnallocatedGroup,
  studentName,
  type PersonalInviteStudent,
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
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <SectionHeader
        title="Пригласить по ссылке"
        description={
          role === 'teacher'
            ? 'Ссылка-приглашение для нового преподавателя.'
            : 'Ссылка-приглашение для нового ученика. Группу можно назначить позже.'
        }
      />

      {mine.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {mine.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-subtle px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-text">
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
      {role === 'student' ? <CreatePersonalInviteForm centerId={centerId} /> : null}
    </div>
  )
}

function CreatePersonalInviteForm({ centerId }: { centerId: number }) {
  const students = useManagePersonalInviteStudents(centerId)
  const create = useManageCreatePersonalInvite(centerId)
  const [userId, setUserId] = useState<number | null>(null)
  const [studentQuery, setStudentQuery] = useState('')
  const [expiresHours, setExpiresHours] = useState('336')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const selectedUserId = userId ?? 0
    const hours = Number(expiresHours)
    if (!selectedUserId || !Number.isInteger(hours) || hours <= 0) {
      setError('Выберите ученика и срок действия')
      return
    }
    setError(null)
    create.mutate(
      { user_id: selectedUserId, expires_in_hours: hours },
      {
        onSuccess: () => {
          setUserId(null)
          setStudentQuery('')
        },
        onError: () => setError('Не удалось создать личную ссылку'),
      },
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-lg bg-surface-subtle p-3">
      <div>
        <p className="text-sm font-medium text-text">Личная ссылка для ученика из Google Sheets</p>
        <p className="text-xs text-muted">Ссылка привязана к одному ученику и используется один раз.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PersonalStudentCombobox
          students={students.data ?? []}
          value={studentQuery}
          selectedUserId={userId}
          isLoading={students.isPending}
          onChange={(value) => {
            setStudentQuery(value)
            setUserId(null)
          }}
          onSelect={(student) => {
            setStudentQuery(studentName(student))
            setUserId(student.user_id)
          }}
        />
        <label className="flex flex-col gap-1 text-xs font-medium text-text">
          Срок действия, часов
          <span className="font-normal text-muted">Когда личная ссылка перестанет работать.</span>
          <Input
            type="number"
            min={1}
            value={expiresHours}
            onChange={(event) => setExpiresHours(event.target.value)}
            aria-label="Срок личной ссылки (часов)"
            className="max-w-28"
          />
        </label>
        <Button type="submit" variant="secondary" disabled={create.isPending || userId == null}>
          Создать личную ссылку
        </Button>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </form>
  )
}

function PersonalStudentCombobox({
  students,
  value,
  selectedUserId,
  isLoading,
  onChange,
  onSelect,
}: {
  students: PersonalInviteStudent[]
  value: string
  selectedUserId: number | null
  isLoading: boolean
  onChange: (value: string) => void
  onSelect: (student: PersonalInviteStudent) => void
}) {
  const [focused, setFocused] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const normalized = value.trim().toLocaleLowerCase('ru-RU')
  const filtered = useMemo(
    () => students.filter((student) => {
      if (!normalized) return true
      return [studentName(student), student.middle_name ?? '', student.group_name]
        .join(' ')
        .toLocaleLowerCase('ru-RU')
        .includes(normalized)
    }),
    [normalized, students],
  )
  const showOptions = focused && !selectedUserId

  return (
    <div className="relative min-w-64">
      <label className="mb-1 block text-xs font-medium text-text" htmlFor="personal-invite-student">
        Ученик
      </label>
      <p className="mb-1 text-xs text-muted">Начните вводить фамилию или имя и выберите точное совпадение.</p>
      <Input
        id="personal-invite-student"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={(event) => {
          if (!showOptions || filtered.length === 0) return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActiveIndex((index) => Math.min(index + 1, filtered.length - 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex((index) => Math.max(index - 1, 0))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            onSelect(filtered[activeIndex] ?? filtered[0])
            setFocused(false)
          } else if (event.key === 'Escape') {
            setFocused(false)
          }
        }}
        onBlur={() => setFocused(false)}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showOptions}
        aria-controls="personal-invite-student-options"
        aria-label="Ученик для личной ссылки"
        placeholder={isLoading ? 'Загрузка…' : students.length === 0 ? 'Нет учеников без аккаунта' : 'Выберите ученика'}
        disabled={isLoading || students.length === 0}
      />
      {showOptions ? (
        <div id="personal-invite-student-options" role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-surface shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">Никого не найдено.</p>
          ) : filtered.map((student, index) => (
            <button
              key={student.user_id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-subtle"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelect(student)
                setFocused(false)
              }}
            >
              <span className="text-text">{studentName(student)}</span>
              <span className="text-xs text-muted">{student.group_name}</span>
            </button>
          ))}
        </div>
      ) : null}
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
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-lg bg-surface-subtle p-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-text" htmlFor={'invite-description-' + role}>
        Описание
        <span className="font-normal text-muted">Поможет отличать ссылку в списке, например «Поток сентября».</span>
        <Input
          id={'invite-description-' + role}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Поток сентября"
          aria-label="Описание приглашения"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {role === 'student' ? (
          <label className="flex flex-col gap-1 text-xs font-medium text-text">
            Группа
            <span className="font-normal text-muted">Куда добавить ученика после регистрации; можно назначить позже.</span>
            <Select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              aria-label="Группа"
              className="max-w-40"
            >
              <option value="">Без группы (по умолчанию)</option>
              {(groups ?? []).filter((group) => !isUnallocatedGroup(group.name)).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={isHead}
              onChange={(e) => setIsHead(e.target.checked)}
            />
            Старший преподаватель
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs font-medium text-text">
          Количество регистраций
          <span className="font-normal text-muted">Сколько аккаунтов можно создать по ссылке.</span>
          <Input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} aria-label="Макс. использований" className="max-w-28" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-text">
          Срок действия, часов
          <span className="font-normal text-muted">Когда ссылка перестанет работать.</span>
          <Input type="number" min={1} value={expiresHours} onChange={(e) => setExpiresHours(e.target.value)} aria-label="Срок (часов)" className="max-w-28" />
        </label>
        <Button type="submit" variant="secondary" disabled={create.isPending}>
          Создать ссылку
        </Button>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </form>
  )
}
