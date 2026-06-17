import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Eye, LogOut, ShieldCheck, User as UserIcon } from 'lucide-react'
import { fullName, initials, useLogout, type User } from '@my239/shared'
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../design/ui'
import { useCapabilities } from '../auth/use-capabilities'
import { ImpersonationPicker } from './impersonation-picker'

export function UserMenu({ user }: { user: User }) {
  const navigate = useNavigate()
  const logout = useLogout()
  const { canImpersonate } = useCapabilities()
  const [pickerOpen, setPickerOpen] = useState(false)

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSettled: () => navigate('/login', { replace: true }),
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          aria-label="Меню пользователя"
        >
          <Avatar initials={initials(user)} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="block text-sm font-medium text-ink">{fullName(user)}</span>
          <span className="block text-xs text-faint">@{user.username}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile">
            <UserIcon className="h-4 w-4" aria-hidden />
            Профиль
          </Link>
        </DropdownMenuItem>
        {user.is_admin ? (
          <DropdownMenuItem asChild>
            <Link to="/admin">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Администрирование
            </Link>
          </DropdownMenuItem>
        ) : null}
        {canImpersonate ? (
          <DropdownMenuItem onSelect={() => setPickerOpen(true)}>
            <Eye className="h-4 w-4" aria-hidden />
            Просмотр от имени…
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={handleLogout}>
          <LogOut className="h-4 w-4" aria-hidden />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
      {canImpersonate ? (
        <ImpersonationPicker open={pickerOpen} onOpenChange={setPickerOpen} />
      ) : null}
    </DropdownMenu>
  )
}
