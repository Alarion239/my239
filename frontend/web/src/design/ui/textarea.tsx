import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '../cn'

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

// Textarea is the multi-line sibling of Input: same border, focus ring, and
// invalid styling, vertically resizable. Used by the submit / grade / appeal /
// retract forms.
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'min-h-24 w-full resize-y rounded-lg border bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent',
          invalid ? 'border-danger' : 'border-line-strong',
          className,
        )}
        {...props}
      />
    )
  },
)
Textarea.displayName = 'Textarea'
