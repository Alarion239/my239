import type { ReactNode } from 'react'
import { Card, CardContent } from '../../design/ui'

// Centered, paper-on-paper layout for the public auth screens (login/register).
export function AuthLayout({
  subtitle,
  children,
  footer,
}: {
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-sm animate-rise">
        <div className="mb-6 text-center">
          <div className="font-display text-3xl font-medium tracking-tight text-ink">my239</div>
          {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
        </div>
        <Card>
          <CardContent className="pt-6">{children}</CardContent>
        </Card>
        {footer ? <p className="mt-4 text-center text-sm text-muted">{footer}</p> : null}
      </div>
    </div>
  )
}
