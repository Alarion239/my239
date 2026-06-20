import { useState } from 'react'
import {
  APIErrorImpl,
  claimIsLive,
  useClaimThread,
  useGradeThread,
  useReleaseClaim,
  useRetractGrade,
  useSubmitAttempt,
  userNameFromThread,
  type ThreadView,
} from '@my239/shared'
import { Button, Card, Textarea } from '../../design/ui'
import { SubmissionForm } from './submission-form'
import type { ThreadRole } from './use-thread-role'

export interface ThreadActionPanelProps {
  thread: ThreadView
  role: ThreadRole
  userId: number
  // Whether the series deadline has passed (hides the student submit form).
  closed: boolean
}

// ThreadActionPanel renders the one action available to the viewer given the
// thread's state and their role. Mirrors the backend's transition rules so the
// UI never offers an action the server would reject.
export function ThreadActionPanel({
  thread,
  role,
  userId,
  closed,
}: ThreadActionPanelProps) {
  if (role === 'student') {
    return <StudentActions thread={thread} closed={closed} />
  }
  if (role === 'teacher' || role === 'admin') {
    return <GraderActions thread={thread} role={role} userId={userId} />
  }
  return null
}

function StudentActions({
  thread,
  closed,
}: {
  thread: ThreadView
  closed: boolean
}) {
  const submit = useSubmitAttempt(thread.subproblem_id)

  // After the deadline the student can still appeal (inline in the timeline)
  // but can no longer send a new attempt — the form is removed entirely.
  if (closed) return null
  const status = thread.current_status
  if (status !== 'ungraded' && status !== 'rejected') return null

  return (
    <Card className="p-4">
      <h3 className="mb-3 font-display text-lg font-medium text-ink">
        {status === 'rejected' ? 'Отправить новое решение' : 'Отправить решение'}
      </h3>
      <SubmissionForm
        presignKind="student"
        presignId={thread.subproblem_id}
        submitLabel="Отправить решение"
        bodyPlaceholder="Комментарий к решению (необязательно)…"
        onFinalize={(args) =>
          submit.mutateAsync({
            event_uuid: args.event_uuid,
            body: args.body,
            object_keys: args.object_keys,
          })
        }
      />
    </Card>
  )
}

function GraderActions({
  thread,
  role,
  userId,
}: {
  thread: ThreadView
  role: ThreadRole
  userId: number
}) {
  const claim = useClaimThread(thread.id)
  const grade = useGradeThread(thread.id)
  const release = useReleaseClaim(thread.id)

  const live = claimIsLive(thread)
  const heldByMe = live && thread.claim_holder_user_id === userId
  const status = thread.current_status
  const gradable = status === 'submitted' || status === 'appealed'
  const canClaim = gradable && !live
  const canGrade = gradable && heldByMe
  const canRetract =
    (status === 'accepted' || status === 'rejected') &&
    (role === 'admin' || thread.last_grader_user_id === userId)

  return (
    <div className="flex flex-col gap-3">
      {canClaim ? (
        <Card className="p-4">
          <Button
            type="button"
            onClick={() => claim.mutate()}
            disabled={claim.isPending}
          >
            {claim.isPending ? 'Занимаем…' : 'Взять в проверку'}
          </Button>
          <p className="mt-2 text-xs text-muted">
            Лок на 15 минут с автопродлением.
          </p>
          {claim.isError ? (
            <p className="mt-2 text-sm text-danger" role="alert">
              {claim.error instanceof APIErrorImpl
                ? claim.error.message
                : 'Не удалось занять задачу'}
            </p>
          ) : null}
        </Card>
      ) : null}

      {canGrade ? (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-lg font-medium text-ink">
              Поставить оценку
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => release.mutate()}
              disabled={release.isPending}
              title="Снять задачу с проверки, вернуть в очередь"
            >
              {release.isPending ? 'Освобождаем…' : 'Освободить'}
            </Button>
          </div>
          <SubmissionForm
            presignKind="grader"
            presignId={thread.id}
            showVerdict
            bodyRequired
            submitLabel="Сохранить оценку"
            bodyPlaceholder="Что верно / что не так?"
            onFinalize={(args) => {
              if (!args.verdict) return Promise.resolve()
              return grade.mutateAsync({
                verdict: args.verdict,
                body: args.body,
                event_uuid: args.event_uuid,
                object_keys: args.object_keys,
              })
            }}
          />
        </Card>
      ) : null}

      {live && !heldByMe ? (
        <Card className="p-4">
          <p className="text-sm text-muted">
            Сейчас задачу проверяет:{' '}
            {userNameFromThread(thread, thread.claim_holder_user_id)}.
          </p>
        </Card>
      ) : null}

      {canRetract ? (
        <Card className="p-4">
          <RetractPanel threadId={thread.id} />
        </Card>
      ) : null}
    </div>
  )
}

function RetractPanel({ threadId }: { threadId: number }) {
  const retract = useRetractGrade(threadId)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    try {
      await retract.mutateAsync(reason.trim())
      setReason('')
    } catch (e) {
      setError(e instanceof APIErrorImpl ? e.message : 'Не удалось отозвать')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs italic text-muted">
        Отозвать оценку (вернёт задачу к предыдущему состоянию)
      </p>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <Textarea
        aria-label="Причина отзыва"
        placeholder="Причина (необязательно)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="min-h-16"
      />
      <Button
        type="button"
        variant="danger"
        onClick={submit}
        disabled={retract.isPending}
        className="self-start"
      >
        {retract.isPending ? 'Отзываем…' : 'Отозвать оценку'}
      </Button>
    </div>
  )
}
