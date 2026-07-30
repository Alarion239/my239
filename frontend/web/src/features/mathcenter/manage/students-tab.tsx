import { useState } from 'react'
import {
  fullName,
  useManageGroups,
  useManageStudents,
  useManageAddStudent,
  useManageSetStudentGroup,
  useManageSetStudentRazborAccess,
  useManageRemoveStudent,
  type UserSearchResult,
} from '@my239/shared'
import { Button, Card, CardContent, Select, Spinner } from '../../../design/ui'
import { cn } from '../../../design/cn'
import { ConfirmButton, SectionHeader } from '../../admin/_shared'
import { UserSearchSelect } from './user-search-select'
import { InviteSection } from './invite-section'

// StudentsTab manages a center's students: the roster (with a per-student group
// move and removal), an "add from users" search into a group, and student
// invite links.
export function StudentsTab({ centerId }: { centerId: number }) {
  const { data: students, isPending, isError } = useManageStudents(centerId)
  const { data: groups } = useManageGroups(centerId)
  const addStudent = useManageAddStudent(centerId)
  const setGroup = useManageSetStudentGroup(centerId)
  const setRazborAccess = useManageSetStudentRazborAccess(centerId)
  const remove = useManageRemoveStudent(centerId)

  const [picked, setPicked] = useState<UserSearchResult | null>(null)
  const [addGroupId, setAddGroupId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onAdd = () => {
    if (!picked || !addGroupId) {
      setError('Выберите пользователя и группу')
      return
    }
    setError(null)
    addStudent.mutate(
      { user_id: picked.id, group_id: Number(addGroupId) },
      {
        onSuccess: () => {
          setPicked(null)
          setAddGroupId('')
        },
        onError: () => setError('Не удалось добавить ученика'),
      },
    )
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <SectionHeader
          title="Ученики"
          description="Группы и доступ к разборам. По умолчанию разборы доступны всем."
        />

        {isPending ? (
          <Spinner />
        ) : isError || !students ? (
          <p className="text-sm text-danger">Не удалось загрузить учеников.</p>
        ) : students.length === 0 ? (
          <p className="text-sm text-muted">Пока нет учеников.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {students.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted px-3 py-2"
              >
                <span className="min-w-40 flex-1 text-sm text-ink">{fullName(s)}</span>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={s.can_view_razbors}
                    aria-label={
                      (s.can_view_razbors ? 'Закрыть' : 'Открыть') +
                      ' доступ к разборам для ' +
                      fullName(s)
                    }
                    disabled={setRazborAccess.isPending}
                    onClick={() => {
                      setError(null)
                      setRazborAccess.mutate(
                        {
                          studentId: s.id,
                          canViewRazbors: !s.can_view_razbors,
                        },
                        {
                          onError: () =>
                            setError('Не удалось изменить доступ к разборам'),
                        },
                      )
                    }}
                    className="flex h-9 items-center gap-2 rounded-lg px-2 text-xs font-medium text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
                  >
                    <span>Разборы</span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'relative inline-flex h-5 w-9 rounded-full border transition-colors',
                        s.can_view_razbors
                          ? 'border-accent bg-accent'
                          : 'border-line-strong bg-surface',
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 h-3.5 w-3.5 rounded-full transition-transform',
                          s.can_view_razbors
                            ? 'translate-x-[1.125rem] bg-white'
                            : 'translate-x-0.5 bg-faint',
                        )}
                      />
                    </span>
                    <span className="w-16 text-left">
                      {s.can_view_razbors ? 'доступны' : 'закрыты'}
                    </span>
                  </button>
                  <Select
                    value={s.group_id}
                    aria-label="Группа ученика"
                    className="h-9 max-w-36"
                    disabled={setGroup.isPending}
                    onChange={(e) =>
                      setGroup.mutate({
                        studentId: s.id,
                        groupId: Number(e.target.value),
                      })
                    }
                  >
                    {(groups ?? []).map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </Select>
                  <ConfirmButton
                    variant="ghost"
                    size="sm"
                    disabled={remove.isPending}
                    onConfirm={() => remove.mutate(s.id)}
                  >
                    Удалить
                  </ConfirmButton>
                </div>
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-sm font-medium text-ink">Добавить из пользователей</p>
          <UserSearchSelect centerId={centerId} onSelect={setPicked} />
          {picked ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-muted px-3 py-2">
              <span className="text-sm text-ink">{fullName(picked)}</span>
              <Select
                value={addGroupId}
                onChange={(e) => setAddGroupId(e.target.value)}
                aria-label="Группа"
                className="h-9 max-w-40"
              >
                <option value="">Группа…</option>
                {(groups ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
              <Button type="button" variant="secondary" size="sm" onClick={onAdd}>
                Добавить учеником
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPicked(null)}
              >
                Отмена
              </Button>
            </div>
          ) : null}
        </div>

        <InviteSection centerId={centerId} role="student" />
      </CardContent>
    </Card>
  )
}
