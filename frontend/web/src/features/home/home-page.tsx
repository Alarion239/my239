import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '../../auth/auth-context'
import { useNavModules } from '../../shell/use-nav-modules'
import { Card } from '../../design/ui'
import { cn } from '../../design/cn'

export function HomePage() {
  const { user } = useAuth()
  const modules = useNavModules()
  if (!user) return null

  return (
    <div>
      <h1 className="font-display text-3xl font-medium text-text">
        Здравствуйте, {user.first_name}
      </h1>
      <p className="mt-1 text-muted">Выберите модуль, чтобы начать.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {modules
          .filter((m) => !m.adminOnly || user.is_admin)
          .map((m) => {
          const soon = m.status === 'soon'
          const inner = (
            <Card
              className={cn(
                'group h-full p-5 transition-colors',
                soon ? 'opacity-60' : 'hover:border-border-control hover:bg-surface-subtle',
              )}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-selected text-selected-text">
                <m.icon className="h-5 w-5" aria-hidden />
              </div>
              <div className="mt-4 flex items-center gap-2">
                <h2 className="text-lg font-medium text-text">{m.label}</h2>
                {soon ? (
                  <span className="text-[10px] uppercase tracking-wide text-text-subtle">скоро</span>
                ) : (
                  <ArrowRight
                    className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                )}
              </div>
              <p className="mt-1 text-sm text-muted">{m.description}</p>
            </Card>
          )
          return soon ? (
            <div key={m.id} aria-disabled>
              {inner}
            </div>
          ) : (
            <Link key={m.id} to={m.path} className="block">
              {inner}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
