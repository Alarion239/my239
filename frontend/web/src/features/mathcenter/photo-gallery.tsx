import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Maximize,
  Minus,
  Plus,
  X,
} from 'lucide-react'
import type { PhotoView } from '@my239/shared'
import { cn } from '../../design/cn'
import { swipeDirection, type SwipePoint } from './photo-gallery-gestures'

export interface PhotoAttachmentsProps {
  photos: PhotoView[]
  title: string
}

type Point = SwipePoint

interface SinglePointerGesture {
  pointerId: number
  start: Point
  startOffset: Point
  pointerType: string
}

interface PhotoSize {
  width: number
  height: number
}

const MIN_SCALE = 1
const MAX_SCALE = 4
const SCALE_STEP = 0.25
const DOUBLE_TAP_SCALE = 2
const VIEWPORT_GUTTER = 32

function photoKey(photo: PhotoView, position: number): string {
  return photo.object_key || `${photo.index}:${position}`
}

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

function clampOffset(
  offset: Point,
  scale: number,
  viewport: HTMLDivElement | null,
  frame: HTMLDivElement | null,
): Point {
  if (!viewport || !frame || scale <= MIN_SCALE) return { x: 0, y: 0 }
  const viewportRect = viewport.getBoundingClientRect()
  const availableWidth = Math.max(0, viewportRect.width - VIEWPORT_GUTTER)
  const availableHeight = Math.max(0, viewportRect.height - VIEWPORT_GUTTER)
  const maxX = Math.max(0, (frame.offsetWidth * scale - availableWidth) / 2)
  const maxY = Math.max(0, (frame.offsetHeight * scale - availableHeight) / 2)
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  }
}

function nextScaleFromWheel(scale: number, deltaY: number): number {
  return clampScale(scale * Math.exp(-Math.max(-240, Math.min(240, deltaY)) / 720))
}

function fittedPhotoSize(
  naturalWidth: number,
  naturalHeight: number,
  viewport: HTMLDivElement | null,
): PhotoSize | null {
  if (!viewport || naturalWidth <= 0 || naturalHeight <= 0) return null
  const bounds = viewport.getBoundingClientRect()
  const availableWidth = Math.max(1, bounds.width - VIEWPORT_GUTTER)
  const availableHeight = Math.max(1, bounds.height - VIEWPORT_GUTTER)
  const ratio = Math.min(
    1,
    availableWidth / naturalWidth,
    availableHeight / naturalHeight,
  )
  return {
    width: Math.max(1, Math.round(naturalWidth * ratio)),
    height: Math.max(1, Math.round(naturalHeight * ratio)),
  }
}

// PhotoAttachments keeps each event's photos together: a student's attempt or
// a grader's comment can be inspected as a small, ordered stack of pages.
export function PhotoAttachments({ photos, title }: PhotoAttachmentsProps) {
  const orderedPhotos = useMemo(
    () =>
      photos
        .map((photo, position) => ({ photo, position }))
        .sort((a, b) => a.photo.index - b.photo.index || a.position - b.position)
        .map(({ photo }) => photo),
    [photos],
  )
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set())
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const markUnavailable = useCallback((photo: PhotoView, position: number) => {
    const key = photoKey(photo, position)
    setUnavailable((previous) => {
      if (previous.has(key)) return previous
      const next = new Set(previous)
      next.add(key)
      return next
    })
  }, [])

  const close = useCallback(() => {
    const trigger = triggerRef.current
    setActiveIndex(null)
    window.requestAnimationFrame(() => trigger?.focus())
  }, [])

  const open = useCallback((index: number, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger
    setActiveIndex(index)
  }, [])

  useEffect(() => {
    if (activeIndex !== null && activeIndex >= orderedPhotos.length) close()
  }, [activeIndex, close, orderedPhotos.length])

  if (orderedPhotos.length === 0) return null

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {orderedPhotos.map((photo, index) => {
          const key = photoKey(photo, index)
          const available = Boolean(photo.url) && !unavailable.has(key)
          if (!available) {
            return (
              <div
                key={key}
                role="img"
                aria-label={`Фото ${index + 1} из ${orderedPhotos.length} недоступно`}
                className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-md border border-line bg-surface-muted text-faint"
              >
                <ImageOff className="h-5 w-5" aria-hidden />
                <span className="text-[10px]">Недоступно</span>
              </div>
            )
          }
          return (
            <button
              key={key}
              type="button"
              aria-label={`Открыть фото ${index + 1} из ${orderedPhotos.length}`}
              onClick={(event) => open(index, event.currentTarget)}
              className="group relative block h-24 w-24 overflow-hidden rounded-md border border-line bg-surface-muted text-left outline-none transition-shadow hover:border-line-strong focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <img
                src={photo.url}
                alt={`${title}, фото ${index + 1} из ${orderedPhotos.length}`}
                loading="lazy"
                decoding="async"
                onError={() => markUnavailable(photo, index)}
                className="h-full w-full object-cover"
              />
              <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
                {index + 1}
              </span>
            </button>
          )
        })}
      </div>

      <PhotoLightbox
        openIndex={activeIndex}
        photos={orderedPhotos}
        title={title}
        unavailable={unavailable}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) close()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus()
        }}
        onSelect={setActiveIndex}
        onImageError={(photo, index) => markUnavailable(photo, index)}
      />
    </>
  )
}

interface PhotoLightboxProps {
  openIndex: number | null
  photos: PhotoView[]
  title: string
  unavailable: Set<string>
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus: (event: Event) => void
  onSelect: (index: number) => void
  onImageError: (photo: PhotoView, index: number) => void
}

function PhotoLightbox({
  openIndex,
  photos,
  title,
  unavailable,
  onOpenChange,
  onCloseAutoFocus,
  onSelect,
  onImageError,
}: PhotoLightboxProps) {
  const photo = openIndex === null ? null : photos[openIndex]
  const viewportRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const thumbnailStripRef = useRef<HTMLDivElement>(null)
  const lightboxThumbnailRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const pointersRef = useRef<Map<number, Point>>(new Map())
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null)
  const gestureRef = useRef<SinglePointerGesture | null>(null)
  const suppressClickRef = useRef(false)
  const [scale, setScale] = useState(MIN_SCALE)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [baseSize, setBaseSize] = useState<PhotoSize | null>(null)
  const [imageError, setImageError] = useState(false)

  const setScaleAndOffset = useCallback(
    (nextScale: number, nextOffset: Point = offset) => {
      const boundedScale = clampScale(nextScale)
      setScale(boundedScale)
      setOffset(clampOffset(nextOffset, boundedScale, viewportRef.current, frameRef.current))
    },
    [offset],
  )

  const navigate = useCallback(
    (delta: number) => {
      if (openIndex === null) return
      const nextIndex = Math.min(photos.length - 1, Math.max(0, openIndex + delta))
      if (nextIndex !== openIndex) onSelect(nextIndex)
    },
    [onSelect, openIndex, photos.length],
  )

  useEffect(() => {
    setScale(MIN_SCALE)
    setOffset({ x: 0, y: 0 })
    setBaseSize(null)
    setImageError(false)
  }, [openIndex, photo?.url])

  useEffect(() => {
    if (openIndex === null) return
    const resize = () => {
      const image = imageRef.current
      const nextSize = image
        ? fittedPhotoSize(image.naturalWidth, image.naturalHeight, viewportRef.current)
        : null
      if (!nextSize) return
      setBaseSize(nextSize)
      setOffset((current) =>
        clampOffset(current, scale, viewportRef.current, frameRef.current),
      )
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [openIndex, scale])

  useEffect(() => {
    if (openIndex === null) return
    const neighborIndexes = [openIndex - 1, openIndex + 1]
    const preloaders: HTMLImageElement[] = []
    for (const index of neighborIndexes) {
      const neighbor = photos[index]
      if (!neighbor?.url || unavailable.has(photoKey(neighbor, index))) continue
      const preloader = new Image()
      preloader.src = neighbor.url
      preloaders.push(preloader)
    }
    return () => {
      for (const preloader of preloaders) preloader.onload = null
    }
  }, [openIndex, photos, unavailable])

  useEffect(() => {
    if (openIndex === null) return
    const activeKey = photo ? photoKey(photo, openIndex) : ''
    const thumbnail = lightboxThumbnailRefs.current[activeKey]
    thumbnail?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
  }, [openIndex, photo])

  useEffect(() => {
    if (openIndex === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        navigate(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        navigate(1)
      } else if (event.key === 'Home') {
        event.preventDefault()
        onSelect(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        onSelect(photos.length - 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, onSelect, openIndex, photos.length])

  const resetZoom = useCallback(() => {
    setScaleAndOffset(MIN_SCALE, { x: 0, y: 0 })
  }, [setScaleAndOffset])

  const zoomAt = useCallback(
    (nextScale: number, origin?: Point) => {
      const currentScale = scale
      const boundedScale = clampScale(nextScale)
      if (boundedScale === currentScale) return
      const viewport = viewportRef.current
      const rect = viewport?.getBoundingClientRect()
      const center = rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: 0, y: 0 }
      const localOrigin = origin ?? center
      const relative = {
        x: localOrigin.x - center.x,
        y: localOrigin.y - center.y,
      }
      const ratio = boundedScale / currentScale
      const nextOffset = {
        x: relative.x - (relative.x - offset.x) * ratio,
        y: relative.y - (relative.y - offset.y) * ratio,
      }
      setScaleAndOffset(boundedScale, nextOffset)
    },
    [offset, scale, setScaleAndOffset],
  )

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      zoomAt(nextScaleFromWheel(scale, event.deltaY), { x: event.clientX, y: event.clientY })
    },
    [scale, zoomAt],
  )

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const pointers = pointersRef.current
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    event.currentTarget.setPointerCapture?.(event.pointerId)
    if (pointers.size >= 2) {
      const points = Array.from(pointers.values())
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
      pinchRef.current = { distance, scale }
      gestureRef.current = null
      return
    }
    gestureRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      startOffset: offset,
      pointerType: event.pointerType,
    }
  }, [offset, scale])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current
    if (!pointers.has(event.pointerId)) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size >= 2) {
      const points = Array.from(pointers.values())
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
      const pinch = pinchRef.current
      if (!pinch || distance <= 0) return
      suppressClickRef.current = true
      event.preventDefault()
      zoomAt(pinch.scale * (distance / pinch.distance))
      return
    }
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId || scale <= MIN_SCALE) return
    if (
      Math.hypot(event.clientX - gesture.start.x, event.clientY - gesture.start.y) > 8
    ) {
      suppressClickRef.current = true
    }
    event.preventDefault()
    setOffset(
      clampOffset(
        {
          x: gesture.startOffset.x + event.clientX - gesture.start.x,
          y: gesture.startOffset.y + event.clientY - gesture.start.y,
        },
        scale,
        viewportRef.current,
        frameRef.current,
      ),
    )
  }, [scale, zoomAt])

  const finishPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current
    const gesture = gestureRef.current
    const current = pointers.get(event.pointerId)
    pointers.delete(event.pointerId)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (pointers.size < 2) pinchRef.current = null
    if (!gesture || gesture.pointerId !== event.pointerId || !current) return
    gestureRef.current = null
    const direction = swipeDirection(gesture.start, current, scale, gesture.pointerType)
    if (direction !== 0) navigate(direction)
  }, [navigate, scale])

  if (!photo || openIndex === null) {
    return <DialogPrimitive.Root open={false} />
  }

  const photoIsAvailable = Boolean(photo.url) && !unavailable.has(photoKey(photo, openIndex))
  const canGoPrevious = openIndex > 0
  const canGoNext = openIndex < photos.length - 1
  const displayError = imageError || !photoIsAvailable

  return (
    <DialogPrimitive.Root open onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#14120d]/95 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex h-[100dvh] w-[100dvw] flex-col overflow-hidden bg-[#14120d] text-white outline-none"
          onCloseAutoFocus={onCloseAutoFocus}
          onClick={(event) => {
            if (event.target === event.currentTarget) onOpenChange(false)
          }}
        >
          <div className="relative z-10 flex shrink-0 items-center gap-3 border-b border-white/10 bg-[#14120d]/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate font-sans text-sm font-medium text-white">
              {title}
            </DialogPrimitive.Title>
            <span className="shrink-0 text-xs tabular-nums text-white/65" aria-live="polite">
              {openIndex + 1} / {photos.length}
            </span>
            {photo.url ? (
              <a
                href={photo.url}
                target="_blank"
                rel="noreferrer"
                className="hidden shrink-0 rounded-md px-2 py-1.5 text-xs font-medium text-white/75 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3cc39d] sm:inline-flex"
              >
                Открыть оригинал
              </a>
            ) : null}
            <DialogPrimitive.Close
              aria-label="Закрыть просмотр фотографий"
              className="shrink-0 rounded-md p-2 text-white/75 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3cc39d]"
            >
              <X className="h-5 w-5" aria-hidden />
            </DialogPrimitive.Close>
          </div>

          <div
            ref={viewportRef}
            className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishPointer}
            onPointerCancel={finishPointer}
            onDoubleClick={() => zoomAt(scale === MIN_SCALE ? DOUBLE_TAP_SCALE : MIN_SCALE)}
            onClick={(event) => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false
                return
              }
              if (event.target === event.currentTarget) onOpenChange(false)
            }}
            role="group"
            aria-label={`${title}, фото ${openIndex + 1} из ${photos.length}`}
          >
            <div className="absolute inset-4 flex min-h-0 min-w-0 items-center justify-center">
              {photos.length > 1 ? (
                <button
                  type="button"
                  aria-label="Предыдущее фото"
                  disabled={!canGoPrevious}
                  onClick={() => navigate(-1)}
                  className="absolute left-2 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/45 p-3 text-white shadow-lg transition-colors hover:bg-black/70 disabled:pointer-events-none disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3cc39d] sm:left-5"
                >
                  <ChevronLeft className="h-6 w-6" aria-hidden />
                </button>
              ) : null}

              <div
                ref={frameRef}
                className="relative flex max-h-full max-w-full items-center justify-center"
                style={{
                  width: baseSize ? `${baseSize.width}px` : undefined,
                  height: baseSize ? `${baseSize.height}px` : undefined,
                  transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
                  transformOrigin: 'center center',
                }}
              >
                {displayError ? (
                  <div className="flex max-w-xs flex-col items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-6 py-8 text-center text-sm text-white/70">
                    <ImageOff className="h-8 w-8 text-white/45" aria-hidden />
                    <span>{photoIsAvailable ? 'Не удалось загрузить фото' : 'Фото недоступно'}</span>
                  </div>
                ) : (
                  <img
                    ref={imageRef}
                    src={photo.url}
                    alt={`${title}, фото ${openIndex + 1} из ${photos.length}`}
                    draggable={false}
                    decoding="async"
                    onLoad={(event) => {
                      const nextSize = fittedPhotoSize(
                        event.currentTarget.naturalWidth,
                        event.currentTarget.naturalHeight,
                        viewportRef.current,
                      )
                      if (!nextSize) return
                      setBaseSize(nextSize)
                      setOffset({ x: 0, y: 0 })
                    }}
                    onError={() => {
                      setImageError(true)
                      onImageError(photo, openIndex)
                    }}
                    className={cn(
                      'block select-none object-contain',
                      baseSize ? 'h-full w-full' : 'max-h-full max-w-full',
                    )}
                  />
                )}
              </div>

              {photos.length > 1 ? (
                <button
                  type="button"
                  aria-label="Следующее фото"
                  disabled={!canGoNext}
                  onClick={() => navigate(1)}
                  className="absolute right-2 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/45 p-3 text-white shadow-lg transition-colors hover:bg-black/70 disabled:pointer-events-none disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3cc39d] sm:right-5"
                >
                  <ChevronRight className="h-6 w-6" aria-hidden />
                </button>
              ) : null}
            </div>
          </div>

          <div className="relative z-10 flex shrink-0 flex-col gap-2 border-t border-white/10 bg-[#14120d]/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-5">
            <div className="flex items-center justify-center gap-1" role="toolbar" aria-label="Управление просмотром">
              <button
                type="button"
                aria-label="Уменьшить масштаб"
                title="Уменьшить масштаб"
                disabled={scale <= MIN_SCALE}
                onClick={() => zoomAt(scale - SCALE_STEP)}
                className="rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3cc39d]"
              >
                <Minus className="h-4 w-4" aria-hidden />
              </button>
              <span className="min-w-14 text-center text-xs tabular-nums text-white/70" aria-label="Масштаб">
                {Math.round(scale * 100)}%
              </span>
              <button
                type="button"
                aria-label="Увеличить масштаб"
                title="Увеличить масштаб"
                disabled={scale >= MAX_SCALE}
                onClick={() => zoomAt(scale + SCALE_STEP)}
                className="rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3cc39d]"
              >
                <Plus className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label="Вписать фото в окно"
                title="Вписать фото в окно"
                disabled={scale === MIN_SCALE && offset.x === 0 && offset.y === 0}
                onClick={resetZoom}
                className="ml-1 rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3cc39d]"
              >
                <Maximize className="h-4 w-4" aria-hidden />
              </button>
              {photo.url ? (
                <a
                  href={photo.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 rounded-md px-2 py-1.5 text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3cc39d] sm:hidden"
                >
                  Оригинал
                </a>
              ) : null}
            </div>

            {photos.length > 1 ? (
              <div
                ref={thumbnailStripRef}
                className="flex max-w-full gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                aria-label="Фотографии отправки"
              >
                {photos.map((thumbnail, index) => {
                  const key = photoKey(thumbnail, index)
                  const available = Boolean(thumbnail.url) && !unavailable.has(key)
                  return (
                    <button
                        key={key}
                      ref={(element) => {
                        lightboxThumbnailRefs.current[key] = element
                      }}
                      type="button"
                      aria-label={`Открыть фото ${index + 1} из ${photos.length}`}
                      aria-current={index === openIndex ? 'true' : undefined}
                      disabled={!available}
                      onClick={() => onSelect(index)}
                      className={cn(
                        'relative h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-black/30 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#3cc39d] sm:h-16 sm:w-16',
                        index === openIndex ? 'border-[#3cc39d] ring-2 ring-[#3cc39d]/50' : 'border-white/15 hover:border-white/45',
                        !available && 'cursor-not-allowed opacity-45',
                      )}
                    >
                      {available ? (
                        <img
                          src={thumbnail.url}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          onError={() => onImageError(thumbnail, index)}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ImageOff className="absolute inset-0 m-auto h-4 w-4 text-white/45" aria-hidden />
                      )}
                      <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[10px] tabular-nums text-white">
                        {index + 1}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
