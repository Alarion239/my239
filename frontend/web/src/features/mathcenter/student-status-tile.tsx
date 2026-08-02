import type { HomeworkStatus } from '@my239/shared'
import { cn } from '../../design/cn'
import { studentStatusMeta, studentStatusToneClasses } from './student-status'

export function StudentStatusTile({
  status,
  identifier,
  className,
}: {
  status: HomeworkStatus
  identifier: string
  className?: string
}) {
  const meta = studentStatusMeta(status)
  const accessibleLabel = identifier + ': ' + meta.label
  return (
    <span
      role="img"
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className={cn(
        'inline-flex min-h-11 min-w-11 w-full shrink-0 items-center justify-center rounded-md text-base font-semibold leading-none select-none',
        studentStatusToneClasses(meta.tone),
        className,
      )}
    >
      <span aria-hidden>{identifier}</span>
    </span>
  )
}
