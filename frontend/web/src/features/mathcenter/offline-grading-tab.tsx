import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  initialsOf,
  useOfflineAccept,
  useTeacherGrid,
  type GridCell,
  type GridColumn,
  type GridStudent,
} from '@my239/shared'
import { Card, Input, Spinner } from '../../design/ui'
import { cn } from '../../design/cn'
import { OfflineCellDialog, type OfflineCellTarget } from './offline-cell-dialog'

// columnLabelFor renders a compact chip label from a series GridColumn:
// "Задача 3" → "3", with the subpart letter appended ("3a"); the exercise
// (problem 0) reads "Упр".
function columnLabelFor(col: GridColumn): string {
  const base = col.problem_number === 0 ? 'Упр' : String(col.problem_number)
  const sub = col.subproblem_label.trim()
  if (!sub) return base
  return col.problem_number === 0 ? base + ' ' + sub : base + sub
}

// OfflineGradingTab is the phone flow: a teacher picks/searches a student, then
// taps that student's subproblems to mark the ones they explained in person.
// Marks are credited to the authenticated teacher; an accepted chip opens the
// dialog to undo or leave an internal note.
export function OfflineGradingTab({
  centerId,
  seriesId,
}: {
  centerId: number
  seriesId: number
}) {
  const { data, isPending, isError } = useTeacherGrid(seriesId)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  if (isPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }
  if (isError || !data) {
    return <p className="py-8 text-sm text-danger">Не удалось загрузить список.</p>
  }
  if (data.students.length === 0) {
    return (
      <Card className="px-6 py-12 text-center">
        <p className="text-muted">В этой серии пока нет учеников.</p>
      </Card>
    )
  }

  const selected = data.students.find((s) => s.student_user_id === selectedId)
  if (selected) {
    return (
      <StudentOfflineGrader
        centerId={centerId}
        seriesId={seriesId}
        columns={data.columns}
        student={selected}
        onBack={() => setSelectedId(null)}
      />
    )
  }
  return (
    <StudentPicker students={data.students} onPick={(id) => setSelectedId(id)} />
  )
}

// StudentPicker is the searchable roster; each row shows the student's solved
// count so a grader can spot who still needs marking.
function StudentPicker({
  students,
  onPick,
}: {
  students: GridStudent[]
  onPick: (studentUserId: number) => void
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return students
    return students.filter((s) => s.student_name.toLowerCase().includes(q))
  }, [students, query])

  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск ученика…"
        aria-label="Поиск ученика"
      />
      <ul className="overflow-hidden rounded-xl border border-line">
        {filtered.map((s) => {
          const total = s.cells.length
          const solved = s.cells.filter((c) => c.current_status === 'accepted').length
          return (
            <li key={s.student_user_id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => onPick(s.student_user_id)}
                className="flex w-full items-center justify-between gap-3 bg-surface px-4 py-3 text-left hover:bg-surface-muted"
              >
                <span className="text-ink">{s.student_name}</span>
                <span className="text-sm tabular-nums text-muted">
                  {solved}/{total}
                </span>
              </button>
            </li>
          )
        })}
        {filtered.length === 0 ? (
          <li className="px-4 py-3 text-sm text-muted">Никого не найдено.</li>
        ) : null}
      </ul>
    </div>
  )
}

// StudentOfflineGrader shows one student's subproblem chips. Tapping an
// un-accepted chip marks it solved (credited to the logged-in teacher); tapping
// an accepted chip opens the dialog to undo or comment.
function StudentOfflineGrader({
  centerId,
  seriesId,
  columns,
  student,
  onBack,
}: {
  centerId: number
  seriesId: number
  columns: GridColumn[]
  student: GridStudent
  onBack: () => void
}) {
  const { year } = useParams<{ year: string }>()
  const accept = useOfflineAccept()
  const [pendingSub, setPendingSub] = useState<number | null>(null)
  const [dialog, setDialog] = useState<OfflineCellTarget | null>(null)

  // Cells keyed by subproblem for O(1) lookup as we iterate columns.
  const cellBySub = useMemo(() => {
    const m = new Map<number, GridCell>()
    for (const c of student.cells) m.set(c.subproblem_id, c)
    return m
  }, [student.cells])

  function markSolved(subproblemId: number) {
    setPendingSub(subproblemId)
    accept.mutate(
      { student_user_id: student.student_user_id, subproblem_id: subproblemId },
      { onSettled: () => setPendingSub(null) },
    )
  }

  function openDialog(col: GridColumn, cell: GridCell | undefined) {
    setDialog({
      studentUserId: student.student_user_id,
      studentName: student.student_name,
      subproblemId: col.subproblem_id,
      columnLabel: columnLabelFor(col),
      threadId: cell?.thread_id ?? 0,
      status: cell?.current_status ?? 'ungraded',
      lastGraderName: cell?.last_grader_name,
      threadHref:
        cell && cell.thread_id > 0
          ? '/mathcenter/' + (year ?? '') + '/series/' + seriesId + '/thread/' + cell.thread_id
          : undefined,
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface-muted hover:text-ink"
        >
          ← Ученики
        </button>
        <h3 className="font-display text-lg font-medium text-ink">{student.student_name}</h3>
      </div>
      <p className="text-sm text-muted">
        Нажмите на задачу, чтобы отметить её решённой очно. Зелёную — чтобы отменить или оставить заметку.
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {columns.map((col) => {
          const cell = cellBySub.get(col.subproblem_id)
          const accepted = cell?.current_status === 'accepted'
          const pending = pendingSub === col.subproblem_id
          const initials = accepted
            ? cell?.last_grader_name
              ? initialsOf(cell.last_grader_name)
              : '✓'
            : ''
          return (
            <button
              key={col.subproblem_id}
              type="button"
              disabled={pending}
              onClick={() => (accepted ? openDialog(col, cell) : markSolved(col.subproblem_id))}
              className={cn(
                'flex h-16 flex-col items-center justify-center gap-0.5 rounded-xl border text-sm transition-colors disabled:opacity-50',
                accepted
                  ? 'border-status-accepted/30 bg-status-accepted-soft text-status-accepted'
                  : 'border-line bg-surface text-muted hover:bg-surface-muted',
              )}
            >
              <span className="font-medium">{columnLabelFor(col)}</span>
              <span className="text-xs">{pending ? '…' : accepted ? initials : '＋'}</span>
            </button>
          )
        })}
      </div>
      {accept.error ? (
        <p className="text-sm text-danger">{accept.error.message}</p>
      ) : null}

      {dialog ? (
        <OfflineCellDialog
          open={dialog != null}
          onOpenChange={(o) => !o && setDialog(null)}
          centerId={centerId}
          mode="self"
          target={dialog}
        />
      ) : null}
    </div>
  )
}
