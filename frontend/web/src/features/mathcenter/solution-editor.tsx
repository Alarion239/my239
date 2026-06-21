import { useRef, useState, type ReactNode } from 'react'
import { APIErrorImpl } from '@my239/shared'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Input,
  Textarea,
} from '../../design/ui'

export interface SolutionEditorProps {
  title: string
  hasTex: boolean
  hasPdf: boolean
  link?: string | null
  onPutTex: (tex: string) => Promise<unknown>
  onUploadPdf: (file: Blob) => Promise<unknown>
  onSetLink: (link: string) => Promise<unknown>
  trigger: ReactNode
  // Fired after a successful save (any format). The batch flow uses it to close
  // the dialog + clear the selection so the result is reflected immediately.
  onSaved?: () => void
  // Close the dialog automatically once a save succeeds.
  closeOnSave?: boolean
  // When set, renders a resolve action (e.g. «Снять гроб») in the dialog footer
  // so the teacher can attach the разбор and close the coffin in one place.
  onResolve?: () => Promise<unknown>
  resolveLabel?: string
}

// SolutionEditor is the teacher's «Разбор» authoring panel: paste LaTeX, upload
// a PDF, and/or set an external (video) link. Shared by the series-level разбор
// and each coffin's разбор — the parent wires the right mutations in.
export function SolutionEditor({
  title,
  hasTex,
  hasPdf,
  link,
  onPutTex,
  onUploadPdf,
  onSetLink,
  trigger,
  onSaved,
  closeOnSave,
  onResolve,
  resolveLabel,
}: SolutionEditorProps) {
  const [open, setOpen] = useState(false)
  const [tex, setTex] = useState('')
  const [linkValue, setLinkValue] = useState(link ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label)
    setError(null)
    setDone(null)
    try {
      await fn()
      setDone(label)
      if (closeOnSave) setOpen(false)
      onSaved?.()
    } catch (e) {
      setError(e instanceof APIErrorImpl ? e.message : 'Не удалось сохранить')
    } finally {
      setBusy(null)
    }
  }

  // The resolve action (e.g. «Снять гроб») runs after any optional attach, then
  // closes the dialog regardless of closeOnSave.
  async function doResolve() {
    if (!onResolve) return
    setBusy('resolve')
    setError(null)
    try {
      await onResolve()
      setOpen(false)
      onSaved?.()
    } catch (e) {
      setError(e instanceof APIErrorImpl ? e.message : 'Не удалось выполнить')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="mt-1">
          Прикрепите разбор: LaTeX, PDF и/или ссылку на видео (YouTube/VK).
        </DialogDescription>

        {error ? <p className="mt-3 text-sm text-danger" role="alert">{error}</p> : null}
        {done ? <p className="mt-3 text-sm text-status-accepted">Сохранено: {done}.</p> : null}

        <div className="mt-4 flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">LaTeX{hasTex ? ' · загружен' : ''}</span>
            </div>
            <Textarea
              value={tex}
              onChange={(e) => setTex(e.target.value)}
              placeholder={'\\documentclass{article}\\n\\begin{document}…\\end{document}'}
              className="min-h-28 font-mono text-xs"
              aria-label="LaTeX разбора"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="self-start"
              disabled={busy !== null || tex.trim() === ''}
              onClick={() => run('LaTeX', () => onPutTex(tex))}
            >
              {busy === 'LaTeX' ? 'Сохраняем…' : 'Сохранить LaTeX'}
            </Button>
          </section>

          <section className="flex flex-col gap-2 border-t border-line pt-4">
            <span className="text-sm font-medium text-ink">PDF{hasPdf ? ' · загружен' : ''}</span>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void run('PDF', () => onUploadPdf(f))
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="self-start"
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
            >
              {busy === 'PDF' ? 'Загружаем…' : 'Загрузить PDF'}
            </Button>
          </section>

          <section className="flex flex-col gap-2 border-t border-line pt-4">
            <span className="text-sm font-medium text-ink">Ссылка (видео/внешний разбор)</span>
            <Input
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              placeholder="https://youtube.com/watch?v=…"
              aria-label="Ссылка на разбор"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy !== null || linkValue.trim() === ''}
                onClick={() => run('Ссылка', () => onSetLink(linkValue.trim()))}
              >
                {busy === 'Ссылка' ? 'Сохраняем…' : 'Сохранить ссылку'}
              </Button>
              {link ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => run('Ссылка', () => onSetLink(''))}
                >
                  Убрать
                </Button>
              ) : null}
            </div>
          </section>

          {onResolve ? (
            <section className="flex flex-col gap-2 border-t border-line pt-4">
              <p className="text-xs text-muted">
                Прикрепите разбор выше (необязательно), затем закройте гроб.
              </p>
              <Button
                type="button"
                size="sm"
                disabled={busy !== null}
                onClick={doResolve}
                className="self-start"
              >
                {busy === 'resolve' ? 'Закрываем…' : (resolveLabel ?? 'Снять')}
              </Button>
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
