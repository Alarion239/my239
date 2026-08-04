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
          'h-10 w-full rounded-md border bg-surface px-3 text-sm text-text transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:border-selected-border',
          invalid ? 'border-danger' : 'border-border-control',
          className,
        )}
        {...props}
      />
    )
  },
)
Select.displayName = 'Select'
