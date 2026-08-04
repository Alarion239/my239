import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-10 w-full rounded-md border bg-surface px-3 text-sm text-text placeholder:text-text-subtle transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:border-selected-border',
          invalid ? 'border-danger' : 'border-border-control',
          className,
        )}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'
