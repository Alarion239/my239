import type { ReactNode } from 'react'
import { cn } from '../cn'

export interface PillTabOption<T extends string> {
  id: T
  label: ReactNode
}

// PillTabs is the app's one segmented tab switch: a rounded-full pill row with
// an accent-soft active pill. Shared by the series (student + teacher) tabs and
// the management panel so every tab switch looks and behaves identically. On
// narrow screens the row scrolls horizontally rather than wrapping.
export function PillTabs<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: readonly PillTabOption<T>[]
  ariaLabel: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'inline-flex max-w-full overflow-x-auto rounded-full border border-line bg-surface-muted p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      role="tablist"
      aria-label={ariaLabel}
    >
      {options.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            value === t.id
              ? 'bg-accent-soft text-accent-ink'
              : 'text-muted hover:text-ink',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
