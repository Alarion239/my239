import { useState } from 'react'
import {
  fullName,
  useManageGroups,
  useManageStudents,
  useManageAddStudent,
  useManageSetStudentGroup,
  useManageRemoveStudent,
  type UserSearchResult,
} from '@my239/shared'
import { Button, Card, CardContent, Select, Spinner } from '../../../design/ui'
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
        <SectionHeader title="Ученики" description="Ученики этого матцентра по группам." />

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
                <span className="text-sm text-ink">{fullName(s)}</span>
                <div className="flex items-center gap-2">
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
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>

        <InviteSection centerId={centerId} role="student" />
      </CardContent>
    </Card>
  )
}
