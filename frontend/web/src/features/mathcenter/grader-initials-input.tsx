import { useMemo, useState } from 'react'
import { useCenterTeachers, type CenterTeacher } from '@my239/shared'
import { Input } from '../../design/ui'

// CreditedGrader is who an offline accept is attributed to: a resolved teacher
// (userId set) or a free-text, unregistered grader (userId null).
export interface CreditedGrader {
  userId: number | null
  name: string
}

export const emptyGrader: CreditedGrader = { userId: null, name: '' }

// GraderInitialsInput is the «кондуит» initials field: the grader types their
// initials (or name) and it autocompletes against the center's teachers. An
// exact initials match auto-resolves to that registered teacher; anything else
// is kept as a free-text credit so an unregistered grader still works.
export function GraderInitialsInput({
  centerId,
  value,
  onChange,
  autoFocus,
  placeholder = 'Инициалы проверяющего…',
}: {
  centerId: number
  value: CreditedGrader
  onChange: (g: CreditedGrader) => void
  autoFocus?: boolean
  placeholder?: string
}) {
  const { data } = useCenterTeachers(centerId)
  const teachers = useMemo(() => data ?? [], [data])
  const [text, setText] = useState(value.name)
  const [focused, setFocused] = useState(false)

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase()
    if (!q) return teachers.slice(0, 8)
    return teachers
      .filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.initials.toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [teachers, text])

  function handleType(next: string) {
    setText(next)
    const q = next.trim()
    // Auto-resolve when the typed text is exactly a teacher's initials.
    const exact = teachers.find(
      (t) => t.initials.toLowerCase() === q.toLowerCase(),
    )
    onChange(exact ? { userId: exact.user_id, name: exact.name } : { userId: null, name: q })
  }

  function pick(t: CenterTeacher) {
    setText(t.initials)
    onChange({ userId: t.user_id, name: t.name })
    setFocused(false)
  }

  return (
    <div className="relative">
      <Input
        value={text}
        onChange={(e) => handleType(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        placeholder={placeholder}
        aria-label="Инициалы проверяющего"
        autoFocus={autoFocus}
      />
      {value.userId != null ? (
        <span className="mt-1 block text-xs text-status-accepted">↳ {value.name}</span>
      ) : value.name.trim() ? (
        <span className="mt-1 block text-xs text-muted">
          ↳ {value.name} · не зарегистрирован
        </span>
      ) : null}
      {focused && matches.length > 0 ? (
        <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-line bg-surface shadow-lg">
          {matches.map((t) => (
            <li key={t.user_id}>
              <button
                type="button"
                // onMouseDown (not onClick) so the pick fires before the input's
                // blur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(t)
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-muted"
              >
                <span className="text-ink">{t.name}</span>
                <span className="text-xs font-medium text-muted">{t.initials}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
