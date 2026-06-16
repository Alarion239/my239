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
          'h-10 w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-faint transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent',
          invalid ? 'border-danger' : 'border-line-strong',
          className,
        )}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'
