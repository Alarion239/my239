import { cn } from '../cn'

export function NotificationBadge({
  count,
  label = 'Уведомлений',
  className,
}: {
  count: number
  label?: string
  className?: string
}) {
  if (count <= 0) return null

  return (
    <span
      title={label + ': ' + count}
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-full bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold leading-none text-danger',
        className,
      )}
    >
      {count}
    </span>
  )
}
