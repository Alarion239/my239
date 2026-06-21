import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown } from 'lucide-react'
import {
  claimIsLive,
  displayStatusMeta,
  formatDateTime,
  isClosed,
  submissionClosedFor,
  useSeries,
  useSubmitAttempt,
  useSubproblemContext,
  useThread,
  userNameFromThread,
  type SubproblemContext,
  type ThreadView,
} from '@my239/shared'
import { Card, Spinner } from '../../design/ui'
import { cn } from '../../design/cn'
import { statusPillClasses } from './status-style'
import { StatementPanel } from './statement-panel'
import { SubmissionForm } from './submission-form'
import { ThreadTimeline } from './thread-timeline'
import { ThreadActionPanel } from './thread-action-panel'
import { useClaimHeartbeat } from './use-claim-heartbeat'
import { useThreadRole } from './use-thread-role'
import { useSeriesContext } from './use-series-context'

function seriesPath(centerId: number): string {
  return '/mathcenter/' + centerId
}

function threadPath(
  centerId: number,
  seriesId: number,
  threadId: number,
): string {
  return (
    '/mathcenter/' + centerId + '/series/' + seriesId + '/thread/' + threadId
  )
}

function taskTitle(ctx: SubproblemContext | undefined): string {
  if (!ctx) return 'Задача'
  return ctx.subproblem_label
    ? ctx.problem_display + ' (' + ctx.subproblem_label + ')'
    : ctx.problem_display
}

// ThreadPage is the full-page submission/grading "dialogue". It serves two
// routes: an existing thread (/thread/:threadId) and a first submission
// (/submit/:subproblemId, no thread yet). Re-keyed by the route so state resets
// cleanly across navigations (including submit → thread after the first send).
export function ThreadPage() {
  const params = useParams<{
    centerId: string
    seriesId: string
    threadId?: string
    subproblemId?: string
  }>()
  const key =
    (params.threadId ? 't:' + params.threadId : 'n:' + params.subproblemId) +
    '@' +
    params.centerId
  return <ThreadPageInner key={key} />
}

function ThreadPageInner() {
  const params = useParams<{
    centerId: string
    seriesId: string
    threadId?: string
    subproblemId?: string
  }>()
  const centerId = Number(params.centerId)
  const seriesId = Number(params.seriesId)
  const threadId = params.threadId ? Number(params.threadId) : 0
  const subproblemId = params.subproblemId ? Number(params.subproblemId) : 0
  const isThreadMode = threadId > 0

  const ctx = useSeriesContext(centerId)

  if (!Number.isFinite(centerId) || centerId <= 0) {
    return <NotFound centerId={centerId} />
  }
  if (ctx.isLoading) {
    return <CenteredSpinner />
  }
  if (!ctx.hasAccess) {
    return <NotFound centerId={centerId} />
  }

  return (
    <div className="animate-rise mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link
        to={seriesPath(centerId)}
        className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-accent underline-offset-4 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Назад к серии
      </Link>

      {isThreadMode ? (
        <ThreadMode
          centerId={centerId}
          seriesId={seriesId}
          threadId={threadId}
        />
      ) : (
        <SubmitMode
          centerId={centerId}
          seriesId={seriesId}
          subproblemId={subproblemId}
        />
      )}
    </div>
  )
}

function ThreadMode({
  centerId,
  seriesId,
  threadId,
}: {
  centerId: number
  seriesId: number
  threadId: number
}) {
  const { data: thread, isPending, isError, error } = useThread(threadId)
  const ctx = useSubproblemContext(thread?.subproblem_id ?? 0)
  const roleInfo = useThreadRole(centerId, thread?.student_user_id)
  const isGrader = roleInfo.role === 'teacher' || roleInfo.role === 'admin'
  useClaimHeartbeat(thread ?? null, isGrader, roleInfo.userId)

  if (isPending) return <CenteredSpinner />
  if (isError || !thread) {
    return (
      <Card className="px-6 py-10 text-center">
        <p className="text-sm text-danger">
          {error instanceof Error ? error.message : 'Не удалось загрузить задачу'}
        </p>
      </Card>
    )
  }

  // Coffin-aware: a marked-open coffin stays submittable past the deadline.
  const closed = ctx.data
    ? submissionClosedFor(ctx.data)
    : isClosed(thread.series_due_at)
  return (
    <>
      <ThreadHeader thread={thread} ctx={ctx.data} userId={roleInfo.userId} />
      <Statement seriesId={seriesId} />
      <Card className="p-5">
        <h2 className="mb-3 font-display text-lg font-medium text-ink">Диалог</h2>
        <ThreadTimeline
          thread={thread}
          viewerUserId={roleInfo.userId}
          isStudent={roleInfo.role === 'student'}
        />
      </Card>
      <ThreadActionPanel
        thread={thread}
        role={roleInfo.role}
        userId={roleInfo.userId}
        closed={closed}
      />
    </>
  )
}

function SubmitMode({
  centerId,
  seriesId,
  subproblemId,
}: {
  centerId: number
  seriesId: number
  subproblemId: number
}) {
  const navigate = useNavigate()
  const { data: ctx, isPending, isError } = useSubproblemContext(subproblemId)
  const roleInfo = useThreadRole(centerId)
  const submit = useSubmitAttempt(subproblemId)

  if (isPending) return <CenteredSpinner />
  if (isError || !ctx) {
    return (
      <Card className="px-6 py-10 text-center">
        <p className="text-sm text-danger">Не удалось загрузить задачу.</p>
      </Card>
    )
  }

  const closed = submissionClosedFor(ctx)
  return (
    <>
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-xl font-medium text-ink">
            {taskTitle(ctx)}
          </h1>
        </div>
        <p className="mt-1 text-xs text-muted">
          Срок: {formatDateTime(ctx.series_due_at)}
        </p>
      </Card>
      <Statement seriesId={seriesId} />
      {closed ? (
        <Card className="px-6 py-10 text-center">
          <p className="text-sm text-muted">
            Серия закрыта — отправка новых решений недоступна.
          </p>
        </Card>
      ) : roleInfo.role === 'student' ? (
        <Card className="p-4">
          <h3 className="mb-3 font-display text-lg font-medium text-ink">
            Отправить решение
          </h3>
          <SubmissionForm
            presignKind="student"
            presignId={subproblemId}
            submitLabel="Отправить решение"
            bodyPlaceholder="Комментарий к решению (необязательно)…"
            onFinalize={async (args) => {
              const t = await submit.mutateAsync({
                event_uuid: args.event_uuid,
                body: args.body,
                object_keys: args.object_keys,
              })
              navigate(threadPath(centerId, seriesId, t.id), { replace: true })
            }}
          />
        </Card>
      ) : (
        <Card className="px-6 py-10 text-center">
          <p className="text-sm text-muted">
            Решение может отправить только ученик.
          </p>
        </Card>
      )}
    </>
  )
}

function ThreadHeader({
  thread,
  ctx,
  userId,
}: {
  thread: ThreadView
  ctx: SubproblemContext | undefined
  userId: number
}) {
  const live = claimIsLive(thread)
  const meta = displayStatusMeta(thread.current_status, live)
  const claimedByMe = live && thread.claim_holder_user_id === userId
  const claimedByOther = live && thread.claim_holder_user_id !== userId
  return (
    <Card className={cn('p-5', claimedByMe && 'ring-2 ring-accent')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-xl font-medium text-ink">
            {taskTitle(ctx)}
          </h1>
          {claimedByMe ? (
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-white">
              На вашей проверке
            </span>
          ) : null}
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-xs font-medium',
            statusPillClasses(meta.tone),
          )}
        >
          {meta.label}
        </span>
      </div>
      {claimedByMe && thread.claim_expires_at ? (
        <p className="mt-2 text-xs text-muted">
          Вы проверяете эту задачу — лок до{' '}
          {formatDateTime(thread.claim_expires_at)}
        </p>
      ) : claimedByOther ? (
        <p className="mt-2 text-xs text-muted">
          Проверяет: {userNameFromThread(thread, thread.claim_holder_user_id)}
          {thread.claim_expires_at
            ? ' (до ' + formatDateTime(thread.claim_expires_at) + ')'
            : ''}
        </p>
      ) : null}
    </Card>
  )
}

// Statement is the collapsible "Условие" disclosure, reusing StatementPanel.
function Statement({ seriesId }: { seriesId: number }) {
  const [open, setOpen] = useState(false)
  const { data: series } = useSeries(seriesId)
  if (!series || (!series.has_tex && !series.has_pdf)) return null
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-sm font-medium text-ink hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span>Условие задачи</span>
        <ChevronDown
          className={cn('h-4 w-4 text-muted transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {open ? (
        <StatementPanel series={series} className="rounded-none border-0 border-t border-line" />
      ) : null}
    </Card>
  )
}

function CenteredSpinner() {
  return (
    <div className="flex justify-center py-16">
      <Spinner />
    </div>
  )
}

function NotFound({ centerId }: { centerId: number }) {
  return (
    <Card className="animate-rise px-6 py-16 text-center">
      <p className="text-muted">Нет доступа к этой задаче.</p>
      {Number.isFinite(centerId) && centerId > 0 ? (
        <Link
          to={seriesPath(centerId)}
          className="mt-2 inline-block text-sm font-medium text-accent underline-offset-4 hover:underline"
        >
          Назад к серии
        </Link>
      ) : null}
    </Card>
  )
}
