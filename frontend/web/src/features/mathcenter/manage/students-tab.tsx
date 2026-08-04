import { Fragment, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, Trash2 } from 'lucide-react'
import { snapCenterToCursor } from '@dnd-kit/modifiers'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  fullName,
  useManageAddStudent,
  useManageGroups,
  useManageRazborAccess,
  useManageRemoveStudent,
  useManageRosterBoard,
  useManageSetRosterStudentGroup,
  useManageSetRazborAccess,
  isUnallocatedGroup,
  UNALLOCATED_GROUP_NAME,
  type ManageRazborAccessCell,
  type ManageRazborAccessResponse,
  type ManageRazborAccessStudent,
  type ManageRazborAccessMutation,
  type ManageRosterBoardGroup,
  type ManageRosterBoardStudent,
  type UserSearchResult,
} from '@my239/shared'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Select,
  Spinner,
} from '../../../design/ui'
import { cn } from '../../../design/cn'
import { SectionHeader } from '../../admin/_shared'
import { UserSearchSelect } from './user-search-select'
import { InviteSection } from './invite-section'
import { StudentNameLabel } from '../student-name-color'

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
        'relative h-10 w-12 shrink-0 overflow-hidden rounded-md border border-border-control bg-surface',
        disabled && 'opacity-60',
      )}
    >
      <button
        type="button"
        aria-label={aria('pdf_tex', written, writtenPosted)}
        disabled={disabled}
        onClick={() => onToggle('pdf_tex')}
        className={cn(
          'absolute inset-0 flex items-start justify-start px-1 pt-0.5 text-[0.7rem] font-semibold text-status-accepted transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
          writtenPosted ? 'hover:bg-status-accepted-soft' : 'bg-surface-strong text-muted hover:bg-border-control',
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
          'absolute inset-0 flex items-end justify-end px-1 pb-0.5 text-[0.7rem] font-semibold text-status-accepted transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
          videoPosted ? 'hover:bg-status-accepted-soft' : 'bg-surface-strong text-muted hover:bg-border-control',
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

  const groupRows = draft.groups.filter((group) => !isUnallocatedGroup(group.name)).map((group) => {
    const groupStudents = studentsByGroup.get(group.id) ?? []
    return { group, students: groupStudents }
  })

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="min-w-max border-collapse text-sm">
          <thead>
            <tr className="bg-surface-subtle">
              <th className="sticky left-0 z-30 min-w-56 border-b border-r border-border bg-surface-subtle px-3 py-2 text-left font-medium text-text">
                Ученик / группа
              </th>
              <th className="border-b border-border px-2 py-2 text-center text-xs font-medium text-muted">
                <div className="mb-1 whitespace-nowrap">Все серии</div>
                <TriangleCell
                  written={accessValue(draft, 'term', 'pdf_tex', 0)}
                  video={accessValue(draft, 'term', 'video', 0)}
                  disabled={setAccess.isPending}
                  onToggle={(format) => toggle({ target: 'term', mode: 'series', format }, accessValue(draft, 'term', format, 0))}
                  context="Все серии"
                />
              </th>
              <th className="border-b border-border px-2 py-2 text-center text-xs font-medium text-muted">
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
                <th key={series.series_id} className="border-b border-border px-2 py-2 text-center font-medium text-text">
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
            <tr className="bg-surface-subtle/70">
              <th className="sticky left-0 z-30 border-b border-r border-border bg-surface-subtle/70 px-3 py-1 text-left text-[0.65rem] font-normal text-text-subtle">
                Верхний левый треугольник — письменный · нижний правый — видео
              </th>
              <th className="border-b border-border px-2 py-1 text-center text-[0.65rem] font-normal text-text-subtle">текущие</th>
              <th className="border-b border-border px-2 py-1 text-center text-[0.65rem] font-normal text-text-subtle">новые серии</th>
              {draft.series.map((series) => (
                <th key={series.series_id} className="border-b border-border px-2 py-1 text-[0.65rem] font-normal text-text-subtle">
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
                  <tr className="bg-surface-subtle/60">
                    <th className="sticky left-0 z-20 border-b border-r border-border bg-surface-subtle/60 px-2 py-1 text-left">
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
                        className="flex min-h-9 items-center gap-1.5 rounded-md px-1 text-xs font-semibold uppercase tracking-wide text-muted hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      >
                        <ChevronDown className={cn('h-4 w-4 transition-transform', isCollapsed && '-rotate-90')} aria-hidden="true" />
                        {group.name}
                      </button>
                    </th>
                    <td className="border-b border-border px-2 py-1">
                      <TriangleCell
                        written={accessValue(draft, 'group', 'pdf_tex', 0, group.id)}
                        video={accessValue(draft, 'group', 'video', 0, group.id)}
                        disabled={setAccess.isPending}
                        onToggle={(format) => toggle({ target: 'group', mode: 'series', format, groupId: group.id }, accessValue(draft, 'group', format, 0, group.id))}
                        context={'Группа ' + group.name + ' · все серии'}
                      />
                    </td>
                    <td className="border-b border-border px-2 py-1">
                      <TriangleCell
                        written={group.razbor_default_pdf_tex}
                        video={group.razbor_default_video}
                        disabled={setAccess.isPending}
                        onToggle={(format) => toggle({ target: 'group', mode: 'default', format, groupId: group.id }, format === 'video' ? group.razbor_default_video : group.razbor_default_pdf_tex)}
                        context={'Группа ' + group.name + ' · по умолчанию'}
                      />
                    </td>
                    {draft.series.map((series) => (
                      <td key={series.series_id} className="border-b border-border px-2 py-1">
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
                      <td className="sticky left-0 z-10 border-b border-r border-border bg-surface px-3 py-1.5 text-sm text-text">
                        <StudentNameLabel
                          name={fullNameFromMatrix(student)}
                          backgroundHex={student.background_hex}
                          className="px-0 py-0"
                        />
                      </td>
                      <td className="border-b border-border px-2 py-1">
                        <TriangleCell
                          written={accessValue(draft, 'student', 'pdf_tex', 0, undefined, student.student_id)}
                          video={accessValue(draft, 'student', 'video', 0, undefined, student.student_id)}
                          disabled={setAccess.isPending}
                          onToggle={(format) => toggle({ target: 'student', mode: 'series', format, studentId: student.student_id }, accessValue(draft, 'student', format, 0, undefined, student.student_id))}
                          context={fullNameFromMatrix(student) + ' · все серии'}
                        />
                      </td>
                      <td className="border-b border-border px-2 py-1">
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
                          <td key={series.series_id} className="border-b border-border px-2 py-1">
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
      {error ? <p className="border-t border-border px-3 py-2 text-sm text-danger">{error}</p> : null}
    </div>
  )
}

export function RazborAccessTab({ centerId }: { centerId: number }) {
  const access = useManageRazborAccess(centerId)
  const setAccess = useManageSetRazborAccess(centerId)

  return (
    <div className="flex flex-col gap-4">
        <SectionHeader
          title="Доступ к разборам"
          description="Верхний левый треугольник — письменный разбор, нижний правый — видео. Серые треугольники ещё не опубликованы, но их можно настроить заранее."
        />
        {access.isPending ? <Spinner /> : access.isError || !access.data ? (
          <p className="text-sm text-danger">Не удалось загрузить доступ к разборам.</p>
        ) : (
          <RazborAccessMatrix data={access.data} setAccess={setAccess} />
        )}
    </div>
  )
}

export function StudentsTab({ centerId }: { centerId: number }) {
  const board = useManageRosterBoard(centerId)
  const { data: groups } = useManageGroups(centerId)
  const addStudent = useManageAddStudent(centerId)
  const [picked, setPicked] = useState<UserSearchResult | null>(null)
  const [addGroupId, setAddGroupId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onAdd = () => {
    if (!picked) {
      setError('Выберите пользователя')
      return
    }
    setError(null)
    addStudent.mutate(
      { user_id: picked.id, ...(addGroupId ? { group_id: Number(addGroupId) } : {}) },
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
    <div className="flex flex-col gap-4">
      <RosterBoard board={board} centerId={centerId} />

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-sm font-medium text-text">Добавить из пользователей</p>
        <UserSearchSelect centerId={centerId} onSelect={setPicked} />
        {picked ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-subtle px-3 py-2">
            <span className="text-sm text-text">{fullName(picked)}</span>
            <Select value={addGroupId} onChange={(event) => setAddGroupId(event.target.value)} aria-label="Группа" className="h-9 max-w-40">
              <option value="">Без группы (по умолчанию)</option>
              {(groups ?? []).filter((group) => !isUnallocatedGroup(group.name)).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </Select>
            <Button type="button" variant="secondary" size="sm" onClick={onAdd}>Добавить учеником</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(null)}>Отмена</Button>
          </div>
        ) : null}
      </div>
      <InviteSection centerId={centerId} role="student" />
    </div>
  )
}

type RosterSort = 'alpha' | 'rating-desc' | 'rating-asc'

const rosterNameCollator = new Intl.Collator('ru', { sensitivity: 'base' })
const EMPTY_ROSTER_STUDENTS: ManageRosterBoardStudent[] = []
const EMPTY_ROSTER_GROUPS: ManageRosterBoardGroup[] = []

function rosterStudentName(student: ManageRosterBoardStudent): string {
  return fullName(student)
}

function rosterColumnId(groupId: number | null): string {
  return groupId === null ? 'unallocated' : 'group:' + groupId
}

function rosterGroupId(columnId: string): number | null {
  if (columnId === 'unallocated') return null
  const value = Number(columnId.replace('group:', ''))
  return Number.isFinite(value) && value > 0 ? value : null
}

function rosterSortLabel(sort: RosterSort): string {
  if (sort === 'rating-desc') return 'Рейтинг ↓'
  if (sort === 'rating-asc') return 'Рейтинг ↑'
  return 'А–Я'
}

function RosterBoard({
  board,
  centerId,
}: {
  board: ReturnType<typeof useManageRosterBoard>
  centerId: number
}) {
  const setGroup = useManageSetRosterStudentGroup(centerId)
  const removeStudent = useManageRemoveStudent(centerId)
  const [movingUserId, setMovingUserId] = useState<number | null>(null)
  const [restoreFocusUserId, setRestoreFocusUserId] = useState<number | null>(null)
  const [sort, setSort] = useState<RosterSort>('alpha')
  const [undo, setUndo] = useState<{
    userId: number
    name: string
    fromGroupId: number | null
    toGroupId: number | null
  } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [moveError, setMoveError] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [removalCandidate, setRemovalCandidate] = useState<ManageRosterBoardStudent | null>(null)
  const [activeUserId, setActiveUserId] = useState<number | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  )

  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => setUndo(null), 8000)
    return () => window.clearTimeout(timer)
  }, [undo])

  useEffect(() => {
    if (movingUserId !== null || restoreFocusUserId === null) return
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-roster-card="student:' + restoreFocusUserId + '"]')?.focus()
      setRestoreFocusUserId(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [movingUserId, restoreFocusUserId])

  const students = board.data?.students ?? EMPTY_ROSTER_STUDENTS
  const groups = board.data?.groups ?? EMPTY_ROSTER_GROUPS
  const columns = useMemo(
    () => [{ id: 'unallocated', name: UNALLOCATED_GROUP_NAME }, ...groups.filter((group) => !isUnallocatedGroup(group.name)).map((group) => ({ id: 'group:' + group.id, name: group.name }))],
    [groups],
  )
  const studentsByColumn = useMemo(() => {
    const result = new Map<string, ManageRosterBoardStudent[]>()
    for (const column of columns) result.set(column.id, [])
    const needle = search.trim().toLocaleLowerCase('ru-RU')
    for (const student of students) {
      if (needle && !rosterStudentName(student).toLocaleLowerCase('ru-RU').includes(needle)) continue
      const id = rosterColumnId(student.current_group_id)
      const bucket = result.get(id)
      if (bucket) bucket.push(student)
    }
    return result
  }, [columns, search, students])

  function sortStudents(values: ManageRosterBoardStudent[]): ManageRosterBoardStudent[] {
    return [...values].sort((left, right) => {
      if (sort === 'rating-desc' || sort === 'rating-asc') {
        const difference = left.rating - right.rating
        if (difference !== 0) return sort === 'rating-desc' ? -difference : difference
      }
      return rosterNameCollator.compare(rosterStudentName(left), rosterStudentName(right))
    })
  }

  function announceMove(student: ManageRosterBoardStudent, targetName: string) {
    setAnnouncement(rosterStudentName(student) + ' перемещён в «' + targetName + '».')
  }

  function moveStudent(student: ManageRosterBoardStudent, toGroupId: number | null, targetName: string, isUndo = false) {
    if (movingUserId !== null || student.current_group_id === toGroupId) return
    const fromGroupId = student.current_group_id
    setMoveError(null)
    setMovingUserId(student.user_id)
    setRestoreFocusUserId(student.user_id)
    setGroup.mutate(
      { userId: student.user_id, groupId: toGroupId },
      {
        onSuccess: () => {
          announceMove(student, targetName)
          if (isUndo) {
            setUndo(null)
          } else {
            setUndo({ userId: student.user_id, name: rosterStudentName(student), fromGroupId, toGroupId })
          }
        },
        onError: () => {
          setMoveError('Не удалось изменить группу. Данные обновятся автоматически.')
          setAnnouncement('Перемещение не выполнено для ' + rosterStudentName(student) + '.')
        },
        onSettled: () => setMovingUserId(null),
      },
    )
  }

  function handleDragStart(event: DragStartEvent) {
    const userId = Number(String(event.active.id).replace('student:', ''))
    setActiveUserId(Number.isFinite(userId) ? userId : null)
  }

  function clearActiveDrag() {
    setActiveUserId(null)
  }

  function handleDragEnd(event: DragEndEvent) {
    clearActiveDrag()
    const userId = Number(String(event.active.id).replace('student:', ''))
    const target = event.over ? String(event.over.id) : ''
    const student = students.find((candidate) => candidate.user_id === userId)
    if (target === 'remove') {
      if (student) requestRemoval(student)
      return
    }
    const column = columns.find((candidate) => candidate.id === target)
    if (!student || !column) return
    moveStudent(student, rosterGroupId(column.id), column.name)
  }

  function requestRemoval(student: ManageRosterBoardStudent) {
    setRemoveError(null)
    setRemovalCandidate(student)
  }

  function confirmRemoval() {
    if (!removalCandidate || removeStudent.isPending) return
    removeStudent.mutate(removalCandidate.student_id, {
      onSuccess: () => {
        setAnnouncement(rosterStudentName(removalCandidate) + ' удалён из матцентра.')
        setRemovalCandidate(null)
      },
      onError: () => setRemoveError('Не удалось удалить ученика. Попробуйте ещё раз.'),
    })
  }

  if (board.isPending) return <Spinner />
  if (board.isError || !board.data) return <p className="text-sm text-danger">Не удалось загрузить распределение учеников.</p>

  const ratingTermName = board.data.rating_term.display_name
  const ratingBasis = board.data.published_series_count >= 10
    ? 'текущий период'
    : board.data.previous_term
      ? 'предыдущий период'
      : 'текущий период'

  return (
    <div className="flex flex-col gap-3">
      <SectionHeader
        title="Распределение учеников"
        description={'Перетаскивайте карточки между группами. Рейтинг сейчас основан на показателе «Решено» за ' + ratingTermName + '.'}
      />
      <div className="max-w-sm">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск ученика…"
          aria-label="Поиск ученика по имени"
        />
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        autoScroll={false}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={clearActiveDrag}
      >
        <div data-testid="roster-board-columns" className="flex snap-x snap-mandatory gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex h-[65vh] max-h-[65vh] w-72 min-w-72 snap-start flex-col gap-2 sm:w-80 sm:min-w-80">
            <RemovalDropZone />
            {(() => {
              const column = columns[0]
              const columnStudents = sortStudents(studentsByColumn.get(column.id) ?? [])
              return (
                <RosterColumn
                  id={column.id}
                  name={column.name}
                  students={columnStudents}
                  sort={sort}
                  isUnallocated
                  movingUserId={movingUserId}
                  onSortChange={setSort}
                  onRequestRemoval={requestRemoval}
                  fillHeight
                />
              )
            })()}
          </div>
          {columns.slice(1).map((column) => {
            const columnStudents = sortStudents(studentsByColumn.get(column.id) ?? [])
            return (
              <RosterColumn
                key={column.id}
                id={column.id}
                name={column.name}
                students={columnStudents}
                sort={sort}
                isUnallocated={column.id === 'unallocated'}
                movingUserId={movingUserId}
                onSortChange={setSort}
                onRequestRemoval={requestRemoval}
              />
            )
          })}
        </div>
        {createPortal(
          <DragOverlay modifiers={[snapCenterToCursor]} dropAnimation={null}>
            {activeUserId === null ? null : (() => {
              const student = students.find((candidate) => candidate.user_id === activeUserId)
              return student ? <RosterStudentCardPreview student={student} /> : null
            })()}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>Основание рейтинга: {ratingBasis}</span>
        <span>{board.data.published_series_count} опубликованных серий в текущем периоде</span>
        <span>Сортировка всех колонок: {rosterSortLabel(sort)}</span>
      </div>
      {undo ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-selected-border/30 bg-selected px-3 py-2 text-sm text-selected-text" role="status">
          <span>{undo.name} перемещён.</span>
          <button
            type="button"
            className="font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            onClick={() => {
              const student = students.find((candidate) => candidate.user_id === undo.userId)
              if (student) moveStudent(student, undo.fromGroupId, undo.fromGroupId === null ? UNALLOCATED_GROUP_NAME : (groups.find((group) => group.id === undo.fromGroupId)?.name ?? 'группу'), true)
            }}
          >
            Отменить
          </button>
        </div>
      ) : null}
      {moveError ? <p className="text-sm text-danger">{moveError}</p> : null}
      <Dialog open={removalCandidate !== null} onOpenChange={(open) => {
        if (!open && !removeStudent.isPending) setRemovalCandidate(null)
      }}>
        <DialogContent>
          <DialogTitle>Удалить ученика из матцентра?</DialogTitle>
          <DialogDescription className="mt-2">
            {removalCandidate ? rosterStudentName(removalCandidate) + ' будет удалён только из текущего периода. История прошлых периодов и домашние работы сохранятся.' : null}
          </DialogDescription>
          {removeError ? <p className="mt-3 text-sm text-danger">{removeError}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setRemovalCandidate(null)} disabled={removeStudent.isPending}>Отмена</Button>
            <Button type="button" variant="danger" onClick={confirmRemoval} disabled={removeStudent.isPending}>Удалить</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RemovalDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: 'remove' })
  return (
    <div
      ref={setNodeRef}
      role="region"
      aria-label="Удалить ученика"
      className={cn(
        'flex min-h-20 shrink-0 items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs font-medium text-danger transition-colors',
        isOver ? 'border-danger bg-danger/10' : 'border-danger/50',
      )}
    >
      <Trash2 className="h-4 w-4" aria-hidden="true" />
      Перетащите сюда, чтобы удалить
    </div>
  )
}

function RosterColumn({
  id,
  name,
  students,
  sort,
  isUnallocated,
  movingUserId,
  onSortChange,
  onRequestRemoval,
  fillHeight = false,
}: {
  id: string
  name: string
  students: ManageRosterBoardStudent[]
  sort: RosterSort
  isUnallocated: boolean
  movingUserId: number | null
  onSortChange: (sort: RosterSort) => void
  onRequestRemoval: (student: ManageRosterBoardStudent) => void
  fillHeight?: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  const nextSort: RosterSort = sort === 'alpha' ? 'rating-desc' : sort === 'rating-desc' ? 'rating-asc' : 'alpha'
  return (
    <section
      ref={setNodeRef}
      className={cn(
        'flex w-72 min-w-72 snap-start flex-col overflow-hidden rounded-lg border bg-surface p-3 transition-colors sm:w-80 sm:min-w-80',
        fillHeight ? 'min-h-0 flex-1' : 'h-[65vh] max-h-[65vh]',
        isUnallocated ? 'border-dashed border-border-control' : 'border-border',
        isOver && 'border-selected-border bg-selected/50',
      )}
      aria-label={name + ', ' + students.length + ' учеников'}
    >
      <div className="mb-3 flex items-start gap-2 border-b border-border pb-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-text">{name}</h3>
          <p className="font-mono text-xs text-muted">{students.length} учеников</p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md px-1.5 py-1 text-[0.68rem] font-medium text-muted hover:bg-surface-subtle hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          aria-label={'Сортировка колонки ' + name + ': ' + rosterSortLabel(sort)}
          onClick={() => onSortChange(nextSort)}
        >
          {rosterSortLabel(sort)}
        </button>
      </div>
      <div
        role="group"
        aria-label={name + ' список учеников'}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {students.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-text-subtle">Перетащите сюда ученика</p> : null}
        {students.map((student) => (
          <RosterStudentCard
            key={student.user_id}
            student={student}
            isMoving={movingUserId === student.user_id}
            onRequestRemoval={onRequestRemoval}
          />
        ))}
      </div>
    </section>
  )
}

function RosterStudentCard({
  student,
  isMoving = false,
  onRequestRemoval,
}: {
  student: ManageRosterBoardStudent
  isMoving?: boolean
  onRequestRemoval: (student: ManageRosterBoardStudent) => void
}) {
  const { search } = useLocation()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: 'student:' + student.user_id })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
  return (
    <Link
      ref={setNodeRef}
      to={'../students/' + student.user_id + search}
      data-roster-card={'student:' + student.user_id}
      style={style}
      {...listeners}
      {...attributes}
      role="link"
      draggable={false}
      tabIndex={0}
      onKeyDown={(event) => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && !isMoving) {
          event.preventDefault()
          onRequestRemoval(student)
        }
      }}
      aria-label={rosterStudentName(student) + '. Открыть профиль. Нажмите Delete, чтобы удалить из матцентра.'}
      className={cn(
        'rounded-lg border border-border bg-surface-subtle px-3 py-2 shadow-sm transition-opacity',
        'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-0',
        isMoving && !isDragging && 'opacity-60',
      )}
    >
      <RosterStudentCardBody student={student} />
    </Link>
  )
}

function RosterStudentCardPreview({ student }: { student: ManageRosterBoardStudent }) {
  return (
    <article className="w-full cursor-grabbing rounded-lg border border-border bg-surface-subtle px-3 py-2 shadow-sm">
      <RosterStudentCardBody student={student} />
    </article>
  )
}

function RosterStudentCardBody({ student }: { student: ManageRosterBoardStudent }) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <StudentNameLabel
          name={rosterStudentName(student)}
          backgroundHex={student.background_hex}
          className="truncate text-sm font-medium"
        />
        <p className="truncate text-xs text-muted">
          {student.previous_group_name
            ? 'Предыдущая группа: ' + student.previous_group_name
            : student.previous_term_enrolled
              ? 'Не распределён в прошлом периоде'
              : 'Новый ученик'}
        </p>
      </div>
      <span className="shrink-0 rounded-md bg-surface px-1.5 py-0.5 font-mono text-xs text-selected-text" title="Рейтинг">
        {Number.isInteger(student.rating) ? student.rating : student.rating.toFixed(1)}
      </span>
    </div>
  )
}
