import { Plus, Trash2 } from 'lucide-react'
import { MAX_SUBPARTS } from '@my239/shared'
import { cn } from '../../design/cn'
import { Button } from '../../design/ui'
import { MAX_PROBLEMS, type ProblemDraft } from './problem-builder-model'

function renumber(problems: ProblemDraft[]): ProblemDraft[] {
  return problems.map((problem, index) => ({ ...problem, number: index + 1 }))
}

export interface ProblemBuilderProps {
  value: ProblemDraft[]
  onChange: (next: ProblemDraft[]) => void
  disabled?: boolean
}

// Problems are created as individual cards, matching the editing rhythm of the
// razbor workbench without importing grading colours or coffin affordances.
export function ProblemBuilder({ value, onChange, disabled = false }: ProblemBuilderProps) {
  const exercise = value.find((problem) => problem.number === 0)
  const regular = value.filter((problem) => problem.number !== 0)

  const keyFor = (problem: ProblemDraft) =>
    problem.id ? 'id-' + problem.id : 'number-' + problem.number

  const updateSubparts = (problem: ProblemDraft, count: number) => {
    const clamped = Math.max(0, Math.min(MAX_SUBPARTS, count))
    onChange(value.map((candidate) =>
      candidate === problem ? { ...candidate, subproblem_count: clamped } : candidate,
    ))
  }

  const remove = (problem: ProblemDraft) => {
    const remaining = value.filter((candidate) => candidate !== problem)
    const remainingExercise = remaining.find((candidate) => candidate.number === 0)
    const remainingRegular = renumber(remaining.filter((candidate) => candidate.number !== 0))
    onChange([...(remainingExercise ? [remainingExercise] : []), ...remainingRegular])
  }

  const addProblem = () => {
    if (regular.length >= MAX_PROBLEMS) return
    onChange([
      ...(exercise ? [exercise] : []),
      ...regular,
      { number: regular.length + 1, subproblem_count: 0 },
    ])
  }

  const addExercise = () => {
    if (exercise) return
    onChange([{ number: 0, subproblem_count: 0 }, ...renumber(regular)])
  }

  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-control px-4 py-8 text-center text-sm text-muted">
          Задач пока нет
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {[...(exercise ? [exercise] : []), ...regular].map((problem) => {
          const key = keyFor(problem)
          const isExercise = problem.number === 0
          const label = isExercise ? 'Упражнение' : 'Задача ' + problem.number
          const target = isExercise ? 'упражнение' : 'задачу ' + problem.number
          return (
            <li key={key} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2.5">
              <p className="w-24 shrink-0 text-base font-medium text-text">{label}</p>
              <SubpartSquares
                label={label}
                count={problem.subproblem_count}
                disabled={disabled}
                onChange={(count) => updateSubparts(problem, count)}
              />
              <IconButton
                label={'Удалить ' + target}
                disabled={disabled}
                danger
                onClick={() => remove(problem)}
              >
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </li>
          )
        })}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={addProblem}
          disabled={disabled || regular.length >= MAX_PROBLEMS}
        >
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          Добавить задачу
        </Button>
        {!exercise ? (
          <Button type="button" size="sm" variant="ghost" onClick={addExercise} disabled={disabled}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Добавить упражнение
          </Button>
        ) : null}
      </div>
    </div>
  )
}

// Six letters stay visible as the compact default. Selecting the current last
// letter reveals the next one, so unusually long problems can still grow up to
// the backend's alphabet limit without filling every ordinary row with a–z.
function SubpartSquares({
  label,
  count,
  disabled,
  onChange,
}: {
  label: string
  count: number
  disabled: boolean
  onChange: (count: number) => void
}) {
  const visibleCount = Math.min(MAX_SUBPARTS, Math.max(6, count >= 6 ? count + 1 : 6))
  return (
    <div
      className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="group"
      aria-label={'Подзадачи · ' + label}
    >
      {Array.from({ length: visibleCount }, (_, index) => {
        const nextCount = index + 1
        const letter = String.fromCharCode(97 + index)
        const selected = nextCount <= count
        return (
          <button
            key={letter}
            type="button"
            aria-label={label + ', подзадача ' + letter}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(nextCount === count ? 0 : nextCount)}
            className={cn(
              'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40',
              selected
                ? 'border-action bg-action text-on-action'
                : 'border-border-control bg-surface text-muted hover:border-selected-border hover:text-text',
            )}
          >
            {letter}
          </button>
        )
      })}
    </div>
  )
}

function IconButton({
  label,
  disabled,
  danger = false,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40',
        danger ? 'hover:bg-danger-soft hover:text-danger' : 'hover:bg-surface-subtle hover:text-text',
      )}
    >
      {children}
    </button>
  )
}
