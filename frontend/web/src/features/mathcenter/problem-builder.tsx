import { Minus, Plus } from 'lucide-react'
import { MAX_SUBPARTS } from '@my239/shared'
import { cn } from '../../design/cn'
import { MAX_PROBLEMS, MIN_PROBLEMS, type ProblemDraft } from './problem-builder-model'

// renumber rewrites only regular positional numbers to 1..N. The optional
// exercise is kept outside this sequence so changing the slider cannot rename
// or delete it.
function renumber(problems: ProblemDraft[]): ProblemDraft[] {
  return problems.map((p, i) => ({ ...p, number: i + 1 }))
}

// subpartHint reads the resulting subpart letters back to the teacher: "a–c"
// for three parts, or a hint that there are none.
function subpartHint(count: number, prefix = ''): string {
  if (count <= 0) return 'без подзадач'
  if (count === 1) return 'подзадача ' + prefix + 'a'
  return prefix + 'a–' + prefix + String.fromCharCode(96 + Math.min(count, MAX_SUBPARTS))
}

export interface ProblemBuilderProps {
  value: ProblemDraft[]
  onChange: (next: ProblemDraft[]) => void
}

// ProblemBuilder is the optional exercise toggle plus the regular-problem
// slider and per-problem steppers. Growth and shrink happen at the regular tail,
// so the exercise and leading regular problems survive edits with their ids.
export function ProblemBuilder({ value, onChange }: ProblemBuilderProps) {
  const exercise = value.find((p) => p.number === 0)
  const regular = value.filter((p) => p.number !== 0)
  // Never let the slider's upper bound silently drop existing regular problems.
  const sliderMax = Math.max(MAX_PROBLEMS, regular.length)

  const setExercise = (enabled: boolean) => {
    if (enabled) {
      onChange([
        { number: 0, subproblem_count: 0 },
        ...renumber(regular),
      ])
    } else {
      onChange(renumber(regular))
    }
  }

  const setCount = (n: number) => {
    const next = Math.max(MIN_PROBLEMS, Math.min(sliderMax, n))
    if (next === regular.length) return
    let nextRegular: ProblemDraft[]
    if (next > regular.length) {
      const added = Array.from({ length: next - regular.length }, () => ({
        number: 0,
        subproblem_count: 0,
      }))
      nextRegular = [...regular, ...added]
    } else {
      nextRegular = regular.slice(0, next)
    }
    onChange([...(exercise ? [exercise] : []), ...renumber(nextRegular)])
  }

  const setSubcount = (problem: ProblemDraft, n: number) => {
    const clamped = Math.max(0, Math.min(MAX_SUBPARTS, n))
    onChange(value.map((p) => (p === problem ? { ...p, subproblem_count: clamped } : p)))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-accent/30 bg-accent-soft/50 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-accent-ink">Упражнение</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!exercise}
            aria-label={exercise ? 'Убрать упражнение' : 'Добавить упражнение'}
            onClick={() => setExercise(!exercise)}
            className={cn(
              'relative inline-flex h-6 w-10 shrink-0 rounded-full border transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              exercise ? 'border-accent bg-accent' : 'border-line-strong bg-surface-muted',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-0.5 h-5 w-5 rounded-full transition-transform',
                exercise ? 'translate-x-4 bg-white' : 'translate-x-0.5 bg-faint',
              )}
            />
          </button>
        </div>
        {exercise ? (
          <ProblemRow
            problem={exercise}
            label="Упражнение"
            subpartPrefix="У"
            removeTarget="упражнения"
            addTarget="упражнению"
            onMinus={() => setSubcount(exercise, exercise.subproblem_count - 1)}
            onPlus={() => setSubcount(exercise, exercise.subproblem_count + 1)}
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="problem-count" className="text-sm font-medium text-ink">
            Сколько задач
          </label>
          <span className="text-sm font-semibold text-ink tabular-nums">{regular.length}</span>
        </div>
        <input
          id="problem-count"
          type="range"
          min={MIN_PROBLEMS}
          max={sliderMax}
          value={regular.length}
          onChange={(e) => setCount(Number(e.target.value))}
          aria-label="Количество задач"
          className="w-full accent-accent"
        />
      </div>

      <ul className="flex flex-col gap-2">
        {regular.map((p) => (
          <ProblemRow
            key={p.id ?? 'new-' + p.number}
            problem={p}
            label={'Задача ' + p.number}
            removeTarget={'задачи ' + p.number}
            addTarget={'задаче ' + p.number}
            onMinus={() => setSubcount(p, p.subproblem_count - 1)}
            onPlus={() => setSubcount(p, p.subproblem_count + 1)}
          />
        ))}
      </ul>
    </div>
  )
}

function ProblemRow({
  problem,
  label,
  subpartPrefix,
  removeTarget,
  addTarget,
  onMinus,
  onPlus,
}: {
  problem: ProblemDraft
  label: string
  subpartPrefix?: string
  removeTarget: string
  addTarget: string
  onMinus: () => void
  onPlus: () => void
}) {
  return (
    <li className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2">
      <div className="min-w-0">
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className="ml-2 text-xs text-faint">
          {subpartHint(problem.subproblem_count, subpartPrefix)}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Stepper
          ariaLabel={'Убрать подзадачу у ' + removeTarget}
          onClick={onMinus}
          disabled={problem.subproblem_count <= 0}
          icon={<Minus className="h-4 w-4" aria-hidden />}
        />
        <span className="w-6 text-center text-sm font-medium text-ink tabular-nums">
          {problem.subproblem_count}
        </span>
        <Stepper
          ariaLabel={'Добавить подзадачу к ' + addTarget}
          onClick={onPlus}
          disabled={problem.subproblem_count >= MAX_SUBPARTS}
          icon={<Plus className="h-4 w-4" aria-hidden />}
        />
      </div>
    </li>
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
