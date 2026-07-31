import { useEffect, useMemo, useRef, useState, useDeferredValue, type KeyboardEvent, type ReactNode } from 'react'
import { APIErrorImpl, DEFAULT_LATEX_PREAMBLE, latexBodySource, normalizeLatexSource, useMathCenterLatexPreamble } from '@my239/shared'
import { ExternalLink, FileText, Link2, Save, X } from 'lucide-react'
import { Button, Input, Spinner, Textarea } from '../../design/ui'
import { cn } from '../../design/cn'
import { TexViewer } from './tex-viewer'
import { PdfViewer } from './pdf-viewer'

export type SolutionFormat = 'tex' | 'pdf' | 'link'
export type SolutionWorkbenchMode = 'view' | 'edit'

const FORMAT_LABEL: Record<SolutionFormat, string> = {
  tex: 'LaTeX',
  pdf: 'PDF',
  link: 'Видео',
}

export interface SolutionWorkbenchProps {
  title: string
  mode: SolutionWorkbenchMode
  hasTex: boolean
  hasPdf: boolean
  link?: string | null
  publishedAt?: string | null
  centerId: number
  pdfPath: string
  initialTex?: string
  texQuery?: { data?: { tex: string }; isLoading?: boolean; isError?: boolean; error?: unknown }
  onModeChange?: (mode: SolutionWorkbenchMode) => void
  onPutTex?: (tex: string) => Promise<unknown>
  onUploadPdf?: (file: Blob) => Promise<unknown>
  onSetLink?: (link: string) => Promise<unknown>
  onPublish?: () => Promise<unknown>
  onClose: () => void
  onPublished?: () => void
  targetDescription?: string
  closesCoffin?: boolean
  children?: ReactNode
}

function availableFormats(hasTex: boolean, hasPdf: boolean, link?: string | null): SolutionFormat[] {
  return [hasTex ? 'tex' : null, hasPdf ? 'pdf' : null, link ? 'link' : null].filter(
    (format): format is SolutionFormat => format !== null,
  )
}

// SolutionWorkbench is the shared view/edit surface for teacher and student
// razbors. It deliberately keeps one format mounted at a time: long PDFs and
// embeds never make the LaTeX authoring surface feel like a junk drawer.
export function SolutionWorkbench({
  title,
  mode,
  hasTex,
  hasPdf,
  link,
  publishedAt,
  centerId,
  pdfPath,
  initialTex,
  texQuery,
  onModeChange,
  onPutTex,
  onUploadPdf,
  onSetLink,
  onPublish,
  onClose,
  onPublished,
  targetDescription,
  closesCoffin,
}: SolutionWorkbenchProps) {
  const editor = mode === 'edit'
  const formats = editor ? (['tex', 'pdf', 'link'] as SolutionFormat[]) : availableFormats(hasTex, hasPdf, link)
  const [format, setFormat] = useState<SolutionFormat>(formats[0] ?? 'tex')
  const [tex, setTex] = useState(latexBodySource(initialTex ?? texQuery?.data?.tex ?? ''))
  const [linkValue, setLinkValue] = useState(link ?? '')
  const [texDirty, setTexDirty] = useState(false)
  const [linkDirty, setLinkDirty] = useState(false)
  const [busy, setBusy] = useState<SolutionFormat | 'publish' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<SolutionFormat | 'publish' | null>(null)
  const [savedLocally, setSavedLocally] = useState<Set<SolutionFormat>>(() => new Set())
  const [confirmClose, setConfirmClose] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const preambleQuery = useMathCenterLatexPreamble(centerId)
  const preamble = preambleQuery.data?.preamble ?? DEFAULT_LATEX_PREAMBLE
  const previewTex = useDeferredValue(tex)
  const renderedPreview = previewTex.trim() === '' ? '' : normalizeLatexSource(previewTex, preamble)
  const savedFormats = useMemo(
    () => Array.from(new Set([...availableFormats(hasTex, hasPdf, link), ...savedLocally])),
    [hasTex, hasPdf, link, savedLocally],
  )
  const hasSavedMaterial = savedFormats.length > 0
  const active = formats.includes(format) ? format : (formats[0] ?? 'tex')

  useEffect(() => {
    if (!texDirty && texQuery?.data?.tex !== undefined) {
      setTex(latexBodySource(texQuery.data.tex))
    }
  }, [texDirty, texQuery?.data?.tex])

  useEffect(() => {
    if (!linkDirty) setLinkValue(link ?? '')
  }, [link, linkDirty])

  const close = () => {
    if (editor && (texDirty || linkDirty)) {
      setConfirmClose(true)
      return
    }
    onClose()
  }

  const switchMode = (next: SolutionWorkbenchMode) => {
    if (editor && (texDirty || linkDirty)) {
      setConfirmClose(true)
      return
    }
    onModeChange?.(next)
  }

  const run = async (kind: SolutionFormat | 'publish', work: () => Promise<unknown>) => {
    setBusy(kind)
    setError(null)
    setDone(null)
    try {
      await work()
      setDone(kind)
      if (kind === 'tex') setTexDirty(false)
      if (kind === 'link') setLinkDirty(false)
      if (kind !== 'publish') {
        setSavedLocally((current) => new Set(current).add(kind))
      }
      if (kind === 'publish') {
        setConfirmPublish(false)
        onPublished?.()
      }
    } catch (value) {
      setError(value instanceof APIErrorImpl ? value.message : 'Не удалось сохранить изменения')
    } finally {
      setBusy(null)
    }
  }

  const onFormatKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const index = formats.indexOf(active)
    const next = formats[(index + direction + formats.length) % formats.length]
    setFormat(next)
    document.getElementById('solution-format-' + next)?.focus()
  }

  return (
    <section
      className="animate-rise rounded-xl border border-line bg-surface p-4 shadow-sm"
      aria-label={title}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          close()
        }
      }}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-faint">
            {editor ? (publishedAt ? 'Опубликован' : 'Черновик') : 'Просмотр'}
          </p>
          <h2 className="mt-1 break-words font-display text-xl font-medium text-ink">{title}</h2>
          {targetDescription ? <p className="mt-1 text-sm text-muted">{targetDescription}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {editor && onPublish && !publishedAt ? (
            confirmPublish ? (
              <div className="flex flex-wrap items-center justify-end gap-2 text-right text-xs text-muted">
                <span>
                  Публикация необратима{closesCoffin ? ' и закроет сдачу гроба' : ''}.
                </span>
                <Button size="sm" disabled={busy !== null || !hasSavedMaterial} onClick={() => void run('publish', onPublish)}>
                  Опубликовать
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmPublish(false)}>Отмена</Button>
              </div>
            ) : (
              <Button size="sm" disabled={busy !== null || !hasSavedMaterial} onClick={() => setConfirmPublish(true)}>
                {busy === 'publish' ? 'Публикуем…' : 'Опубликовать'}
              </Button>
            )
          ) : null}
          {editor && onModeChange && publishedAt ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => switchMode('view')}>Просмотр</Button>
          ) : null}
          {!editor && onModeChange ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => switchMode('edit')}>Редактировать</Button>
          ) : null}
          <Button type="button" size="icon" variant="ghost" aria-label="Закрыть" onClick={close}>
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </header>

      {formats.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1 border-b border-line pb-2" role="tablist" aria-label="Формат разбора">
          {formats.map((item) => (
            <button
              key={item}
              id={'solution-format-' + item}
              type="button"
              role="tab"
              aria-selected={active === item}
              tabIndex={active === item ? 0 : -1}
              onClick={() => setFormat(item)}
              onKeyDown={onFormatKeyDown}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                active === item ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-surface-muted hover:text-ink',
              )}
            >
              {FORMAT_LABEL[item]}{editor && savedFormats.includes(item) ? ' ✓' : ''}
            </button>
          ))}
        </div>
      ) : null}

      {confirmClose ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-status-checking-soft px-3 py-2 text-sm text-ink" role="alert">
          <span>Есть несохранённые изменения.</span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmClose(false)}>Продолжить</Button>
            <Button size="sm" variant="secondary" onClick={onClose}>Закрыть без сохранения</Button>
          </span>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-danger" role="alert">{error}</p> : null}
      {done ? <p className="mt-3 text-sm text-status-accepted" role="status">{done === 'publish' ? 'Разбор опубликован.' : 'Сохранено: ' + FORMAT_LABEL[done] + '.'}</p> : null}

      <div className="mt-4">
        {active === 'tex' ? (
          editor ? (
            <div className="flex flex-col gap-3">
              <label htmlFor="solution-tex-source" className="text-sm font-medium text-ink">Исходник LaTeX</label>
              <Textarea
                id="solution-tex-source"
                value={tex}
                onChange={(event) => { setTex(event.target.value); setTexDirty(true) }}
                className="min-h-[16rem] font-mono text-xs leading-6"
                placeholder={'Введите текст и формулы без преамбулы…'}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="self-start"
                disabled={busy !== null || tex.trim() === '' || !onPutTex}
                onClick={() => onPutTex && void run('tex', () => onPutTex(normalizeLatexSource(tex, preamble)))}
              >
                <Save className="h-4 w-4" aria-hidden />
                {busy === 'tex' ? 'Сохраняем…' : 'Сохранить LaTeX'}
              </Button>
              <div className="rounded-lg border border-line bg-surface-muted p-3">
                <p className="mb-2 text-sm font-medium text-ink">Предпросмотр</p>
                {renderedPreview.trim() === '' ? <p className="text-sm text-muted">Предпросмотр появится здесь.</p> : <TexViewer tex={renderedPreview} />}
              </div>
            </div>
          ) : texQuery?.isLoading ? (
            <div className="flex min-h-32 items-center justify-center"><Spinner /></div>
          ) : texQuery?.isError || !texQuery?.data ? (
            <p className="text-sm text-danger" role="alert">Не удалось загрузить LaTeX.</p>
          ) : <TexViewer tex={texQuery.data.tex} />
        ) : active === 'pdf' ? (
          <div className="flex flex-col gap-3">
            {hasPdf ? <PdfViewer path={pdfPath} title="Разбор (PDF)" /> : editor ? <p className="text-sm text-muted">PDF ещё не прикреплён.</p> : null}
            {editor ? (
              <>
                <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file && onUploadPdf) void run('pdf', () => onUploadPdf(file)) }} />
                <Button type="button" size="sm" variant="secondary" className="self-start" disabled={busy !== null || !onUploadPdf} onClick={() => fileRef.current?.click()}>
                  <FileText className="h-4 w-4" aria-hidden />
                  {busy === 'pdf' ? 'Загружаем…' : hasPdf ? 'Заменить PDF' : 'Загрузить PDF'}
                </Button>
              </>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {editor ? (
              <>
                <label htmlFor="solution-video-link" className="text-sm font-medium text-ink">Ссылка на видео</label>
                <Input id="solution-video-link" value={linkValue} onChange={(event) => { setLinkValue(event.target.value); setLinkDirty(true) }} placeholder="https://youtube.com/watch?v=…" />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" disabled={busy !== null || linkValue.trim() === '' || !onSetLink} onClick={() => onSetLink && void run('link', () => onSetLink(linkValue.trim()))}>
                    <Link2 className="h-4 w-4" aria-hidden />
                    {busy === 'link' ? 'Сохраняем…' : 'Сохранить ссылку'}
                  </Button>
                  {link ? <Button type="button" size="sm" variant="ghost" disabled={busy !== null || !onSetLink} onClick={() => onSetLink && void run('link', () => onSetLink(''))}>Убрать</Button> : null}
                </div>
              </>
            ) : null}
            {linkValue || link ? <VideoLink url={(linkValue || link) as string} /> : <p className="text-sm text-muted">Видео ещё не прикреплено.</p>}
          </div>
        )}
      </div>
    </section>
  )
}

function VideoLink({ url }: { url: string }) {
  const embed = youtubeEmbed(url)
  if (embed) {
    return <iframe src={embed} title="Видео-разбор" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen className="aspect-video w-full rounded-lg border border-line bg-surface" />
  }
  return <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 self-start rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-muted"><ExternalLink className="h-4 w-4" aria-hidden />Открыть видео</a>
}

function youtubeEmbed(url: string): string | null {
  const match = url.match(/[?&]v=([\w-]{11})/) || url.match(/youtu\.be\/([\w-]{11})/) || url.match(/youtube\.com\/embed\/([\w-]{11})/)
  return match ? 'https://www.youtube.com/embed/' + match[1] : null
}
