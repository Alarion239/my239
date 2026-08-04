import { useDeferredValue, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { APIErrorImpl, DEFAULT_LATEX_PREAMBLE, latexBodySource, normalizeLatexSource, useMathCenterLatexPreamble } from '@my239/shared'
import { Eye, ExternalLink, FileText, Pencil, X } from 'lucide-react'
import { Button, Input, Spinner, Textarea } from '../../design/ui'
import { cn } from '../../design/cn'
import { PdfViewer } from './pdf-viewer'
import { TexViewer } from './tex-viewer'
import { useAutosave, type AutosaveStatus } from './use-autosave'

export type SolutionFormat = 'tex' | 'pdf' | 'link'
export type SolutionWorkbenchMode = 'view' | 'edit'

const FORMAT_LABEL: Record<SolutionFormat, string> = {
  tex: 'LaTeX',
  pdf: 'PDF',
  link: 'Видео',
}

type QueryLike = { data?: { tex: string }; isLoading?: boolean; isError?: boolean; error?: unknown }

export interface SolutionWorkbenchProps {
  title: string
  mode: SolutionWorkbenchMode
  hasTex: boolean
  hasPdf: boolean
  link?: string | null
  publishedAt?: string | null
  centerId: number
  pdfPath: string
  pdfTitle?: string
  initialTex?: string
  texQuery?: QueryLike
  formatTabLabel?: string
  confirmPublication?: boolean
  pdfActionPlacement?: 'before-tabs' | 'after-tabs'
  headerPrefix?: ReactNode
  details?: ReactNode
  relatedAutosave?: { status: AutosaveStatus; error: string | null }
  onModeChange?: (mode: SolutionWorkbenchMode) => void
  onPutTex?: (tex: string) => Promise<unknown>
  onUploadPdf?: (file: Blob) => Promise<unknown>
  onSetLink?: (link: string) => Promise<unknown>
  onBeforePublish?: () => Promise<unknown>
  onPublish?: () => Promise<unknown>
  onClose: () => void
  onPublished?: () => void
  closesCoffin?: boolean
}

function availableFormats(hasTex: boolean, hasPdf: boolean, link?: string | null): SolutionFormat[] {
  return [hasTex ? 'tex' : null, hasPdf ? 'pdf' : null, link ? 'link' : null].filter(
    (format): format is SolutionFormat => format !== null,
  )
}

function errorMessage(value: unknown, fallback: string) {
  return value instanceof APIErrorImpl ? value.message : value instanceof Error ? value.message : fallback
}

function statusLabel(status: AutosaveStatus) {
  if (status === 'saving') return 'Сохраняем…'
  if (status === 'saved') return 'Сохранено'
  return null
}

// Shared material editor for likbezs and teacher razbors. View mode mounts
// only the stored format; edit mode always offers the three draft tabs.
export function SolutionWorkbench({
  title,
  mode,
  hasTex,
  hasPdf,
  link,
  publishedAt,
  centerId,
  pdfPath,
  pdfTitle,
  initialTex,
  texQuery,
  formatTabLabel = 'Формат разбора',
  confirmPublication = true,
  pdfActionPlacement = 'before-tabs',
  headerPrefix,
  details,
  relatedAutosave,
  onModeChange,
  onPutTex,
  onUploadPdf,
  onSetLink,
  onBeforePublish,
  onPublish,
  onClose,
  onPublished,
  closesCoffin,
}: SolutionWorkbenchProps) {
  const editor = mode === 'edit'
  const formats = editor ? (['tex', 'pdf', 'link'] as SolutionFormat[]) : availableFormats(hasTex, hasPdf, link)
  const [format, setFormat] = useState<SolutionFormat>(formats[0] ?? 'tex')
  const [tex, setTex] = useState(latexBodySource(initialTex ?? texQuery?.data?.tex ?? ''))
  const [linkValue, setLinkValue] = useState(link ?? '')
  const [busy, setBusy] = useState<SolutionFormat | 'publish' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<SolutionFormat | 'publish' | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pdfUploadRef = useRef<Promise<unknown> | null>(null)
  const formatId = 'material-format-' + useId().replace(/:/g, '')
  const preambleQuery = useMathCenterLatexPreamble(centerId)
  const preamble = preambleQuery.data?.preamble ?? DEFAULT_LATEX_PREAMBLE
  const previewTex = useDeferredValue(tex)
  const renderedPreview = previewTex.trim() === '' ? '' : normalizeLatexSource(previewTex, preamble)

  const texAutosave = useAutosave({
    initialValue: latexBodySource(initialTex ?? texQuery?.data?.tex ?? ''),
    save: async (value: string) => {
      if (!onPutTex) return
      await onPutTex(normalizeLatexSource(value, preamble))
    },
    isValid: (value) => value.trim() !== '' || !hasTex,
    invalidMessage: 'LaTeX-конспект не может быть пустым.',
    formatError: (value) => errorMessage(value, 'Не удалось сохранить LaTeX.'),
  })
  const linkAutosave = useAutosave({
    initialValue: link ?? '',
    save: async (value: string) => {
      if (!onSetLink) return
      await onSetLink(value.trim())
    },
    formatError: (value) => errorMessage(value, 'Не удалось сохранить ссылку на видео.'),
  })
  const { isDirty: texDirty, error: texError, status: texStatus, schedule: scheduleTex, setBaseline: setTexBaseline, flush: flushTex } = texAutosave
  const { isDirty: linkDirty, error: linkError, status: linkStatus, schedule: scheduleLink, setBaseline: setLinkBaseline, flush: flushLink } = linkAutosave

  useEffect(() => {
    if (texDirty || texQuery?.data?.tex === undefined) return
    const source = latexBodySource(texQuery.data.tex)
    setTex(source)
    setTexBaseline(source)
  }, [setTexBaseline, texDirty, texQuery?.data?.tex])

  useEffect(() => {
    if (linkDirty) return
    const nextLink = link ?? ''
    setLinkValue(nextLink)
    setLinkBaseline(nextLink)
  }, [link, linkDirty, setLinkBaseline])

  const active = formats.includes(format) ? format : (formats[0] ?? 'tex')
  const hasMaterial = hasTex || hasPdf || !!link || tex.trim() !== '' || linkValue.trim() !== ''
  const autosaveError = relatedAutosave?.error ?? texError ?? linkError
  const statuses = [relatedAutosave?.status, texStatus, linkStatus]
  const autosaveStatus =
    statuses.includes('saving')
      ? 'Сохраняем…'
      : autosaveError
        ? null
        : statusLabel(relatedAutosave?.status ?? 'idle') ?? statusLabel(texStatus) ?? statusLabel(linkStatus)

  const publicationControl = onPublish && !publishedAt ? (
    !confirmPublication ? (
      <Button size="sm" disabled={busy !== null || !hasMaterial} onClick={() => { void publish() }}>
        {busy === 'publish' ? 'Публикуем…' : 'Опубликовать'}
      </Button>
    ) : (
      confirmPublish ? (
        <span className="flex flex-wrap items-center justify-end gap-2 text-right">
          <span>Публикация необратима{closesCoffin ? ' и закроет сдачу гроба' : ''}.</span>
          <Button size="sm" disabled={busy !== null || !hasMaterial} onClick={() => { void publish() }}>Опубликовать</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmPublish(false)}>Отмена</Button>
        </span>
      ) : (
        <Button size="sm" disabled={busy !== null || !hasMaterial} onClick={() => setConfirmPublish(true)}>
          Опубликовать
        </Button>
      )
    )
  ) : null

  async function flushMaterials() {
    if (!(await flushTex())) return false
    return flushLink()
  }

  const close = () => {
    if (!editor || (!texDirty && !linkDirty)) {
      onClose()
      return
    }
    void flushMaterials().then((saved) => {
      if (saved) onClose()
      else setConfirmClose(true)
    })
  }

  const switchMode = (next: SolutionWorkbenchMode) => {
    if (!editor || (!texDirty && !linkDirty)) {
      onModeChange?.(next)
      return
    }
    void flushMaterials().then((saved) => {
      if (saved) onModeChange?.(next)
      else setConfirmClose(true)
    })
  }

  async function publish() {
    if (!onPublish) return
    setBusy('publish')
    setError(null)
    setLastAction(null)
    try {
      if (pdfUploadRef.current) await pdfUploadRef.current
      if (!(await flushMaterials())) {
        // The autosave controller already exposes the actionable validation or
        // request error; avoid replacing it with a second generic alert.
        setError(null)
        return
      }
      await onBeforePublish?.()
      await onPublish()
      setLastAction('publish')
      setConfirmPublish(false)
      onPublished?.()
    } catch (value) {
      setError(errorMessage(value, 'Не удалось опубликовать материал. Исправьте ошибку и попробуйте снова.'))
    } finally {
      setBusy(null)
    }
  }

  const uploadPdf = async (file: Blob) => {
    if (!onUploadPdf) return
    setBusy('pdf')
    setError(null)
    setLastAction(null)
    const request = onUploadPdf(file)
    pdfUploadRef.current = request
    try {
      await request
      setLastAction('pdf')
    } catch (value) {
      setError(errorMessage(value, 'Не удалось загрузить PDF.'))
    } finally {
      if (pdfUploadRef.current === request) pdfUploadRef.current = null
      setBusy(null)
    }
  }

  const onFormatKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const index = formats.indexOf(active)
    const next = formats[(index + direction + formats.length) % formats.length]
    changeFormat(next)
    document.getElementById(formatId + '-' + next)?.focus({ preventScroll: true })
  }

  const changeFormat = (next: SolutionFormat) => {
    const scrollX = typeof window === 'undefined' ? 0 : window.scrollX
    const scrollY = typeof window === 'undefined' ? 0 : window.scrollY
    setFormat(next)
    const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)
    if (typeof window !== 'undefined' && !isJsdom) {
      window.requestAnimationFrame(() => {
        try {
          window.scrollTo(scrollX, scrollY)
        } catch {
          // Some test DOMs expose scrollTo but intentionally do not implement it.
        }
      })
    }
  }

  const formatTabs = formats.length > 0 ? (
    <div className="flex h-10 shrink-0 items-center gap-0.5 rounded-lg bg-surface-subtle p-0.5" role="tablist" aria-label={formatTabLabel}>
      {formats.map((item) => (
        <button
          key={item}
          id={formatId + '-' + item}
          type="button"
          role="tab"
          aria-selected={active === item}
          tabIndex={active === item ? 0 : -1}
          onClick={() => changeFormat(item)}
          onKeyDown={onFormatKeyDown}
          className={cn(
            'h-9 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
            active === item ? 'bg-selected text-selected-text' : 'text-muted hover:bg-surface hover:text-text',
          )}
        >
          {FORMAT_LABEL[item]}
        </button>
      ))}
    </div>
  ) : null

  const toolbarStatus = autosaveError ?? autosaveStatus ?? (lastAction === 'pdf' ? 'PDF сохранён' : null)

  const pdfControl = editor && active === 'pdf' && onUploadPdf ? (
    <>
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadPdf(file) }} />
      <Button type="button" size="sm" variant="secondary" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
        <FileText className="h-4 w-4" aria-hidden />
        {busy === 'pdf' ? 'Загружаем…' : hasPdf ? 'Заменить PDF' : 'Загрузить PDF'}
      </Button>
    </>
  ) : null

  return (
    <section
      className="material-workbench-container min-w-0"
      aria-label={headerPrefix ? formatTabLabel : title}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          close()
        }
      }}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2 pb-2 md:flex-nowrap">
        {headerPrefix ? <div className="min-w-0 flex-1 basis-0">{headerPrefix}</div> : <h2 className="min-w-0 flex-1 basis-0 truncate text-lg font-medium text-text" title={title}>{title}</h2>}
        {!details && pdfActionPlacement === 'before-tabs' ? pdfControl : null}
        {!details ? formatTabs : null}
        {!details && pdfActionPlacement === 'after-tabs' ? pdfControl : null}
        {toolbarStatus ? <span role={autosaveError ? 'alert' : 'status'} className={cn('min-w-0 truncate text-xs', autosaveError ? 'text-danger' : 'text-muted')}>{toolbarStatus}</span> : null}

        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
          {editor && onPublish ? publicationControl : null}
          {editor && onModeChange && publishedAt ? (
            <Button type="button" size="icon" variant="ghost" aria-label="Закончить редактирование" onClick={() => switchMode('view')}>
              <Eye className="h-4 w-4" aria-hidden />
            </Button>
          ) : null}
          {!editor && onModeChange ? (
            <Button type="button" size="icon" variant="ghost" aria-label="Редактировать" onClick={() => switchMode('edit')}>
              <Pencil className="h-4 w-4" aria-hidden />
            </Button>
          ) : null}
          <Button type="button" size="icon" variant="ghost" aria-label="Закрыть" onClick={close}>
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </header>

      {details ? <div className="mt-1">{details}</div> : null}
      {details ? <div className="mt-2 flex flex-wrap items-center gap-2">{pdfActionPlacement === 'before-tabs' ? pdfControl : null}{formatTabs}{pdfActionPlacement === 'after-tabs' ? pdfControl : null}</div> : null}

      {confirmClose ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-status-checking-soft px-3 py-2 text-sm text-text" role="alert">
          <span>Не удалось сохранить изменения.</span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmClose(false)}>Продолжить</Button>
            <Button size="sm" variant="secondary" onClick={onClose}>Закрыть без сохранения</Button>
          </span>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-danger" role={autosaveError ? 'status' : 'alert'}>{error}</p> : null}
      {lastAction === 'publish' ? <p className="mt-3 text-sm text-status-accepted" role="status">Опубликовано.</p> : null}

      <div className={active === 'pdf' ? 'mt-3' : 'mt-4'}>
        {active === 'tex' ? (
          editor ? (
            <div className="flex flex-col gap-3">
              <div className="material-tex-grid gap-3">
                <div className="min-h-[24rem] overflow-auto rounded-lg border border-border bg-surface-subtle p-3">
                  <label htmlFor={formatId + '-source'} className="mb-2 block text-sm font-medium text-text">LaTeX</label>
                  <Textarea
                    id={formatId + '-source'}
                    value={tex}
                    onChange={(event) => { setTex(event.target.value); scheduleTex(event.target.value) }}
                    className="min-h-[20rem] font-mono text-xs leading-6"
                    placeholder="Решение..."
                  />
                </div>
                <div className="min-h-[24rem] overflow-auto rounded-lg border border-border bg-surface-subtle p-3">
                  <p className="mb-2 text-sm font-medium text-text">Предпросмотр</p>
                  {renderedPreview.trim() === '' ? <p className="text-sm text-muted">Предпросмотр появится здесь.</p> : <TexViewer tex={renderedPreview} />}
                </div>
              </div>
            </div>
          ) : texQuery?.isLoading ? (
            <div className="flex min-h-32 items-center justify-center"><Spinner /></div>
          ) : texQuery?.isError || !texQuery?.data ? (
            <p className="text-sm text-danger" role="alert">Не удалось загрузить LaTeX.</p>
          ) : <TexViewer tex={texQuery.data.tex} />
        ) : active === 'pdf' ? (
          <div className="flex flex-col gap-3">
            {hasPdf ? <PdfViewer path={pdfPath} title={pdfTitle ?? title + ' (PDF)'} /> : editor ? <p className="text-sm text-muted">PDF ещё не прикреплён.</p> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {editor ? (
              <Input id={formatId + '-video-link'} aria-label="Ссылка на видео" value={linkValue} onChange={(event) => { setLinkValue(event.target.value); scheduleLink(event.target.value) }} placeholder="Ссылка на видео" />
            ) : null}
            {((editor ? linkValue : (linkValue || link))?.trim()) ? <VideoLink url={(editor ? linkValue : (linkValue || link)) as string} /> : <p className="text-sm text-muted">Видео ещё не прикреплено.</p>}
          </div>
        )}
      </div>
    </section>
  )
}

function VideoLink({ url }: { url: string }) {
  const embed = youtubeEmbed(url)
  if (embed) {
    return <iframe src={embed} title="Видео-разбор" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen className="aspect-video w-full rounded-lg border border-border bg-surface" />
  }
  return <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 self-start rounded-lg border border-border-control bg-surface px-3 py-2 text-sm font-medium text-text hover:bg-surface-subtle"><ExternalLink className="h-4 w-4" aria-hidden />Открыть видео</a>
}

function youtubeEmbed(url: string): string | null {
  const match = url.match(/[?&]v=([\w-]{11})/) || url.match(/youtu\.be\/([\w-]{11})/) || url.match(/youtube\.com\/embed\/([\w-]{11})/)
  return match ? 'https://www.youtube.com/embed/' + match[1] : null
}
