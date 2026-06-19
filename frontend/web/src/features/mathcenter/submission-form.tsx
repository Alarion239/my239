import { useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import {
  APIErrorImpl,
  uploadThreadPhotos,
  useApiClient,
  type Verdict,
} from '@my239/shared'
import { Button, Textarea } from '../../design/ui'
import { cn } from '../../design/cn'

// FinalizeArgs is what the parent's mutation needs once photos are uploaded.
export interface FinalizeArgs {
  event_uuid: string
  body: string
  object_keys: string[]
  verdict?: Verdict
}

export interface SubmissionFormProps {
  // Where to mint upload URLs: 'student' keys on subproblemId, 'grader' on
  // threadId.
  presignKind: 'student' | 'grader'
  presignId: number
  // Runs the finalize endpoint (submit / appeal / grade) and resolves when the
  // new state has been applied. Return value is ignored (the mutation's fresh
  // ThreadView is consumed by the caller, not the form). Throwing surfaces the
  // message inline.
  onFinalize: (args: FinalizeArgs) => Promise<unknown>
  submitLabel: string
  bodyPlaceholder?: string
  bodyRequired?: boolean
  // When true, render the Принять / Отклонить verdict pills (teacher grade).
  showVerdict?: boolean
}

const MAX_PHOTOS = 10
const ACCEPT = 'image/jpeg,image/png,image/heic,image/webp'

// SubmissionForm is the shared photo + text panel behind student submit/appeal
// and teacher grade. It owns the presigned-PUT handshake so the parent only
// wires up the finalize mutation.
export function SubmissionForm({
  presignKind,
  presignId,
  onFinalize,
  submitLabel,
  bodyPlaceholder,
  bodyRequired,
  showVerdict,
}: SubmissionFormProps) {
  const client = useApiClient()
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [verdict, setVerdict] = useState<Verdict | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function addFiles(picked: FileList | null) {
    if (!picked) return
    setFiles((prev) => [...prev, ...Array.from(picked)].slice(0, MAX_PHOTOS))
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit() {
    setError(null)
    if (showVerdict && verdict === '') {
      setError('Выберите вердикт.')
      return
    }
    if (bodyRequired && body.trim() === '') {
      setError('Комментарий обязателен.')
      return
    }
    setBusy(true)
    try {
      const { event_uuid, object_keys } = await uploadThreadPhotos(
        client,
        presignKind,
        presignId,
        files,
      )
      await onFinalize({
        event_uuid,
        body: body.trim(),
        object_keys,
        verdict: showVerdict ? (verdict as Verdict) : undefined,
      })
      setBody('')
      setFiles([])
      setVerdict('')
    } catch (e) {
      setError(
        e instanceof APIErrorImpl ? e.message : 'Не удалось отправить',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {showVerdict ? (
        <div className="flex gap-2" role="group" aria-label="Вердикт">
          <VerdictPill
            tone="accepted"
            active={verdict === 'accepted'}
            onClick={() => setVerdict('accepted')}
          >
            Принять
          </VerdictPill>
          <VerdictPill
            tone="rejected"
            active={verdict === 'rejected'}
            onClick={() => setVerdict('rejected')}
          >
            Отклонить
          </VerdictPill>
        </div>
      ) : null}

      <Textarea
        aria-label="Комментарий"
        placeholder={bodyPlaceholder ?? 'Комментарий…'}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />

      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          addFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={files.length >= MAX_PHOTOS}
        >
          <Paperclip className="h-4 w-4" aria-hidden />
          Прикрепить фото ({files.length}/{MAX_PHOTOS})
        </Button>
      </div>

      {files.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {files.map((f, i) => (
            <li
              key={f.name + ':' + i}
              className="flex items-center justify-between gap-2 rounded-md bg-surface-muted px-2.5 py-1.5 text-xs text-muted"
            >
              <span className="min-w-0 truncate">{f.name}</span>
              <button
                type="button"
                aria-label={'Убрать ' + f.name}
                onClick={() => removeFile(i)}
                className="shrink-0 rounded p-0.5 text-faint hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Button
        type="button"
        onClick={handleSubmit}
        disabled={busy}
        className="self-start"
      >
        {busy ? 'Отправляем…' : submitLabel}
      </Button>
    </div>
  )
}

function VerdictPill({
  tone,
  active,
  onClick,
  children,
}: {
  tone: 'accepted' | 'rejected'
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  const activeClasses =
    tone === 'accepted'
      ? 'bg-status-accepted text-white border-status-accepted'
      : 'bg-status-rejected text-white border-status-rejected'
  const idleClasses =
    tone === 'accepted'
      ? 'border-line-strong text-status-accepted hover:bg-status-accepted-soft'
      : 'border-line-strong text-status-rejected hover:bg-status-rejected-soft'
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        active ? activeClasses : idleClasses,
      )}
    >
      {children}
    </button>
  )
}
