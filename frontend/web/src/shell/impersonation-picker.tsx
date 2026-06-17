import { useMemo, useState } from 'react'
import { fullName, useAdminUsers, type User } from '@my239/shared'
import { useImpersonation } from '../auth/impersonation-context'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Spinner,
} from '../design/ui'

interface ImpersonationPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ImpersonationPicker is the admin "View as" dialog: a text filter over the full
// user list; choosing a user starts impersonation and closes the dialog.
export function ImpersonationPicker({ open, onOpenChange }: ImpersonationPickerProps) {
  const { impersonate } = useImpersonation()
  const { data: users, isPending, isError } = useAdminUsers()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('ru-RU')
    const list = users ?? []
    if (!q) return list
    return list.filter(
      (u) =>
        fullName(u).toLocaleLowerCase('ru-RU').includes(q) ||
        u.username.toLocaleLowerCase('ru-RU').includes(q),
    )
  }, [users, query])

  const choose = (user: User) => {
    impersonate(user)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-lg">
        <DialogTitle>Просмотр от имени…</DialogTitle>
        <DialogDescription className="mt-1">
          Выберите пользователя, чтобы видеть приложение как он.
        </DialogDescription>

        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по имени или @логину"
          className="mt-4"
        />

        <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-line">
          {isPending ? (
            <div className="flex items-center justify-center py-8">
              <Spinner />
            </div>
          ) : isError ? (
            <p className="px-3 py-8 text-center text-sm text-muted">
              Не удалось загрузить список пользователей.
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">Ничего не найдено.</p>
          ) : (
            <ul>
              {filtered.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => choose(u)}
                    className="flex w-full flex-col items-start gap-0.5 border-b border-line px-3 py-2.5 text-left outline-none transition-colors last:border-0 hover:bg-surface-muted focus-visible:bg-surface-muted"
                  >
                    <span className="text-sm font-medium text-ink">{fullName(u)}</span>
                    <span className="text-xs text-faint">@{u.username}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
