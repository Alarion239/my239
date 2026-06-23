import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useThreadNotes } from '@my239/shared'
import { cn } from '../../design/cn'

// CommentMark is the amber corner flag signalling a cell has an internal note.
function CommentMark() {
  return (
    <span
      aria-hidden
      tabIndex={0}
      className="absolute right-0.5 top-0.5 h-0 w-0 border-l-[7px] border-t-[7px] border-l-transparent border-t-amber-500 focus-visible:outline-none focus-visible:border-t-amber-600"
    />
  )
}

// CommentPopup is the custom floating card showing a thread's internal notes.
// It portals to <body> with fixed positioning so it escapes the grid's scroll
// clipping, and flips above the cell when there isn't room below. The notes are
// fetched on mount (the popup only mounts while hovered/focused).
function CommentPopup({
  anchorRef,
  threadId,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  threadId: number
}) {
  const { data } = useThreadNotes(threadId, true)
  const popRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const pop = popRef.current
    if (!anchor || !pop) return
    const a = anchor.getBoundingClientRect()
    const ph = pop.offsetHeight
    const pw = pop.offsetWidth
    const m = 6
    let top = a.bottom + m
    if (top + ph > window.innerHeight - m) top = Math.max(m, a.top - m - ph)
    let left = a.left
    if (left + pw > window.innerWidth - m) left = Math.max(m, window.innerWidth - m - pw)
    setCoords({ top, left })
  }, [anchorRef, data])

  return createPortal(
    <div
      ref={popRef}
      role="tooltip"
      style={{
        position: 'fixed',
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        visibility: coords ? 'visible' : 'hidden',
      }}
      className="z-50 max-w-sm rounded-xl border border-amber-300/70 bg-surface p-3.5 text-sm leading-relaxed text-ink shadow-xl dark:border-amber-500/40"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
        Внутренняя заметка
      </p>
      {data && data.length > 0 ? (
        <ul className="flex flex-col gap-2.5">
          {data.map((n) => (
            <li key={n.id}>
              <span className="text-sm font-semibold text-ink">{n.author_name}</span>
              <p className="whitespace-pre-wrap break-words text-sm text-ink">{n.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-sm text-muted">Загрузка…</span>
      )}
    </div>,
    document.body,
  )
}

export interface ThreadCommentCellProps {
  threadId: number
  hasComment: boolean
  className?: string
  children?: ReactNode
}

// ThreadCommentCell renders a grid <td> that, when it carries an internal note,
// shows the amber mark and surfaces the note text in a custom popup the instant
// the cell is hovered or focused — no system-tooltip delay, bigger and readable.
export function ThreadCommentCell({
  threadId,
  hasComment,
  className,
  children,
}: ThreadCommentCellProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLTableCellElement>(null)
  const show = hasComment ? () => setOpen(true) : undefined
  const hide = hasComment ? () => setOpen(false) : undefined
  return (
    <td
      ref={ref}
      className={cn(hasComment && 'relative', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {hasComment ? <CommentMark /> : null}
      {hasComment && open ? <CommentPopup anchorRef={ref} threadId={threadId} /> : null}
    </td>
  )
}
