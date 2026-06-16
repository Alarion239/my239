import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cn } from '../cn'

// Avatar renders initials on the accent-soft chip. We have no photo URLs yet,
// so this is initials-only; add AvatarPrimitive.Image later when we do.
export function Avatar({
  initials,
  className,
}: {
  initials: string
  className?: string
}) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        'inline-flex h-10 w-10 select-none items-center justify-center overflow-hidden rounded-full bg-accent-soft',
        className,
      )}
    >
      <AvatarPrimitive.Fallback className="font-medium text-accent-ink">
        {initials}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}
