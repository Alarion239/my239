import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  fullName,
  useManageGroups,
  useManageStudents,
  useManageAddStudent,
  useManageSetStudentGroup,
  useManageStudentSeriesRazborAccess,
  useManageSetStudentSeriesRazborAccess,
  useManageRemoveStudent,
  type ManageSeriesRazborAccess,
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
  const remove = useManageRemoveStudent(centerId)

  const [picked, setPicked] = useState<UserSearchResult | null>(null)
  const [addGroupId, setAddGroupId] = useState('')
  const [expandedStudentId, setExpandedStudentId] = useState<number | null>(null)
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
          description="Для каждой серии отдельно: видео и PDF + LaTeX. По умолчанию доступны оба формата."
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
                className="overflow-hidden rounded-lg bg-surface-muted"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-40 flex-1 text-sm text-ink">
                    {fullName(s)}
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      aria-expanded={expandedStudentId === s.id}
                      onClick={() =>
                        setExpandedStudentId((current) =>
                          current === s.id ? null : s.id,
                        )
                      }
                      className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      Настроить разборы
                      <ChevronDown
                        aria-hidden="true"
                        className={cn(
                          'h-3.5 w-3.5 transition-transform',
                          expandedStudentId === s.id && 'rotate-180',
                        )}
                      />
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
                </div>
                {expandedStudentId === s.id ? (
                  <RazborAccessPanel
                    centerId={centerId}
                    studentId={s.id}
                    studentName={fullName(s)}
                  />
                ) : null}
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

function RazborAccessPanel({
  centerId,
  studentId,
  studentName,
}: {
  centerId: number
  studentId: number
  studentName: string
}) {
  const access = useManageStudentSeriesRazborAccess(centerId, studentId)
  const setAccess = useManageSetStudentSeriesRazborAccess(centerId)
  const [error, setError] = useState<string | null>(null)

  const update = (
    row: ManageSeriesRazborAccess,
    field: 'video' | 'pdf_tex',
  ) => {
    setError(null)
    setAccess.mutate(
      {
        studentId,
        seriesId: row.series_id,
        canViewVideo:
          field === 'video' ? !row.can_view_video : row.can_view_video,
        canViewPDFTex:
          field === 'pdf_tex' ? !row.can_view_pdf_tex : row.can_view_pdf_tex,
      },
      {
        onError: () => setError('Не удалось изменить доступ к этой серии'),
      },
    )
  }

  return (
    <div className="border-t border-line bg-surface px-3 py-3">
      <div className="mb-2 hidden grid-cols-[minmax(0,1fr)_8rem_9rem] gap-3 px-2 text-xs font-medium uppercase tracking-wide text-faint sm:grid">
        <span>Серия</span>
        <span>Видео</span>
        <span>PDF + LaTeX</span>
      </div>
      {access.isPending ? (
        <div className="px-2 py-3">
          <Spinner />
        </div>
      ) : access.isError || !access.data ? (
        <p className="px-2 py-2 text-sm text-danger">
          Не удалось загрузить доступ к разборам.
        </p>
      ) : access.data.length === 0 ? (
        <p className="px-2 py-2 text-sm text-muted">В этом периоде пока нет серий.</p>
      ) : (
        <div className="flex flex-col divide-y divide-line">
          {access.data.map((row) => (
            <div
              key={row.series_id}
              className="grid gap-2 px-2 py-2.5 sm:grid-cols-[minmax(0,1fr)_8rem_9rem] sm:items-center sm:gap-3"
            >
              <span className="min-w-0 text-sm font-medium text-ink">
                {row.series_number}. {row.series_name}
              </span>
              <AccessSwitch
                label="Видео"
                checked={row.can_view_video}
                disabled={setAccess.isPending}
                actionLabel={
                  (row.can_view_video ? 'Закрыть видео' : 'Открыть видео') +
                  ' серии ' +
                  row.series_number +
                  ' для ' +
                  studentName
                }
                onClick={() => update(row, 'video')}
              />
              <AccessSwitch
                label="PDF + LaTeX"
                checked={row.can_view_pdf_tex}
                disabled={setAccess.isPending}
                actionLabel={
                  (row.can_view_pdf_tex
                    ? 'Закрыть PDF и LaTeX'
                    : 'Открыть PDF и LaTeX') +
                  ' серии ' +
                  row.series_number +
                  ' для ' +
                  studentName
                }
                onClick={() => update(row, 'pdf_tex')}
              />
            </div>
          ))}
        </div>
      )}
      {error ? <p className="mt-2 px-2 text-sm text-danger">{error}</p> : null}
    </div>
  )
}

function AccessSwitch({
  label,
  checked,
  disabled,
  actionLabel,
  onClick,
}: {
  label: string
  checked: boolean
  disabled: boolean
  actionLabel: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={actionLabel}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 items-center justify-between gap-2 rounded-md text-xs font-medium text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 sm:justify-start"
    >
      <span className="sm:hidden">{label}</span>
      <span
        aria-hidden="true"
        className={cn(
          'relative inline-flex h-5 w-9 rounded-full border transition-colors',
          checked
            ? 'border-accent bg-accent'
            : 'border-line-strong bg-surface-muted',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full transition-transform',
            checked
              ? 'translate-x-[1.125rem] bg-white'
              : 'translate-x-0.5 bg-faint',
          )}
        />
      </span>
      <span className="w-12 text-left">{checked ? 'да' : 'нет'}</span>
    </button>
  )
}
