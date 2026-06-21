import { useState } from 'react'
import {
  fullName,
  useManageTeachers,
  useManageAddTeacher,
  useManageSetTeacherHead,
  useManageRemoveTeacher,
  type UserSearchResult,
} from '@my239/shared'
import { Badge, Button, Card, CardContent, Spinner } from '../../../design/ui'
import { ConfirmButton, SectionHeader } from '../../admin/_shared'
import { UserSearchSelect } from './user-search-select'
import { InviteSection } from './invite-section'

// TeachersTab manages a center's teachers: the roster (with head toggle and
// removal), an "add from users" search, and teacher invite links.
export function TeachersTab({ centerId }: { centerId: number }) {
  const { data: teachers, isPending, isError } = useManageTeachers(centerId)
  const addTeacher = useManageAddTeacher(centerId)
  const setHead = useManageSetTeacherHead(centerId)
  const remove = useManageRemoveTeacher(centerId)

  const [picked, setPicked] = useState<UserSearchResult | null>(null)
  const [addHead, setAddHead] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onAdd = () => {
    if (!picked) return
    setError(null)
    addTeacher.mutate(
      { user_id: picked.id, is_head_teacher: addHead },
      {
        onSuccess: () => {
          setPicked(null)
          setAddHead(false)
        },
        onError: () => setError('Не удалось добавить преподавателя'),
      },
    )
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <SectionHeader title="Преподаватели" description="Преподаватели этого матцентра." />

        {isPending ? (
          <Spinner />
        ) : isError || !teachers ? (
          <p className="text-sm text-danger">Не удалось загрузить преподавателей.</p>
        ) : teachers.length === 0 ? (
          <p className="text-sm text-muted">Пока нет преподавателей.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {teachers.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted px-3 py-2"
              >
                <span className="flex items-center gap-2 text-sm text-ink">
                  {fullName(t)}
                  {t.is_head_teacher ? <Badge>Старший</Badge> : null}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={setHead.isPending}
                    onClick={() =>
                      setHead.mutate({ teacherId: t.id, isHeadTeacher: !t.is_head_teacher })
                    }
                  >
                    {t.is_head_teacher ? 'Снять старшего' : 'Сделать старшим'}
                  </Button>
                  <ConfirmButton
                    variant="ghost"
                    size="sm"
                    disabled={remove.isPending}
                    onConfirm={() =>
                      remove.mutate(t.id, {
                        onError: () =>
                          setError('Нельзя удалить последнего старшего преподавателя'),
                      })
                    }
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
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={addHead}
                  onChange={(e) => setAddHead(e.target.checked)}
                />
                Старший
              </label>
              <Button type="button" variant="secondary" size="sm" onClick={onAdd}>
                Добавить преподавателем
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

        <InviteSection centerId={centerId} role="teacher" />
      </CardContent>
    </Card>
  )
}
