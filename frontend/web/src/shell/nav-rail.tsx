import { NavLink, Link } from 'react-router-dom'
import { ShieldCheck, User as UserIcon, type LucideIcon } from 'lucide-react'
import { cn } from '../design/cn'
import { useAuth } from '../auth/auth-context'
import { modules } from './modules'

function NavItem({
  to,
  icon: Icon,
  label,
}: {
  to: string
  icon: LucideIcon
  label: string
}) {
  return (
    <NavLink
      to={to}
      end
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

// NavRail is the persistent left navigation on md+ screens. On small screens it
// is hidden; TopBar provides a dropdown nav instead.
export function NavRail() {
  const { user } = useAuth()
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 md:flex">
      <Link
        to="/"
        className="mb-5 px-2 font-display text-2xl font-medium tracking-tight text-ink"
      >
        my239
      </Link>

      <p className="mb-1 px-2.5 text-xs text-faint">Модули</p>
      <nav className="flex flex-col gap-0.5">
        {modules.map((m) =>
          m.status === 'active' ? (
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
        <NavItem to="/profile" icon={UserIcon} label="Профиль" />
        {user?.is_admin ? (
          <NavItem to="/admin" icon={ShieldCheck} label="Администрирование" />
        ) : null}
      </div>
    </aside>
  )
}
