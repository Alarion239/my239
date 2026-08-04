import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cn } from '../cn'

// Avatar renders initials on the selected chip. We have no photo URLs yet,
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
        'inline-flex h-10 w-10 select-none items-center justify-center overflow-hidden rounded-full bg-selected',
        className,
      )}
    >
      <AvatarPrimitive.Fallback className="font-medium text-selected-text">
        {initials}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}
