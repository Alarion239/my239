import { Link, NavLink, useLocation } from 'react-router-dom'
import { Menu, User as UserIcon } from 'lucide-react'
import { useCoffinQueue, useGraderStats, type User } from '@my239/shared'
import { cn } from '../design/cn'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  NotificationBadge,
  ThemeToggle,
} from '../design/ui'
import { activeNavModule } from './modules'
import { useNavModules } from './use-nav-modules'
import { UserMenu } from './user-menu'

// MobileNav mirrors the rail's links in a dropdown for small screens. It switches
// BETWEEN modules; a module's own pages render as tabs in the bar.
function MobileNav({ user }: { user: User }) {
  const modules = useNavModules()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Меню навигации">
          <Menu className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {modules
          .filter((m) => m.status === 'active' && (!m.adminOnly || user.is_admin))
          .map((m) => (
            <DropdownMenuItem key={m.id} asChild>
              <NavLink to={m.path}>
                <m.icon className="h-4 w-4" aria-hidden />
                {m.label}
              </NavLink>
            </DropdownMenuItem>
          ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <NavLink to="/profile">
            <UserIcon className="h-4 w-4" aria-hidden />
            Профиль
          </NavLink>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ModuleTabs renders the active module's pages as horizontal NavLink tabs to the
// right of the brand. macOS-like: the module's screens live in the top bar.
function ModuleTabs({ user }: { user: User }) {
  const { pathname } = useLocation()
  const mod = activeNavModule(useNavModules(), pathname, user.is_admin)
  const pages = mod?.pages
  const centerId = mod?.canGrade ? (mod.centerId ?? 0) : 0
  const graderStats = useGraderStats(centerId)
  const coffinQueue = useCoffinQueue(centerId)
  if (!pages || pages.length === 0) return null

  return (
    <nav className="flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Разделы модуля">
      {pages.map((p) => (
        <NavLink
          key={p.path}
          to={p.path}
          end={p.end}
          className={({ isActive }) =>
            cn(
              'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors',
              isActive
                ? 'bg-accent-soft font-medium text-accent-ink'
                : 'text-muted hover:bg-surface-muted hover:text-ink',
            )
          }
        >
          {p.label}
          {p.notification === 'series-queue' ? (
            <NotificationBadge count={graderStats.data?.pending_count ?? 0} label="Очередь серий" />
          ) : null}
          {p.notification === 'coffin-queue' ? (
            <NotificationBadge count={coffinQueue.data?.length ?? 0} label="Очередь гробов" />
          ) : null}
        </NavLink>
      ))}
    </nav>
  )
}

export function TopBar({
  user,
  navOpen,
  onBrandClick,
}: {
  user: User
  navOpen?: boolean
  onBrandClick?: () => void
}) {
  const { pathname } = useLocation()
  const isConduit = pathname.endsWith('/conduit')

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-paper/80 px-4 backdrop-blur">
      <MobileNav user={user} />
      <Link
        to="/"
        onClick={
          onBrandClick
            ? (e) => {
                e.preventDefault()
                onBrandClick()
              }
            : undefined
        }
        aria-expanded={navOpen}
        aria-controls={navOpen == null ? undefined : 'desktop-nav-rail'}
        className="shrink-0 rounded-md font-display text-xl font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        my239
      </Link>
      <ModuleTabs user={user} />
      {isConduit ? (
        <div
          id="conduit-toolbar-slot"
          className="flex min-w-0 flex-1 items-center justify-end overflow-visible"
        />
      ) : (
        <div className="flex-1" />
      )}
      <ThemeToggle />
      <UserMenu user={user} />
    </header>
  )
}
