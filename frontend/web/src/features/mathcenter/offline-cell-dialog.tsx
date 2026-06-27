import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  initialsOf,
  useCreateThreadNote,
  useOfflineAccept,
  useOfflineUndo,
  useThreadNotes,
  type HomeworkStatus,
} from '@my239/shared'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Spinner,
  Textarea,
} from '../../design/ui'
import { GraderInitialsInput, emptyGrader, type CreditedGrader } from './grader-initials-input'

export interface OfflineCellTarget {
  studentUserId: number
  studentName: string
  subproblemId: number
  columnLabel: string
  threadId: number
  status: HomeworkStatus
  lastGraderName?: string
  // Pre-rendered initials for an accepted cell (from the grid's grader map or
  // last_grader_name), shown on the undo button.
  acceptedInitials?: string
  // Link to the full submission thread, when one exists.
  threadHref?: string
}

// OfflineCellDialog is the «Кондуит» Option-B popup: it marks a (student,
// subproblem) solved in person / undoes that, and carries an internal teacher
// comment box + a link to the full thread. `mode` picks attribution: 'conduit'
// asks for the credited grader's initials; 'self' credits the authenticated
// teacher (the phone flow) with no extra input.
export function OfflineCellDialog({
  open,
  onOpenChange,
  centerId,
  mode,
  target,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  centerId: number
  mode: 'conduit' | 'self'
  target: OfflineCellTarget
}) {
  const [grader, setGrader] = useState<CreditedGrader>(emptyGrader)
  const [status, setStatus] = useState<HomeworkStatus>(target.status)
  const [threadId, setThreadId] = useState(target.threadId)
  const [comment, setComment] = useState('')

  // Reset transient state whenever the dialog (re)opens onto a cell.
  useEffect(() => {
    if (open) {
      setStatus(target.status)
      setThreadId(target.threadId)
      setGrader(emptyGrader)
      setComment('')
    }
  }, [open, target.status, target.threadId])

  const accept = useOfflineAccept()
  const undo = useOfflineUndo()
  const notes = useThreadNotes(threadId, open && threadId > 0)
  const createNote = useCreateThreadNote(threadId)

  const accepted = status === 'accepted'
  const canAccept = mode === 'self' || grader.name.trim().length > 0
  const acceptedInitials =
    target.acceptedInitials ||
    (target.lastGraderName ? initialsOf(target.lastGraderName) : '✓')

  function doAccept() {
    accept.mutate(
      {
        student_user_id: target.studentUserId,
        subproblem_id: target.subproblemId,
        ...(mode === 'conduit' && grader.userId != null
          ? { grader_user_id: grader.userId }
          : {}),
        ...(mode === 'conduit' && grader.userId == null
          ? { grader_name: grader.name.trim() }
          : {}),
      },
      {
        onSuccess: (thread) => {
          setStatus(thread.current_status)
          setThreadId(thread.id)
        },
      },
    )
  }

  function doUndo() {
    undo.mutate(
      { student_user_id: target.studentUserId, subproblem_id: target.subproblemId },
      { onSuccess: (thread) => setStatus(thread.current_status) },
    )
  }

  function saveComment() {
    const body = comment.trim()
    if (!body || threadId <= 0) return
    createNote.mutate(body, { onSuccess: () => setComment('') })
  }

  const mutationError = accept.error || undo.error || createNote.error

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4">
        <DialogTitle>
          {target.studentName} · {target.columnLabel}
        </DialogTitle>

        {/* Mark / undo */}
        {accepted ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-status-accepted/30 bg-status-accepted-soft px-3 py-2">
            <span className="text-sm font-medium text-status-accepted">
              Решено · {acceptedInitials}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={doUndo}
              disabled={undo.isPending}
            >
              Отменить
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {mode === 'conduit' ? (
              <GraderInitialsInput centerId={centerId} value={grader} onChange={setGrader} autoFocus />
            ) : null}
            <Button onClick={doAccept} disabled={!canAccept || accept.isPending}>
              ✓ Отметить решённым
            </Button>
          </div>
        )}

        {mutationError ? (
          <p className="text-sm text-danger">{mutationError.message}</p>
        ) : null}

        {/* Internal comment — only once a thread exists. */}
        {threadId > 0 ? (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              Внутренняя заметка
            </p>
            {notes.data && notes.data.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {notes.data.map((n) => (
                  <li key={n.id} className="text-sm">
                    <span className="font-semibold text-ink">{n.author_name}</span>
                    <p className="whitespace-pre-wrap break-words text-ink">{n.body}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Заметка для преподавателей (не видна ученику)…"
              rows={2}
            />
            <div className="flex items-center justify-between gap-2">
              {target.threadHref ? (
                <Link
                  to={target.threadHref}
                  className="text-sm text-accent underline-offset-2 hover:underline"
                >
                  → Открыть проверку
                </Link>
              ) : (
                <span />
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={saveComment}
                disabled={!comment.trim() || createNote.isPending}
              >
                Сохранить
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted">
            Отметьте решение, чтобы оставить заметку.
          </p>
        )}

        {notes.isLoading ? <Spinner /> : null}
      </DialogContent>
    </Dialog>
  )
}
