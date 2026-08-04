import type { CSSProperties } from 'react'
import { cn } from '../../design/cn'

export const STUDENT_NAME_COLOR_OPTIONS = [
  { value: null, label: 'Без цвета', swatch: '#ffffff' },
  { value: '#FFF0A6', label: 'Жёлтый', swatch: '#FFF0A6' },
  { value: '#FFD09A', label: 'Оранжевый', swatch: '#FFD09A' },
  { value: '#F3A0A8', label: 'Красный', swatch: '#F3A0A8' },
  { value: '#7F1D2D', label: 'Тёмно-красный', swatch: '#7F1D2D' },
] as const

export type StudentNameColor = string | null

function luminance(hex: string): number {
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255)
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

export function normalizedStudentNameColor(value: string | null | undefined): string | null {
  const candidate = value?.trim()
  if (!candidate || !/^#[0-9a-f]{6}$/i.test(candidate)) return null
  return candidate.toUpperCase()
}

export function studentNameColorStyle(value: string | null | undefined): CSSProperties | undefined {
  const hex = normalizedStudentNameColor(value)
  if (!hex) return undefined
  return {
    backgroundColor: hex,
    color: luminance(hex) > 0.179 ? '#171A22' : '#FFFFFF',
  }
}

export function StudentNameLabel({
  name,
  backgroundHex,
  className,
}: {
  name: string
  backgroundHex?: string | null
  className?: string
}) {
  return (
    <span
      className={cn('rounded px-1.5 py-0.5', className)}
      style={studentNameColorStyle(backgroundHex)}
      data-student-name-color={normalizedStudentNameColor(backgroundHex) ?? undefined}
    >
      {name}
    </span>
  )
}

export function StudentNameColorSelector({
  value,
  onChange,
  disabled = false,
  error,
}: {
  value: StudentNameColor | undefined
  onChange: (value: StudentNameColor) => void
  disabled?: boolean
  error?: string | null
}) {
  const normalized = normalizedStudentNameColor(value)
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-xs font-semibold uppercase tracking-wide text-muted">Цвет имени</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Цвет имени">
        {STUDENT_NAME_COLOR_OPTIONS.map((option) => {
          const selected = option.value === normalized || (option.value === null && normalized === null)
          return (
            <label
              key={option.label}
              className={cn(
                'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border-control px-2.5 py-1.5 text-xs font-medium text-text transition-colors',
                'hover:bg-surface-subtle focus-within:ring-2 focus-within:ring-focus',
                selected && 'border-selected-border bg-selected text-selected-text',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name="student-name-color"
                value={option.value ?? ''}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 rounded-full border border-black/20 dark:border-white/30"
                style={{ backgroundColor: option.swatch }}
              />
              {option.label}
            </label>
          )
        })}
      </div>
      {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
    </fieldset>
  )
}
