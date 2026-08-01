import { useState } from 'react'
import { Check, Minus, Pencil, Plus, Trash2 } from 'lucide-react'
import { MAX_SUBPARTS } from '@my239/shared'
import { cn } from '../../design/cn'
import { Button } from '../../design/ui'
import { MAX_PROBLEMS, type ProblemDraft } from './problem-builder-model'

function renumber(problems: ProblemDraft[]): ProblemDraft[] {
  return problems.map((problem, index) => ({ ...problem, number: index + 1 }))
}

function subpartHint(count: number, prefix = ''): string {
  if (count <= 0) return 'без подзадач'
  if (count === 1) return 'подзадача ' + prefix + 'a'
  return prefix + 'a–' + prefix + String.fromCharCode(96 + Math.min(count, MAX_SUBPARTS))
}

export interface ProblemBuilderProps {
  value: ProblemDraft[]
  onChange: (next: ProblemDraft[]) => void
  disabled?: boolean
}

// Problems are created as individual cards, matching the editing rhythm of the
// razbor workbench without importing grading colours or coffin affordances.
export function ProblemBuilder({ value, onChange, disabled = false }: ProblemBuilderProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null)
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
    setEditingKey(null)
  }

  const addProblem = () => {
    if (regular.length >= MAX_PROBLEMS) return
    onChange([
      ...(exercise ? [exercise] : []),
      ...regular,
      { number: regular.length + 1, subproblem_count: 0 },
    ])
    setEditingKey('number-' + (regular.length + 1))
  }

  const addExercise = () => {
    if (exercise) return
    onChange([{ number: 0, subproblem_count: 0 }, ...renumber(regular)])
    setEditingKey('number-0')
  }

  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
          Задач пока нет
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {[...(exercise ? [exercise] : []), ...regular].map((problem) => {
          const key = keyFor(problem)
          const isExercise = problem.number === 0
          const label = isExercise ? 'Упражнение' : 'Задача ' + problem.number
          const target = isExercise ? 'упражнение' : 'задачу ' + problem.number
          const targetGenitive = isExercise ? 'упражнения' : 'задачи ' + problem.number
          const targetDative = isExercise ? 'упражнению' : 'задаче ' + problem.number
          const prefix = isExercise ? 'У' : ''
          const editing = editingKey === key
          return (
            <li key={key} className="rounded-xl border border-line bg-surface px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-base font-medium text-ink">{label}</p>
                  <p className="text-xs text-faint">
                    {subpartHint(problem.subproblem_count, prefix)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    label={editing ? 'Закончить редактирование' : 'Редактировать ' + target}
                    disabled={disabled}
                    onClick={() => setEditingKey(editing ? null : key)}
                  >
                    {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                  </IconButton>
                  <IconButton
                    label={'Удалить ' + target}
                    disabled={disabled}
                    danger
                    onClick={() => remove(problem)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
              {editing ? (
                <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                  <span className="text-sm text-muted">Подзадачи</span>
                  <div className="flex items-center gap-1.5">
                    <Stepper
                      label={'Убрать подзадачу у ' + targetGenitive}
                      disabled={disabled || problem.subproblem_count <= 0}
                      onClick={() => updateSubparts(problem, problem.subproblem_count - 1)}
                    >
                      <Minus className="h-4 w-4" />
                    </Stepper>
                    <span className="w-7 text-center text-sm font-medium tabular-nums text-ink">
                      {problem.subproblem_count}
                    </span>
                    <Stepper
                      label={'Добавить подзадачу к ' + targetDative}
                      disabled={disabled || problem.subproblem_count >= MAX_SUBPARTS}
                      onClick={() => updateSubparts(problem, problem.subproblem_count + 1)}
                    >
                      <Plus className="h-4 w-4" />
                    </Stepper>
                  </div>
                </div>
              ) : null}
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
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40',
        danger ? 'hover:bg-danger-soft hover:text-danger' : 'hover:bg-surface-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function Stepper({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40"
    >
      {children}
    </button>
  )
}
