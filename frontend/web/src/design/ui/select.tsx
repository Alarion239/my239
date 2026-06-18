import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cn } from '../cn'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

// Select is a native <select> styled to match Input. Native is the right call
// here: short option lists, accessible by default, and no extra Radix surface.
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, ...props }, ref) => {
    return (
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-10 w-full rounded-lg border bg-surface px-3 text-sm text-ink transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent',
          invalid ? 'border-danger' : 'border-line-strong',
          className,
        )}
        {...props}
      />
    )
  },
)
Select.displayName = 'Select'
