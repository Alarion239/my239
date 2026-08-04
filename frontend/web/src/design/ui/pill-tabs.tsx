import type { ReactNode } from 'react'
import { cn } from '../cn'

export interface PillTabOption<T extends string> {
  id: T
  label: ReactNode
}

// PillTabs is the app's one segmented tab switch: a compact segmented row with
// a selected active segment. Shared by the series (student + teacher) tabs and
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
        'inline-flex max-w-full overflow-x-auto rounded-md border border-border bg-surface-subtle p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
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
            'whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
            value === t.id
              ? 'bg-selected text-selected-text'
              : 'text-muted hover:text-text',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
