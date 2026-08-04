import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Minus, Plus } from 'lucide-react'
import { Spinner } from '../../design/ui'
import { apiClient } from '../../lib/api'
import 'pdfjs-dist/web/pdf_viewer.css'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url'
import { normalizeWheelDelta, pinchZoomFactor, safariGestureZoomFactor, touchMidpoint, wheelZoomFactor } from './pdf-zoom'

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
const ZOOM_DRAWING_DELAY = 150

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
  const sectionRef = useRef<HTMLElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const viewerInstanceRef = useRef<InstanceType<PdfEngine['PDFViewer']> | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [scale, setScale] = useState(1)
  const statusRef = useRef(status)
  const wheelDeltaRef = useRef(0)
  const wheelFrameRef = useRef<number | null>(null)
  const wheelOriginRef = useRef<[number, number] | null>(null)
  const pinchRef = useRef<{ distance: number } | null>(null)
  const safariGestureRef = useRef<{ scale: number; origin: [number, number] } | null>(null)
  statusRef.current = status

  useEffect(() => {
    let cancelled = false
    let loadingTask: import('pdfjs-dist').PDFDocumentLoadingTask | null = null
    let eventBus: InstanceType<PdfEngine['EventBus']> | null = null
    let objectUrl: string | null = null
    let removeEventListeners: (() => void) | null = null
    let removeInteractionListeners: (() => void) | null = null
    let removeKeyboardListener: (() => void) | null = null
    const container = containerRef.current
    const viewerElement = viewerRef.current

    setStatus('loading')
    statusRef.current = 'loading'
    setError(null)
    setDownloadUrl(null)
    setPage(1)
    setPages(0)
    setScale(1)
    viewerInstanceRef.current = null
    viewerElement?.replaceChildren()

    if (container) {
      const section = sectionRef.current
      const isInsideViewer = (event: Event) => {
        const target = event.target
        return (target instanceof Node && section?.contains(target)) || container.matches(':hover')
      }

      const onWheel = (event: WheelEvent) => {
        if (!(event.ctrlKey || event.metaKey) || !isInsideViewer(event) || statusRef.current !== 'ready') return
        event.preventDefault()
        event.stopPropagation()
        wheelDeltaRef.current += normalizeWheelDelta(event.deltaY, event.deltaMode, window.innerHeight)
        wheelOriginRef.current = [event.clientX, event.clientY]
        if (wheelFrameRef.current !== null) return
        wheelFrameRef.current = window.requestAnimationFrame(() => {
          const pending = wheelDeltaRef.current
          const origin = wheelOriginRef.current
          wheelDeltaRef.current = 0
          wheelOriginRef.current = null
          wheelFrameRef.current = null
          if (!origin) return
          applyZoomFactor(wheelZoomFactor(pending), origin)
        })
      }

      const onTouchStart = (event: TouchEvent) => {
        if (event.touches.length !== 2 || statusRef.current !== 'ready') return
        const first = event.touches.item(0)
        const second = event.touches.item(1)
        if (!first || !second) return
        const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
        if (distance > 0) pinchRef.current = { distance }
      }

      const onTouchMove = (event: TouchEvent) => {
        const pinch = pinchRef.current
        if (!pinch || statusRef.current !== 'ready' || event.touches.length !== 2) return
        const first = event.touches.item(0)
        const second = event.touches.item(1)
        if (!first || !second) return
        const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
        if (distance <= 0) return
        event.preventDefault()
        event.stopPropagation()
        const factor = pinchZoomFactor(distance, pinch.distance)
        pinch.distance = distance
        applyZoomFactor(factor, touchMidpoint(first, second))
      }

      const onTouchEnd = (event: TouchEvent) => {
        if (event.touches.length < 2) pinchRef.current = null
      }

      const preventSafariGesture = (event: Event) => {
        event.preventDefault()
        event.stopPropagation()
      }

      const gestureOrigin = (event: Event): [number, number] => {
        const gesture = event as Event & { clientX?: number; clientY?: number }
        if (Number.isFinite(gesture.clientX) && Number.isFinite(gesture.clientY)) {
          return [gesture.clientX as number, gesture.clientY as number]
        }
        const bounds = container.getBoundingClientRect()
        return [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2]
      }

      const onSafariGestureStart = (event: Event) => {
        if (!isInsideViewer(event) || statusRef.current !== 'ready') return
        const gesture = event as Event & { scale?: number }
        const scale = Number.isFinite(gesture.scale) && (gesture.scale as number) > 0 ? gesture.scale as number : 1
        safariGestureRef.current = { scale, origin: gestureOrigin(event) }
        preventSafariGesture(event)
      }

      const onSafariGestureChange = (event: Event) => {
        if (!isInsideViewer(event) || statusRef.current !== 'ready') return
        const state = safariGestureRef.current
        const gesture = event as Event & { scale?: number }
        const scale = Number.isFinite(gesture.scale) && (gesture.scale as number) > 0 ? gesture.scale as number : 1
        preventSafariGesture(event)
        // On browsers that expose both touch and GestureEvent streams, the
        // touch path is already applying the same pinch increment.
        if (!state || pinchRef.current) return
        const factor = safariGestureZoomFactor(scale, state.scale)
        state.scale = scale
        applyZoomFactor(factor, state.origin)
      }

      const onSafariGestureEnd = (event: Event) => {
        safariGestureRef.current = null
        if (!isInsideViewer(event)) return
        preventSafariGesture(event)
      }

      const wheelOptions: AddEventListenerOptions = { capture: true, passive: false }
      const touchOptions: AddEventListenerOptions = { passive: false }
      document.addEventListener('wheel', onWheel, wheelOptions)
      container.addEventListener('touchstart', onTouchStart, touchOptions)
      container.addEventListener('touchmove', onTouchMove, touchOptions)
      container.addEventListener('touchend', onTouchEnd, touchOptions)
      container.addEventListener('touchcancel', onTouchEnd, touchOptions)
      document.addEventListener('gesturestart', onSafariGestureStart as EventListener, wheelOptions)
      document.addEventListener('gesturechange', onSafariGestureChange as EventListener, wheelOptions)
      document.addEventListener('gestureend', onSafariGestureEnd as EventListener, wheelOptions)
      removeInteractionListeners = () => {
        document.removeEventListener('wheel', onWheel, wheelOptions)
        container.removeEventListener('touchstart', onTouchStart, touchOptions)
        container.removeEventListener('touchmove', onTouchMove, touchOptions)
        container.removeEventListener('touchend', onTouchEnd, touchOptions)
        container.removeEventListener('touchcancel', onTouchEnd, touchOptions)
        document.removeEventListener('gesturestart', onSafariGestureStart as EventListener, wheelOptions)
        document.removeEventListener('gesturechange', onSafariGestureChange as EventListener, wheelOptions)
        document.removeEventListener('gestureend', onSafariGestureEnd as EventListener, wheelOptions)
      }

      const onKeyDown = (event: KeyboardEvent) => {
        if (!(event.ctrlKey || event.metaKey) || !isInsideViewer(event) || statusRef.current !== 'ready') return
        if (event.key === '+' || event.key === '=') {
          event.preventDefault()
          event.stopPropagation()
          applyZoomFactor(KEYBOARD_ZOOM_FACTOR, [
            window.innerWidth / 2,
            window.innerHeight / 2,
          ])
        } else if (event.key === '-' || event.key === '_') {
          event.preventDefault()
          event.stopPropagation()
          applyZoomFactor(1 / KEYBOARD_ZOOM_FACTOR, [
            window.innerWidth / 2,
            window.innerHeight / 2,
          ])
        } else if (event.key === '0') {
          event.preventDefault()
          event.stopPropagation()
          const instance = viewerInstanceRef.current
          if (instance) instance.currentScaleValue = 'page-width'
        }
      }
      document.addEventListener('keydown', onKeyDown, true)
      removeKeyboardListener = () => document.removeEventListener('keydown', onKeyDown, true)
    }

    function applyZoomFactor(factor: number, origin?: [number, number]) {
      const instance = viewerInstanceRef.current
      if (!instance || !Number.isFinite(factor) || factor <= 0) return
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, instance.currentScale * factor))
      if (next === instance.currentScale) return
      instance.updateScale({
        scaleFactor: next / instance.currentScale,
        drawingDelay: ZOOM_DRAWING_DELAY,
        origin,
      })
    }

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
        }
        const onScaleChanging = (event: { scale: number }) => {
          setScale(event.scale)
        }
        eventBus.on('pagesinit', onPagesInit)
        eventBus.on('pagechanging', onPageChanging)
        eventBus.on('scalechanging', onScaleChanging)
        removeEventListeners = () => {
          eventBus?.off('pagesinit', onPagesInit)
          eventBus?.off('pagechanging', onPageChanging)
          eventBus?.off('scalechanging', onScaleChanging)
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
      removeInteractionListeners?.()
      removeKeyboardListener?.()
      if (wheelFrameRef.current !== null) {
        cancelAnimationFrame(wheelFrameRef.current)
        wheelFrameRef.current = null
      }
      wheelDeltaRef.current = 0
      wheelOriginRef.current = null
      pinchRef.current = null
      safariGestureRef.current = null
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

  function changeZoom(delta: number) {
    const instance = viewerInstanceRef.current
    if (!instance) return
    const container = containerRef.current
    const bounds = container?.getBoundingClientRect()
    const origin: [number, number] | undefined = bounds
      ? [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2]
      : undefined
    const factor = delta > 0 ? KEYBOARD_ZOOM_FACTOR : 1 / KEYBOARD_ZOOM_FACTOR
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, instance.currentScale * factor))
    if (next !== instance.currentScale) {
      instance.updateScale({ scaleFactor: next / instance.currentScale, origin })
    }
  }

  if (status === 'error') {
    return (
      <div className={'flex min-h-32 flex-col items-center justify-center gap-3 rounded-lg border border-danger/30 bg-danger-soft p-5 text-sm text-danger ' + (className ?? '')} role="alert">
        <span>{error ?? 'Не удалось загрузить PDF'}</span>
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="rounded-full border border-danger/30 px-3 py-1.5 font-medium hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          Повторить
        </button>
        {downloadUrl ? (
          <a href={downloadUrl} download={downloadName} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-medium text-selected-text hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <Download className="h-3.5 w-3.5" aria-hidden />
            Скачать PDF
          </a>
        ) : null}
      </div>
    )
  }

  return (
    <section ref={sectionRef} className={'flex w-full flex-col overflow-hidden rounded-lg border border-border bg-surface ' + (className ?? '')} aria-label={title}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 border-b border-border bg-surface-subtle px-2 py-1.5" role="toolbar" aria-label="Управление PDF">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => changePage(-1)} disabled={page <= 1 || status !== 'ready'} aria-label="Предыдущая страница" className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-text disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <span className="min-w-16 text-center text-xs tabular-nums text-muted" aria-live="polite">
            {pages > 0 ? `${page} / ${pages}` : 'PDF'}
          </span>
          <button type="button" onClick={() => changePage(1)} disabled={page >= pages || status !== 'ready'} aria-label="Следующая страница" className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-text disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="flex items-center justify-center gap-1">
          <button type="button" onClick={() => changeZoom(-1)} disabled={status !== 'ready' || scale <= MIN_ZOOM} aria-label="Уменьшить масштаб" title="Уменьшить масштаб" className="hidden rounded-md p-1 text-muted hover:bg-surface hover:text-text disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus md:inline-flex">
            <Minus className="h-3.5 w-3.5" aria-hidden />
          </button>
          <span className="min-w-12 text-center text-xs tabular-nums text-muted" aria-label="Масштаб PDF" title="Ctrl/Cmd + или −, Ctrl/Cmd + колесо, щипок двумя пальцами">
            {status === 'ready' ? `${Math.round(scale * 100)}%` : 'Загрузка…'}
          </span>
          <button type="button" onClick={() => changeZoom(1)} disabled={status !== 'ready' || scale >= MAX_ZOOM} aria-label="Увеличить масштаб" title="Увеличить масштаб" className="hidden rounded-md p-1 text-muted hover:bg-surface hover:text-text disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus md:inline-flex">
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2">
          {downloadUrl ? (
            <a href={downloadUrl} download={downloadName} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-selected-text hover:bg-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              <Download className="h-3.5 w-3.5" aria-hidden />
              Скачать PDF
            </a>
          ) : null}
        </div>
      </div>
      <div className="relative h-[min(70vh,640px)] w-full bg-surface-subtle">
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-auto outline-none"
          style={{ touchAction: 'pan-x pan-y' }}
          role="document"
          tabIndex={0}
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
