import { useEffect, useRef, useState, type KeyboardEvent, type TouchEvent, type WheelEvent } from 'react'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { Spinner } from '../../design/ui'
import { apiClient } from '../../lib/api'
import 'pdfjs-dist/web/pdf_viewer.css'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url'

export interface PdfViewerProps {
  // The authed blob endpoint to fetch (e.g. /mathcenter/series/7/pdf or a
  // /solution/pdf variant).
  path: string
  title?: string
  fileName?: string
  className?: string
}

type PdfEngine = typeof import('pdfjs-dist') & typeof import('pdfjs-dist/web/pdf_viewer.mjs')

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const KEYBOARD_ZOOM_FACTOR = 1.08
const WHEEL_ZOOM_SENSITIVITY = 1200
const PINCH_ZOOM_RESPONSE = 0.8

let enginePromise: Promise<PdfEngine> | null = null

function loadPdfEngine(): Promise<PdfEngine> {
  if (!enginePromise) {
    // pdf_viewer.mjs reads globalThis.pdfjsLib while it initializes. The core
    // PDF.js module creates that global, so these imports must be sequential;
    // Promise.all can race them in production and leave pdfjsLib undefined.
    enginePromise = import('pdfjs-dist').then(async (core) => {
      // Let Vite bundle the worker as a JavaScript worker entry. A plain asset
      // URL preserves PDF.js's `.mjs` extension, which some static hosts serve
      // as application/octet-stream and browsers then refuse to import.
      core.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
      const viewer = await import('pdfjs-dist/web/pdf_viewer.mjs')
      return { ...core, ...viewer } as PdfEngine
    })
  }
  return enginePromise
}

function defaultFileName(title: string): string {
  const safe = title.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim().replace(/\s+/g, '-')
  return (safe || 'document') + '.pdf'
}

// PdfViewer fetches an authenticated PDF as bytes and renders it with PDF.js.
// Keeping the document inside the page avoids Android Chrome's unreliable
// native handling of blob: URLs in embedded PDF frames.
export function PdfViewer({
  path,
  title = 'PDF',
  fileName,
  className,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const viewerInstanceRef = useRef<InstanceType<PdfEngine['PDFViewer']> | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [scale, setScale] = useState(1)
  const wheelDeltaRef = useRef(0)
  const wheelFrameRef = useRef<number | null>(null)
  const pinchRef = useRef<{ startDistance: number; startScale: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    let loadingTask: import('pdfjs-dist').PDFDocumentLoadingTask | null = null
    let eventBus: InstanceType<PdfEngine['EventBus']> | null = null
    let objectUrl: string | null = null
    let removeEventListeners: (() => void) | null = null
    const container = containerRef.current
    const viewerElement = viewerRef.current

    setStatus('loading')
    setError(null)
    setDownloadUrl(null)
    setPage(1)
    setPages(0)
    setScale(1)
    viewerInstanceRef.current = null
    viewerElement?.replaceChildren()

    async function load() {
      try {
        const blob = await apiClient.requestBlob(path)
        if (cancelled || !container || !viewerElement) return

        objectUrl = URL.createObjectURL(blob)
        setDownloadUrl(objectUrl)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        if (cancelled) return

        const engine = await loadPdfEngine()
        if (cancelled) return

        eventBus = new engine.EventBus()
        const linkService = new engine.PDFLinkService({ eventBus })
        const pdfViewer = new engine.PDFViewer({
          container,
          viewer: viewerElement,
          eventBus,
          linkService,
          removePageBorders: true,
          textLayerMode: 1,
          annotationMode: 1,
          // Keep very large pages from exhausting a phone's canvas memory.
          maxCanvasPixels: 16 * 1024 * 1024,
        })
        linkService.setViewer(pdfViewer)
        viewerInstanceRef.current = pdfViewer

        const onPagesInit = () => {
          pdfViewer.currentScaleValue = 'page-width'
          setScale(pdfViewer.currentScale)
        }
        const onPageChanging = (event: { pageNumber: number }) => {
          setPage(event.pageNumber)
          setScale(pdfViewer.currentScale)
        }
        eventBus.on('pagesinit', onPagesInit)
        eventBus.on('pagechanging', onPageChanging)
        removeEventListeners = () => {
          eventBus?.off('pagesinit', onPagesInit)
          eventBus?.off('pagechanging', onPageChanging)
        }

        loadingTask = engine.getDocument({ data: bytes })
        const pdfDocument = await loadingTask.promise
        if (cancelled) {
          await loadingTask.destroy()
          return
        }

        setPages(pdfDocument.numPages)
        linkService.setDocument(pdfDocument)
        pdfViewer.setDocument(pdfDocument)
        setStatus('ready')

      } catch (err: unknown) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Не удалось загрузить PDF')
        setStatus('error')
      }
    }

    void load()

    return () => {
      cancelled = true
      void loadingTask?.destroy()
      removeEventListeners?.()
      if (wheelFrameRef.current !== null) {
        cancelAnimationFrame(wheelFrameRef.current)
        wheelFrameRef.current = null
      }
      wheelDeltaRef.current = 0
      pinchRef.current = null
      viewerInstanceRef.current?.cleanup()
      viewerInstanceRef.current = null
      eventBus = null
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      viewerElement?.replaceChildren()
    }
  }, [attempt, path])

  const downloadName = fileName ?? defaultFileName(title)

  function changePage(delta: number) {
    const instance = viewerInstanceRef.current
    if (!instance) return
    instance.currentPageNumber = Math.min(pages, Math.max(1, instance.currentPageNumber + delta))
  }

  function setZoom(next: number) {
    const instance = viewerInstanceRef.current
    if (!instance) return
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
    instance.currentScale = clamped
    setScale(clamped)
  }

  function changeZoom(delta: number) {
    const instance = viewerInstanceRef.current
    if (!instance) return
    setZoom(instance.currentScale * (delta > 0 ? KEYBOARD_ZOOM_FACTOR : 1 / KEYBOARD_ZOOM_FACTOR))
  }

  function resetZoom() {
    const instance = viewerInstanceRef.current
    if (!instance) return
    instance.currentScaleValue = 'page-width'
    setScale(instance.currentScale)
  }

  function handleDocumentKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey) || status !== 'ready') return
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      changeZoom(1)
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      changeZoom(-1)
    } else if (event.key === '0') {
      event.preventDefault()
      resetZoom()
    }
  }

  function handleDocumentWheel(event: WheelEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey) || status !== 'ready') return
    event.preventDefault()
    const pixelsPerLine = 16
    const pixelsPerPage = window.innerHeight || 800
    const delta = event.deltaY * (event.deltaMode === 1 ? pixelsPerLine : event.deltaMode === 2 ? pixelsPerPage : 1)
    wheelDeltaRef.current += delta
    if (wheelFrameRef.current !== null) return
    wheelFrameRef.current = window.requestAnimationFrame(() => {
      const pending = Math.max(-240, Math.min(240, wheelDeltaRef.current))
      wheelDeltaRef.current = 0
      wheelFrameRef.current = null
      const instance = viewerInstanceRef.current
      if (!instance) return
      setZoom(instance.currentScale * Math.exp(-pending / WHEEL_ZOOM_SENSITIVITY))
    })
  }

  function handleDocumentTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (status !== 'ready' || event.touches.length !== 2) return
    const first = event.touches.item(0)
    const second = event.touches.item(1)
    if (!first || !second) return
    const startDistance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
    if (startDistance <= 0) return
    const instance = viewerInstanceRef.current
    if (!instance) return
    pinchRef.current = { startDistance, startScale: instance.currentScale }
  }

  function handleDocumentTouchMove(event: TouchEvent<HTMLDivElement>) {
    const pinch = pinchRef.current
    if (!pinch || status !== 'ready' || event.touches.length !== 2) return
    const first = event.touches.item(0)
    const second = event.touches.item(1)
    if (!first || !second) return
    const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
    if (distance <= 0) return
    event.preventDefault()
    const ratio = distance / pinch.startDistance
    setZoom(pinch.startScale * Math.pow(ratio, PINCH_ZOOM_RESPONSE))
  }

  function handleDocumentTouchEnd(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length < 2) pinchRef.current = null
  }

  if (status === 'error') {
    return (
      <div className={'flex min-h-32 flex-col items-center justify-center gap-3 rounded-lg border border-danger/30 bg-danger-soft p-5 text-sm text-danger ' + (className ?? '')} role="alert">
        <span>{error ?? 'Не удалось загрузить PDF'}</span>
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="rounded-full border border-danger/30 px-3 py-1.5 font-medium hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
        >
          Повторить
        </button>
        {downloadUrl ? (
          <a href={downloadUrl} download={downloadName} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 font-medium text-accent-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <Download className="h-3.5 w-3.5" aria-hidden />
            Скачать PDF
          </a>
        ) : null}
      </div>
    )
  }

  return (
    <section className={'flex w-full flex-col overflow-hidden rounded-lg border border-line bg-surface ' + (className ?? '')} aria-label={title}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 border-b border-line bg-surface-muted px-2 py-1.5" role="toolbar" aria-label="Управление PDF">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => changePage(-1)} disabled={page <= 1 || status !== 'ready'} aria-label="Предыдущая страница" className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <span className="min-w-16 text-center text-xs tabular-nums text-muted" aria-live="polite">
            {pages > 0 ? `${page} / ${pages}` : 'PDF'}
          </span>
          <button type="button" onClick={() => changePage(1)} disabled={page >= pages || status !== 'ready'} aria-label="Следующая страница" className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <span className="text-center text-xs tabular-nums text-muted" aria-label="Масштаб PDF" title="Ctrl/Cmd + или −, Ctrl/Cmd + колесо или щипок двумя пальцами">
          {status === 'ready' ? `${Math.round(scale * 100)}%` : 'Загрузка…'}
        </span>
        <div className="flex min-w-0 items-center justify-end gap-2">
          {downloadUrl ? (
            <a href={downloadUrl} download={downloadName} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-accent-ink hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <Download className="h-3.5 w-3.5" aria-hidden />
              Скачать PDF
            </a>
          ) : null}
        </div>
      </div>
      <div className="relative h-[min(70vh,640px)] w-full bg-surface-muted">
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-auto outline-none"
          style={{ touchAction: 'pan-x pan-y' }}
          role="document"
          tabIndex={0}
          onKeyDown={handleDocumentKeyDown}
          onWheel={handleDocumentWheel}
          onTouchStart={handleDocumentTouchStart}
          onTouchMove={handleDocumentTouchMove}
          onTouchEnd={handleDocumentTouchEnd}
          onTouchCancel={handleDocumentTouchEnd}
        >
          <div ref={viewerRef} className="pdfViewer" />
        </div>
        {status === 'loading' ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" role="status" aria-label="Загрузка PDF">
            <Spinner />
          </div>
        ) : null}
      </div>
    </section>
  )
}
