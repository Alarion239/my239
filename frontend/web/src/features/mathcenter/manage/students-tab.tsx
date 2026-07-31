import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  fullName,
  useManageAddStudent,
  useManageGroups,
  useManageRazborAccess,
  useManageRemoveStudent,
  useManageSetRazborAccess,
  useManageSetStudentGroup,
  useManageStudents,
  type ManageRazborAccessCell,
  type ManageRazborAccessResponse,
  type ManageRazborAccessStudent,
  type ManageRazborAccessMutation,
  type ManageStudent,
  type UserSearchResult,
} from '@my239/shared'
import { Button, Card, CardContent, Select, Spinner } from '../../../design/ui'
import { cn } from '../../../design/cn'
import { ConfirmButton, SectionHeader } from '../../admin/_shared'
import { UserSearchSelect } from './user-search-select'
import { InviteSection } from './invite-section'

type Format = 'pdf_tex' | 'video'
type TriState = boolean | 'mixed'
type AccessTarget = Omit<ManageRazborAccessMutation, 'allowed'>

const FORMAT_LABEL: Record<Format, string> = {
  pdf_tex: 'Письменный разбор (PDF и LaTeX)',
  video: 'Видеоразбор',
}

function cellKey(studentId: number, seriesId: number): string {
  return studentId + ':' + seriesId
}

function aggregate(values: boolean[]): TriState {
  if (values.length === 0 || values.every(Boolean)) return true
  if (values.every((value) => !value)) return false
  return 'mixed'
}

function fullNameFromMatrix(student: ManageRazborAccessStudent): string {
  return student.name || 'Ученик'
}

function formatValue(
  cell: ManageRazborAccessCell | undefined,
  format: Format,
): boolean {
  return format === 'video'
    ? cell?.can_view_video ?? false
    : cell?.can_view_pdf_tex ?? false
}

function applyMutation(
  data: ManageRazborAccessResponse,
  mutation: ManageRazborAccessMutation,
): ManageRazborAccessResponse {
  const next: ManageRazborAccessResponse = {
    series: data.series,
    groups: data.groups.map((group) => ({ ...group })),
    students: data.students.map((student) => ({ ...student })),
    cells: data.cells.map((cell) => ({ ...cell })),
  }

  if (mutation.mode === 'default') {
    const matchesGroup = (groupId: number) =>
      mutation.target === 'term' || mutation.groupId === groupId
    const matchesStudent = (student: ManageRazborAccessStudent) =>
      (mutation.target === 'term' ||
        (mutation.target === 'group' && mutation.groupId === student.group_id) ||
        (mutation.target === 'student' && mutation.studentId === student.student_id))

    next.groups = next.groups.map((group) =>
      matchesGroup(group.id)
        ? mutation.format === 'video'
          ? { ...group, razbor_default_video: mutation.allowed }
          : { ...group, razbor_default_pdf_tex: mutation.allowed }
        : group,
    )
    next.students = next.students.map((student) =>
      matchesStudent(student)
        ? mutation.format === 'video'
          ? { ...student, razbor_default_video: mutation.allowed }
          : { ...student, razbor_default_pdf_tex: mutation.allowed }
        : student,
    )
    return next
  }

  const selectedSeries = mutation.seriesId ?? 0
  next.cells = next.cells.map((cell) => {
    const targetMatches =
      mutation.target === 'term' ||
      (mutation.target === 'group' && cell.group_id === mutation.groupId) ||
      (mutation.target === 'student' && cell.student_id === mutation.studentId)
    if (!targetMatches || (selectedSeries > 0 && cell.series_id !== selectedSeries)) {
      return cell
    }
    return mutation.format === 'video'
      ? { ...cell, can_view_video: mutation.allowed }
      : { ...cell, can_view_pdf_tex: mutation.allowed }
  })
  return next
}

function accessValue(
  data: ManageRazborAccessResponse,
  target: 'term' | 'group' | 'student',
  format: Format,
  seriesId: number,
  groupId?: number,
  studentId?: number,
): TriState {
  const cells = data.cells.filter(
    (cell) =>
      (target === 'term' ||
        (target === 'group' && cell.group_id === groupId) ||
        (target === 'student' && cell.student_id === studentId)) &&
      (seriesId === 0 || cell.series_id === seriesId),
  )
  return aggregate(cells.map((cell) => formatValue(cell, format)))
}

function defaultValue(
  data: ManageRazborAccessResponse,
  target: 'term' | 'group' | 'student',
  format: Format,
  groupId?: number,
  studentId?: number,
): TriState {
  const values =
    target === 'student'
      ? data.students
          .filter((student) => student.student_id === studentId)
          .map((student) =>
            format === 'video'
              ? student.razbor_default_video
              : student.razbor_default_pdf_tex,
          )
      : target === 'group'
        ? data.students
            .filter((student) => student.group_id === groupId)
            .map((student) =>
              format === 'video'
                ? student.razbor_default_video
                : student.razbor_default_pdf_tex,
            )
        : data.students.map((student) =>
            format === 'video'
              ? student.razbor_default_video
              : student.razbor_default_pdf_tex,
          )
  return aggregate(values)
}

function TriangleCell({
  written,
  video,
  writtenPosted = true,
  videoPosted = true,
  disabled,
  onToggle,
  context,
}: {
  written: TriState
  video: TriState
  writtenPosted?: boolean
  videoPosted?: boolean
  disabled: boolean
  onToggle: (format: Format) => void
  context: string
}) {
  const mark = (value: TriState) => (value === 'mixed' ? '—' : value ? '✓' : '')
  const aria = (format: Format, value: TriState, posted: boolean) =>
    context + ': ' + FORMAT_LABEL[format] + ' — ' +
    (value === 'mixed' ? 'частично доступно' : value ? 'доступно' : 'закрыто') +
    (posted ? '' : ' — ещё не опубликовано')
  return (
    <div
      className={cn(
        'relative h-10 w-12 shrink-0 overflow-hidden rounded-md border border-line-strong bg-surface',
        disabled && 'opacity-60',
      )}
    >
      <button
        type="button"
        aria-label={aria('pdf_tex', written, writtenPosted)}
        disabled={disabled}
        onClick={() => onToggle('pdf_tex')}
        className={cn(
          'absolute inset-0 flex items-start justify-start px-1 pt-0.5 text-[0.7rem] font-semibold text-status-accepted transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50',
          writtenPosted ? 'hover:bg-status-accepted-soft' : 'bg-slate-300/75 text-slate-600 hover:bg-slate-400/75 dark:bg-slate-700/75 dark:text-slate-300',
        )}
        style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
      >
        {mark(written)}
      </button>
      <button
        type="button"
        aria-label={aria('video', video, videoPosted)}
        disabled={disabled}
        onClick={() => onToggle('video')}
        className={cn(
          'absolute inset-0 flex items-end justify-end px-1 pb-0.5 text-[0.7rem] font-semibold text-status-accepted transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50',
          videoPosted ? 'hover:bg-status-accepted-soft' : 'bg-slate-300/75 text-slate-600 hover:bg-slate-400/75 dark:bg-slate-700/75 dark:text-slate-300',
        )}
        style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}
      >
        {mark(video)}
      </button>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <line x1="100" y1="0" x2="0" y2="100" stroke="rgba(148, 163, 184, 0.72)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}

function RazborAccessMatrix({
  data,
  setAccess,
}: {
  data: ManageRazborAccessResponse
  setAccess: ReturnType<typeof useManageSetRazborAccess>
}) {
  const [draft, setDraft] = useState(data)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!setAccess.isPending) setDraft(data)
  }, [data, setAccess.isPending])

  const studentsByGroup = useMemo(() => {
    const byGroup = new Map<number, ManageRazborAccessStudent[]>()
    for (const student of draft.students) {
      const rows = byGroup.get(student.group_id) ?? []
      rows.push(student)
      byGroup.set(student.group_id, rows)
    }
    return byGroup
  }, [draft.students])

  const cellByKey = useMemo(() => {
    const map = new Map<string, ManageRazborAccessCell>()
    for (const cell of draft.cells) map.set(cellKey(cell.student_id, cell.series_id), cell)
    return map
  }, [draft.cells])

  const toggle = (mutation: AccessTarget, current: TriState) => {
    const nextAllowed = current !== true
    const nextMutation = { ...mutation, allowed: nextAllowed }
    setError(null)
    setDraft((currentDraft) => applyMutation(currentDraft, nextMutation))
    setAccess.mutate(nextMutation, {
      onError: () => {
        setDraft(data)
        setError('Не удалось изменить доступ к разборам.')
      },
    })
  }

  const groupRows = draft.groups.map((group) => {
    const groupStudents = studentsByGroup.get(group.id) ?? []
    return { group, students: groupStudents }
  })

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="overflow-x-auto">
        <table className="min-w-max border-collapse text-sm">
          <thead>
            <tr className="bg-surface-muted">
              <th className="sticky left-0 z-30 min-w-56 border-b border-r border-line bg-surface-muted px-3 py-2 text-left font-medium text-ink">
                Ученик / группа
              </th>
              <th className="border-b border-line px-2 py-2 text-center text-xs font-medium text-muted">
                <div className="mb-1 whitespace-nowrap">Все серии</div>
                <TriangleCell
                  written={accessValue(draft, 'term', 'pdf_tex', 0)}
                  video={accessValue(draft, 'term', 'video', 0)}
                  disabled={setAccess.isPending}
                  onToggle={(format) => toggle({ target: 'term', mode: 'series', format }, accessValue(draft, 'term', format, 0))}
                  context="Все серии"
                />
              </th>
              <th className="border-b border-line px-2 py-2 text-center text-xs font-medium text-muted">
                <div className="mb-1 whitespace-nowrap">По умолчанию</div>
                <TriangleCell
                  written={defaultValue(draft, 'term', 'pdf_tex')}
                  video={defaultValue(draft, 'term', 'video')}
                  disabled={setAccess.isPending}
                  onToggle={(format) => toggle({ target: 'term', mode: 'default', format }, defaultValue(draft, 'term', format))}
                  context="По умолчанию"
                />
              </th>
              {draft.series.map((series) => (
                <th key={series.series_id} className="border-b border-line px-2 py-2 text-center font-medium text-ink">
                  <div className="mb-1 whitespace-nowrap text-xs">Серия {series.series_number}</div>
                  <TriangleCell
                    written={accessValue(draft, 'term', 'pdf_tex', series.series_id)}
                    video={accessValue(draft, 'term', 'video', series.series_id)}
                    writtenPosted={series.written_posted}
                    videoPosted={series.video_posted}
                    disabled={setAccess.isPending}
                    onToggle={(format) => toggle({ target: 'term', mode: 'series', format, seriesId: series.series_id }, accessValue(draft, 'term', format, series.series_id))}
                    context={'Серия ' + series.series_number}
                  />
                </th>
              ))}
            </tr>
            <tr className="bg-surface-muted/70">
              <th className="sticky left-0 z-30 border-b border-r border-line bg-surface-muted/70 px-3 py-1 text-left text-[0.65rem] font-normal text-faint">
                Верхний левый треугольник — письменный · нижний правый — видео
              </th>
              <th className="border-b border-line px-2 py-1 text-center text-[0.65rem] font-normal text-faint">текущие</th>
              <th className="border-b border-line px-2 py-1 text-center text-[0.65rem] font-normal text-faint">новые серии</th>
              {draft.series.map((series) => (
                <th key={series.series_id} className="border-b border-line px-2 py-1 text-[0.65rem] font-normal text-faint">
                  {series.series_name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groupRows.map(({ group, students }) => {
              const isCollapsed = collapsed.has(group.id)
              return (
                <Fragment key={group.id}>
                  <tr className="bg-surface-muted/60">
                    <th className="sticky left-0 z-20 border-b border-r border-line bg-surface-muted/60 px-2 py-1 text-left">
                      <button
                        type="button"
                        aria-expanded={!isCollapsed}
                        aria-label={(isCollapsed ? 'Развернуть группу ' : 'Свернуть группу ') + group.name}
                        onClick={() => setCollapsed((current) => {
                          const next = new Set(current)
                          if (next.has(group.id)) next.delete(group.id)
                          else next.add(group.id)
                          return next
                        })}
                        className="flex min-h-9 items-center gap-1.5 rounded-md px-1 text-xs font-semibold uppercase tracking-wide text-muted hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      >
                        <ChevronDown className={cn('h-4 w-4 transition-transform', isCollapsed && '-rotate-90')} aria-hidden="true" />
                        {group.name}
                      </button>
                    </th>
                    <td className="border-b border-line px-2 py-1">
                      <TriangleCell
                        written={accessValue(draft, 'group', 'pdf_tex', 0, group.id)}
                        video={accessValue(draft, 'group', 'video', 0, group.id)}
                        disabled={setAccess.isPending}
                        onToggle={(format) => toggle({ target: 'group', mode: 'series', format, groupId: group.id }, accessValue(draft, 'group', format, 0, group.id))}
                        context={'Группа ' + group.name + ' · все серии'}
                      />
                    </td>
                    <td className="border-b border-line px-2 py-1">
                      <TriangleCell
                        written={group.razbor_default_pdf_tex}
                        video={group.razbor_default_video}
                        disabled={setAccess.isPending}
                        onToggle={(format) => toggle({ target: 'group', mode: 'default', format, groupId: group.id }, format === 'video' ? group.razbor_default_video : group.razbor_default_pdf_tex)}
                        context={'Группа ' + group.name + ' · по умолчанию'}
                      />
                    </td>
                    {draft.series.map((series) => (
                      <td key={series.series_id} className="border-b border-line px-2 py-1">
                        <TriangleCell
                          written={accessValue(draft, 'group', 'pdf_tex', series.series_id, group.id)}
                          video={accessValue(draft, 'group', 'video', series.series_id, group.id)}
                          writtenPosted={series.written_posted}
                          videoPosted={series.video_posted}
                          disabled={setAccess.isPending}
                          onToggle={(format) => toggle({ target: 'group', mode: 'series', format, groupId: group.id, seriesId: series.series_id }, accessValue(draft, 'group', format, series.series_id, group.id))}
                          context={'Группа ' + group.name + ' · серия ' + series.series_number}
                        />
                      </td>
                    ))}
                  </tr>
                  {!isCollapsed && students.map((student) => (
                    <tr key={student.student_id}>
                      <td className="sticky left-0 z-10 border-b border-r border-line bg-surface px-3 py-1.5 text-sm text-ink">
                        {fullNameFromMatrix(student)}
                      </td>
                      <td className="border-b border-line px-2 py-1">
                        <TriangleCell
                          written={accessValue(draft, 'student', 'pdf_tex', 0, undefined, student.student_id)}
                          video={accessValue(draft, 'student', 'video', 0, undefined, student.student_id)}
                          disabled={setAccess.isPending}
                          onToggle={(format) => toggle({ target: 'student', mode: 'series', format, studentId: student.student_id }, accessValue(draft, 'student', format, 0, undefined, student.student_id))}
                          context={fullNameFromMatrix(student) + ' · все серии'}
                        />
                      </td>
                      <td className="border-b border-line px-2 py-1">
                        <TriangleCell
                          written={student.razbor_default_pdf_tex}
                          video={student.razbor_default_video}
                          disabled={setAccess.isPending}
                          onToggle={(format) => toggle({ target: 'student', mode: 'default', format, studentId: student.student_id }, format === 'video' ? student.razbor_default_video : student.razbor_default_pdf_tex)}
                          context={fullNameFromMatrix(student) + ' · по умолчанию'}
                        />
                      </td>
                      {draft.series.map((series) => {
                        const cell = cellByKey.get(cellKey(student.student_id, series.series_id))
                        return (
                          <td key={series.series_id} className="border-b border-line px-2 py-1">
                            <TriangleCell
                              written={cell?.can_view_pdf_tex ?? false}
                              video={cell?.can_view_video ?? false}
                              writtenPosted={series.written_posted}
                              videoPosted={series.video_posted}
                              disabled={setAccess.isPending}
                              onToggle={(format) => toggle({ target: 'student', mode: 'series', format, studentId: student.student_id, seriesId: series.series_id }, formatValue(cell, format))}
                              context={fullNameFromMatrix(student) + ' · серия ' + series.series_number}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {error ? <p className="border-t border-line px-3 py-2 text-sm text-danger">{error}</p> : null}
    </div>
  )
}

export function RazborAccessTab({ centerId }: { centerId: number }) {
  const access = useManageRazborAccess(centerId)
  const setAccess = useManageSetRazborAccess(centerId)

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <SectionHeader
          title="Доступ к разборам"
          description="Верхний левый треугольник — письменный разбор, нижний правый — видео. Серые треугольники ещё не опубликованы, но их можно настроить заранее."
        />
        {access.isPending ? <Spinner /> : access.isError || !access.data ? (
          <p className="text-sm text-danger">Не удалось загрузить доступ к разборам.</p>
        ) : (
          <RazborAccessMatrix data={access.data} setAccess={setAccess} />
        )}
      </CardContent>
    </Card>
  )
}

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
        <div>
          <SectionHeader title="Состав учеников" description="Группа и удаление ученика остаются отдельными действиями." />
          {isPending ? <Spinner /> : isError || !students ? (
            <p className="text-sm text-danger">Не удалось загрузить учеников.</p>
          ) : students.length === 0 ? (
            <p className="text-sm text-muted">Пока нет учеников.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1.5">
              {students.map((student: ManageStudent) => (
                <li key={student.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-muted px-3 py-2">
                  <span className="min-w-44 flex-1 text-sm text-ink">{fullName(student)}</span>
                  <Select
                    value={student.group_id}
                    aria-label={'Группа ученика ' + fullName(student)}
                    className="h-9 max-w-36"
                    disabled={setGroup.isPending}
                    onChange={(event) => setGroup.mutate({ studentId: student.id, groupId: Number(event.target.value) })}
                  >
                    {(groups ?? []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  </Select>
                  <ConfirmButton variant="ghost" size="sm" disabled={remove.isPending} onConfirm={() => remove.mutate(student.id)}>
                    Удалить
                  </ConfirmButton>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-sm font-medium text-ink">Добавить из пользователей</p>
          <UserSearchSelect centerId={centerId} onSelect={setPicked} />
          {picked ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-muted px-3 py-2">
              <span className="text-sm text-ink">{fullName(picked)}</span>
              <Select value={addGroupId} onChange={(event) => setAddGroupId(event.target.value)} aria-label="Группа" className="h-9 max-w-40">
                <option value="">Группа…</option>
                {(groups ?? []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </Select>
              <Button type="button" variant="secondary" size="sm" onClick={onAdd}>Добавить учеником</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(null)}>Отмена</Button>
            </div>
          ) : null}
        </div>
        <InviteSection centerId={centerId} role="student" />
      </CardContent>
    </Card>
  )
}
