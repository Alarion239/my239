import { useState } from 'react'
import {
  APIErrorImpl,
  eventKindLabel,
  formatDateTime,
  newEventUUID,
  useAppealGrade,
  userNameFromThread,
  type EventKind,
  type EventView,
  type ThreadView,
  type Verdict,
} from '@my239/shared'
import { Button, Textarea } from '../../design/ui'
import { cn } from '../../design/cn'

export interface ThreadTimelineProps {
  thread: ThreadView
  // The viewing user — actor === viewer renders as "Вы".
  viewerUserId: number
  // Whether the viewer is the owning student (gates the inline appeal box).
  isStudent: boolean
}

// accentClasses maps an event to its left-border + heading colour. submitted →
// accent (teal); accepted/rejected/appeal → status tokens; retracted → muted.
function accentClasses(kind: EventKind, verdict?: Verdict | null): {
  border: string
  text: string
} {
  switch (kind) {
    case 'graded':
      return verdict === 'accepted'
        ? { border: 'border-status-accepted', text: 'text-status-accepted' }
        : { border: 'border-status-rejected', text: 'text-status-rejected' }
    case 'appealed':
      return { border: 'border-status-appeal', text: 'text-status-appeal' }
    case 'retracted':
      return { border: 'border-line-strong', text: 'text-muted' }
    case 'submitted':
    default:
      return { border: 'border-accent', text: 'text-accent' }
  }
}

// ThreadTimeline renders the event log as a "Диалог": one card per event with a
// colour-coded left border, plus the inline appeal box under the latest
// rejection when the owning student may appeal.
export function ThreadTimeline({
  thread,
  viewerUserId,
  isStudent,
}: ThreadTimelineProps) {
  const events = thread.events
  if (events.length === 0) {
    return (
      <p className="py-2 text-sm text-muted">Пока ничего не отправлено.</p>
    )
  }

  // The appeal box attaches to the most recent rejection so it reads inline.
  // Appeals stay allowed after the deadline — it's a re-read request, not a new
  // attempt.
  const lastRejectionId = (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i]
      if (ev.kind === 'graded' && ev.verdict === 'rejected') return ev.id
    }
    return -1
  })()
  const canAppeal = isStudent && thread.current_status === 'rejected'

  return (
    <div className="flex flex-col gap-3">
      {events.map((ev) => (
        <div key={ev.id}>
          <EventCard
            event={ev}
            thread={thread}
            viewerUserId={viewerUserId}
          />
          {canAppeal && ev.id === lastRejectionId ? (
            <InlineAppeal subproblemId={thread.subproblem_id} />
          ) : null}
        </div>
      ))}
    </div>
  )
}

function EventCard({
  event,
  thread,
  viewerUserId,
}: {
  event: EventView
  thread: ThreadView
  viewerUserId: number
}) {
  const accent = accentClasses(event.kind, event.verdict)
  const actorName =
    event.actor_user_id === viewerUserId
      ? 'Вы'
      : userNameFromThread(thread, event.actor_user_id)
  return (
    <div className={cn('border-l-2 pl-3', accent.border)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className={cn('text-sm font-medium', accent.text)}>
          {eventKindLabel(event.kind, event.verdict)}
        </span>
        <span className="text-xs text-faint">
          {actorName} · {formatDateTime(event.created_at)}
        </span>
      </div>
      {event.body ? (
        <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
          {event.body}
        </p>
      ) : null}
      {event.photos.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {event.photos.map((p) => (
            <a
              key={p.object_key}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-md border border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <img
                src={p.url}
                alt="Вложение"
                className="h-24 w-24 bg-surface-muted object-cover"
              />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// InlineAppeal is the text-only re-read request attached to a rejection. No
// photos by design — it asks the grader to look again at the current attempt.
function InlineAppeal({ subproblemId }: { subproblemId: number }) {
  const appeal = useAppealGrade(subproblemId)
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    if (body.trim() === '') {
      setError('Опишите, что нужно перепроверить.')
      return
    }
    try {
      await appeal.mutateAsync({
        event_uuid: newEventUUID(),
        body: body.trim(),
        object_keys: [],
      })
      setBody('')
    } catch (e) {
      setError(e instanceof APIErrorImpl ? e.message : 'Не удалось отправить')
    }
  }

  return (
    <div className="mt-2 ml-3 flex flex-col gap-2 rounded-lg border border-status-appeal/30 bg-status-appeal-soft p-3">
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-xs italic text-muted">
        Подать апелляцию (без новых фото — запрос на пересмотр текущей попытки)
      </p>
      <Textarea
        aria-label="Текст апелляции"
        placeholder="Что нужно перепроверить?"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="min-h-16 bg-surface"
      />
      <Button
        type="button"
        size="sm"
        onClick={submit}
        disabled={appeal.isPending}
        className="self-start"
      >
        {appeal.isPending ? 'Отправляем…' : 'Отправить апелляцию'}
      </Button>
    </div>
  )
}
