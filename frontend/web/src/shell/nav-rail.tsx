import { NavLink } from 'react-router-dom'
import { User as UserIcon, type LucideIcon } from 'lucide-react'
import { cn } from '../design/cn'
import { useAuth } from '../auth/auth-context'
import { modules } from './modules'

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

// NavRail is the persistent left navigation on md+ screens. It switches between
// modules; each module's own pages live as tabs in the top bar. On small screens
// it is hidden and TopBar provides a dropdown nav instead. The brand lives in the
// top bar (on all widths), so the rail does not repeat it.
export function NavRail() {
  const { user } = useAuth()
  const isAdmin = !!user?.is_admin
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 md:flex">
      <p className="mb-1 px-2.5 text-xs text-faint">Модули</p>
      <nav className="flex flex-col gap-0.5">
        {modules
          .filter((m) => !m.adminOnly || isAdmin)
          .map((m) =>
            m.status === 'active' ? (
              // A module NavItem links to its base path. The router redirects
              // base paths with sub-pages (e.g. /admin → /admin/users), so the
              // rail item should not require an exact match to stay highlighted.
              <NavItem key={m.id} to={m.path} icon={m.icon} label={m.label} />
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
