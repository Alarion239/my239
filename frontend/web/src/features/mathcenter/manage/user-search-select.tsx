import { useEffect, useState } from 'react'
import { fullName, useUserSearch, type UserSearchResult } from '@my239/shared'
import { Input, Spinner } from '../../../design/ui'

// UserSearchSelect is a debounced search box for picking an existing user to
// add as a teacher/student. It reports the chosen user via onSelect; the parent
// decides what to do with it (and renders the confirm/role controls).
export function UserSearchSelect({
  centerId,
  onSelect,
  placeholder = 'Поиск по имени или логину…',
}: {
  centerId: number
  onSelect: (user: UserSearchResult) => void
  placeholder?: string
}) {
  const [text, setText] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const id = setTimeout(() => setDebounced(text), 300)
    return () => clearTimeout(id)
  }, [text])

  const { data, isFetching } = useUserSearch(centerId, debounced)
  const results = data ?? []
  const showList = debounced.trim().length >= 2

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label="Поиск пользователя"
      />
      {showList ? (
        <div className="rounded-lg border border-line bg-surface">
          {isFetching ? (
            <div className="flex justify-center py-3">
              <Spinner />
            </div>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">Никого не найдено.</p>
          ) : (
            <ul className="max-h-56 overflow-auto">
              {results.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(u)
                      setText('')
                      setDebounced('')
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-muted"
                  >
                    <span className="text-ink">{fullName(u)}</span>
                    <span className="text-xs text-muted">@{u.username}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
