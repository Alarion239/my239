import type { LucideIcon } from 'lucide-react'
import { Card } from '../design/ui'

// PlaceholderPage is the "module not built yet" stand-in. Reused by the Math
// Center and Admin routes until their real screens land, so the shell, nav, and
// routing can be exercised end to end now.
export function PlaceholderPage({
  title,
  description,
  icon: Icon,
}: {
  title: string
  description: string
  icon: LucideIcon
}) {
  return (
    <div className="animate-rise">
      <h1 className="mb-6 font-display text-3xl font-medium text-ink">{title}</h1>
      <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
          <Icon className="h-6 w-6" aria-hidden />
        </div>
        <p className="max-w-sm text-muted">{description}</p>
      </Card>
    </div>
  )
}
