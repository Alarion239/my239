import { useState } from 'react'
import { Lock, Pencil, Trash2 } from 'lucide-react'
import { formatDateTime, type InternalNote } from '@my239/shared'
import { Button, Spinner } from '../../design/ui'
import { cn } from '../../design/cn'

export interface InternalNotesPanelProps {
  notes: InternalNote[] | undefined
  isLoading: boolean
  // The viewing teacher's user id — only their own notes show edit/delete.
  currentUserId: number
  onCreate: (body: string) => Promise<unknown>
  onUpdate: (noteId: number, body: string) => Promise<unknown>
  onDelete: (noteId: number) => Promise<unknown>
  // Heading + helper line, so the same panel reads right on a thread vs a student.
  title: string
  hint: string
}

// InternalNotesPanel renders the teacher-only comment log for one target (a
// solution thread or a student): a list of attributed notes plus an add form,
// with inline edit/delete on the viewer's own notes. It is presentational —
// the caller wires the resource-specific mutation/query hooks.
export function InternalNotesPanel({
  notes,
  isLoading,
  currentUserId,
  onCreate,
  onUpdate,
  onDelete,
  title,
  hint,
}: InternalNotesPanelProps) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitNew() {
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    setError(null)
    try {
      await onCreate(body)
      setDraft('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить заметку.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-amber-300/60 bg-amber-50/40 p-4 dark:border-amber-500/30 dark:bg-amber-500/5">
      <div className="mb-1 flex items-center gap-2">
        <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
        <h3 className="font-display text-base font-medium text-ink">{title}</h3>
      </div>
      <p className="mb-3 text-xs text-muted">{hint}</p>

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : notes && notes.length > 0 ? (
        <ul className="mb-3 flex flex-col gap-2">
          {notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              editable={note.author_user_id === currentUserId}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-faint">Пока нет заметок.</p>
      )}

      <div className="flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Новая внутренняя заметка…"
          aria-label="Новая внутренняя заметка"
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button
          type="button"
          size="sm"
          className="self-start"
          disabled={busy || draft.trim() === ''}
          onClick={submitNew}
        >
          {busy ? 'Сохранение…' : 'Добавить заметку'}
        </Button>
      </div>
    </section>
  )
}

function NoteRow({
  note,
  editable,
  onUpdate,
  onDelete,
}: {
  note: InternalNote
  editable: boolean
  onUpdate: (noteId: number, body: string) => Promise<unknown>
  onDelete: (noteId: number) => Promise<unknown>
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.body)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const body = text.trim()
    if (!body) return
    setBusy(true)
    setError(null)
    try {
      await onUpdate(note.id, body)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await onDelete(note.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить.')
      setBusy(false)
    }
  }

  const edited = note.updated_at !== note.created_at

  return (
    <li className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink">{note.author_name}</span>
        <span className="text-xs text-faint">
          {formatDateTime(note.created_at)}
          {edited ? ' · ред.' : ''}
        </span>
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            aria-label="Редактировать заметку"
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={save}>
              {busy ? 'Сохранение…' : 'Сохранить'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setText(note.body)
                setEditing(false)
                setError(null)
              }}
            >
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className={cn('text-sm text-ink whitespace-pre-wrap break-words')}>{note.body}</p>
          {error ? <p className="mt-1 text-sm text-danger">{error}</p> : null}
          {editable ? (
            <div className="mt-1.5 flex gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden /> Изм.
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={remove}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Удалить
              </Button>
            </div>
          ) : null}
        </>
      )}
    </li>
  )
}
