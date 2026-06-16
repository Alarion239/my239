import { Link, NavLink } from 'react-router-dom'
import { Menu, ShieldCheck, User as UserIcon } from 'lucide-react'
import type { User } from '@my239/shared'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ThemeToggle,
} from '../design/ui'
import { modules } from './modules'
import { UserMenu } from './user-menu'

// MobileNav mirrors the rail's links in a dropdown for small screens.
function MobileNav({ user }: { user: User }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Меню навигации">
          <Menu className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {modules
          .filter((m) => m.status === 'active')
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
        {user.is_admin ? (
          <DropdownMenuItem asChild>
            <NavLink to="/admin">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Администрирование
            </NavLink>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TopBar({ user }: { user: User }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-paper/80 px-4 backdrop-blur">
      <MobileNav user={user} />
      <Link to="/" className="font-display text-xl font-medium text-ink md:hidden">
        my239
      </Link>
      <div className="flex-1" />
      <ThemeToggle />
      <UserMenu user={user} />
    </header>
  )
}
