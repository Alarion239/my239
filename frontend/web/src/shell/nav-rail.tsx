import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, Clock3, User as UserIcon, type LucideIcon } from 'lucide-react'
import { useMathCenterTerms } from '@my239/shared'
import { cn } from '../design/cn'
import { useAuth } from '../auth/auth-context'
import { useNavModules } from './use-nav-modules'
import type { ModuleDef } from './modules'

function NavItem({
  to,
  icon: Icon,
  label,
  end,
}: {
  to: string
  icon: LucideIcon
  label: string
  end?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors',
          isActive
            ? 'bg-accent-soft font-medium text-accent-ink'
            : 'text-muted hover:bg-surface-muted hover:text-ink',
        )
      }
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden />
      <span>{label}</span>
    </NavLink>
  )
}

// MathCenterNavItem makes the left rail the single place for choosing both a
// cohort and its period. The first click enters that cohort; clicking its
// already-active entry reveals the year/camp archive beneath it.
function MathCenterNavItem({ module }: { module: ModuleDef }) {
  const { pathname, search } = useLocation()
  const [archiveOpen, setArchiveOpen] = useState(false)
  const isCurrentCenter = pathname === module.path || pathname.startsWith(module.path + '/')
  const terms = useMathCenterTerms(module.centerId ?? 0, isCurrentCenter && archiveOpen)
  const selectedTermID = Number(new URLSearchParams(search).get('term_id'))

  return (
    <div>
      <NavLink
        to={module.path}
        onClick={(event) => {
          if (!isCurrentCenter) return
          event.preventDefault()
          setArchiveOpen((open) => !open)
        }}
        aria-expanded={isCurrentCenter ? archiveOpen : undefined}
        aria-controls={isCurrentCenter ? 'mathcenter-periods-' + module.centerId : undefined}
        className={cn(
          'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors',
          isCurrentCenter
            ? 'bg-accent-soft font-medium text-accent-ink'
            : 'text-muted hover:bg-surface-muted hover:text-ink',
        )}
      >
        <module.icon className="h-[18px] w-[18px]" aria-hidden />
        <span>{module.label}</span>
        {isCurrentCenter ? (
          <ChevronDown
            className={cn('ml-auto h-4 w-4 transition-transform', archiveOpen && 'rotate-180')}
            aria-hidden
          />
        ) : null}
      </NavLink>

      {isCurrentCenter && archiveOpen ? (
        <div
          id={'mathcenter-periods-' + module.centerId}
          className="mx-2.5 mt-1 border-l border-line pl-3"
          aria-label="Периоды матцентра"
        >
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-faint">Архив</p>
          {terms.isPending ? <p className="py-1 text-xs text-faint">Загрузка…</p> : null}
          {terms.isError ? <p className="py-1 text-xs text-danger">Не удалось загрузить периоды.</p> : null}
          {terms.data?.map((term) => {
            const selected = term.id === selectedTermID || (!selectedTermID && term.is_active)
            return (
              <NavLink
                key={term.id}
                to={module.path + '/series?term_id=' + term.id}
                onClick={() => setArchiveOpen(false)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                  selected
                    ? 'bg-surface-muted font-medium text-ink'
                    : 'text-muted hover:bg-surface-muted hover:text-ink',
                )}
              >
                <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{term.display_name}</span>
                {term.is_active ? <span className="ml-auto text-[10px] text-faint">сейчас</span> : null}
              </NavLink>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

// NavRail is the persistent left navigation on md+ screens. It switches between
// modules; each module's own pages live as tabs in the top bar. On small screens
// it is hidden and TopBar provides a dropdown nav instead. The brand lives in the
// top bar (on all widths), so the rail does not repeat it.
export function NavRail({ open = true }: { open?: boolean }) {
  const { user } = useAuth()
  const isAdmin = !!user?.is_admin
  const modules = useNavModules()
  return (
    <aside
      id="desktop-nav-rail"
      className={cn(
        'sticky top-0 hidden h-screen w-60 shrink-0 flex-col self-start overflow-y-auto border-r border-line bg-surface px-3 py-5',
        open && 'md:flex',
      )}
    >
      <p className="mb-1 px-2.5 text-xs text-faint">Модули</p>
      <nav className="flex flex-col gap-0.5">
        {modules
          .filter((m) => !m.adminOnly || isAdmin)
          .map((m) =>
            m.status === 'active' ? (
              m.centerId ? (
                <MathCenterNavItem key={m.id} module={m} />
              ) : (
                // A module NavItem links to its base path. The router redirects
                // base paths with sub-pages (e.g. /admin → /admin/users), so the
                // rail item should not require an exact match to stay highlighted.
                <NavItem key={m.id} to={m.path} icon={m.icon} label={m.label} />
              )
            ) : (
              <div
                key={m.id}
                className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-faint"
              >
                <m.icon className="h-[18px] w-[18px]" aria-hidden />
                <span>{m.label}</span>
                <span className="ml-auto text-[10px] uppercase tracking-wide">скоро</span>
              </div>
            ),
          )}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5 border-t border-line pt-3">
        <NavItem to="/profile" icon={UserIcon} label="Профиль" end />
      </div>
    </aside>
  )
}
