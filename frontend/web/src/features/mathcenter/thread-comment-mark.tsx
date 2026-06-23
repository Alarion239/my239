import { useState } from 'react'
import { useThreadNotes } from '@my239/shared'

// ThreadCommentMark is the corner flag on a grid cell whose thread carries an
// internal teacher note. The note text is fetched lazily on hover/focus and
// surfaced through the native tooltip (title), which never clips inside the
// scrolling grid. aria-label exposes the same text to keyboard/screen-reader
// users on focus. Render inside a `relative` cell.
export function ThreadCommentMark({ threadId }: { threadId: number }) {
  const [enabled, setEnabled] = useState(false)
  const { data } = useThreadNotes(threadId, enabled)
  const text =
    data && data.length > 0
      ? data.map((n) => n.author_name + ': ' + n.body).join('\n\n')
      : 'Внутренний комментарий'
  return (
    <span
      tabIndex={0}
      title={text}
      aria-label={'Внутренний комментарий. ' + text}
      onMouseEnter={() => setEnabled(true)}
      onFocus={() => setEnabled(true)}
      className="absolute right-0.5 top-0.5 h-0 w-0 border-l-[7px] border-t-[7px] border-l-transparent border-t-amber-500 focus-visible:outline-none"
    />
  )
}
