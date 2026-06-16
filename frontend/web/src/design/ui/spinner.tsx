import { Loader2 } from 'lucide-react'
import { cn } from '../cn'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-muted', className)} aria-hidden />
}

// FullPageSpinner centers a spinner over the whole viewport — used by route
// guards while the session is resolving.
export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Загрузка">
      <Spinner className="h-7 w-7" />
    </div>
  )
}
