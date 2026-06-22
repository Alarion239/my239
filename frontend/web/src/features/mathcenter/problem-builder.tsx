import { Minus, Plus } from 'lucide-react'
import { MAX_SUBPARTS } from '@my239/shared'
import { cn } from '../../design/cn'
import { MAX_PROBLEMS, MIN_PROBLEMS, type ProblemDraft } from './problem-builder-model'

// renumber rewrites positional numbers to 1..N, preserving each item's id and
// subproblem_count. Numbering is positional so an existing problem keeps its id
// while its displayed number follows its slot.
function renumber(problems: ProblemDraft[]): ProblemDraft[] {
  return problems.map((p, i) => ({ ...p, number: i + 1 }))
}

// subpartHint reads the resulting subpart letters back to the teacher: "a–c"
// for three parts, or a hint that there are none.
function subpartHint(count: number): string {
  if (count <= 0) return 'без подзадач'
  if (count === 1) return 'подзадача a'
  return 'a–' + String.fromCharCode(96 + Math.min(count, MAX_SUBPARTS))
}

export interface ProblemBuilderProps {
  value: ProblemDraft[]
  onChange: (next: ProblemDraft[]) => void
}

// ProblemBuilder is the slider + per-problem stepper editor: the slider sets how
// many problems the series has (auto-numbered 1..N), and each problem carries a
// −/+ stepper for its subproblem count (default 0). Growth and shrink happen at
// the tail, so leading problems — and their ids — survive an edit.
export function ProblemBuilder({ value, onChange }: ProblemBuilderProps) {
  // Never let the slider's upper bound silently drop existing problems: an
  // already-large series can edit above the normal cap.
  const sliderMax = Math.max(MAX_PROBLEMS, value.length)

  const setCount = (n: number) => {
    const next = Math.max(MIN_PROBLEMS, Math.min(sliderMax, n))
    if (next === value.length) return
    if (next > value.length) {
      const added = Array.from({ length: next - value.length }, () => ({
        number: 0,
        subproblem_count: 0,
      }))
      onChange(renumber([...value, ...added]))
    } else {
      onChange(renumber(value.slice(0, next)))
    }
  }

  const setSubcount = (i: number, n: number) => {
    const clamped = Math.max(0, Math.min(MAX_SUBPARTS, n))
    onChange(value.map((p, idx) => (idx === i ? { ...p, subproblem_count: clamped } : p)))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="problem-count" className="text-sm font-medium text-ink">
            Сколько задач
          </label>
          <span className="text-sm font-semibold text-ink tabular-nums">{value.length}</span>
        </div>
        <input
          id="problem-count"
          type="range"
          min={MIN_PROBLEMS}
          max={sliderMax}
          value={value.length}
          onChange={(e) => setCount(Number(e.target.value))}
          aria-label="Количество задач"
          className="w-full accent-accent"
        />
      </div>

      <ul className="flex flex-col gap-2">
        {value.map((p, i) => (
          <li
            key={p.id ?? 'new-' + i}
            className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2"
          >
            <div className="min-w-0">
              <span className="text-sm font-medium text-ink">Задача {p.number}</span>
              <span className="ml-2 text-xs text-faint">{subpartHint(p.subproblem_count)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Stepper
                ariaLabel={'Убрать подзадачу у задачи ' + p.number}
                onClick={() => setSubcount(i, p.subproblem_count - 1)}
                disabled={p.subproblem_count <= 0}
                icon={<Minus className="h-4 w-4" aria-hidden />}
              />
              <span className="w-6 text-center text-sm font-medium text-ink tabular-nums">
                {p.subproblem_count}
              </span>
              <Stepper
                ariaLabel={'Добавить подзадачу к задаче ' + p.number}
                onClick={() => setSubcount(i, p.subproblem_count + 1)}
                disabled={p.subproblem_count >= MAX_SUBPARTS}
                icon={<Plus className="h-4 w-4" aria-hidden />}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Stepper({
  ariaLabel,
  onClick,
  disabled,
  icon,
}: {
  ariaLabel: string
  onClick: () => void
  disabled: boolean
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink transition-colors',
        'hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      {icon}
    </button>
  )
}
