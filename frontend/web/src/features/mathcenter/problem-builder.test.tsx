import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ProblemBuilder } from './problem-builder'
import { seedProblems, type ProblemDraft } from './problem-builder-model'

// lastValue reads the most recent value passed to the onChange spy.
function lastValue(spy: { mock: { calls: unknown[][] } }): ProblemDraft[] {
  const calls = spy.mock.calls
  return calls[calls.length - 1][0] as ProblemDraft[]
}

// Harness wires the controlled builder to local state and reports the latest
// value through a spy so assertions read the model, not the DOM.
function Harness({
  initial,
  onValue,
}: {
  initial: ProblemDraft[]
  onValue: (v: ProblemDraft[]) => void
}) {
  const [value, setValue] = useState<ProblemDraft[]>(initial)
  return (
    <ProblemBuilder
      value={value}
      onChange={(next) => {
        setValue(next)
        onValue(next)
      }}
    />
  )
}

describe('ProblemBuilder', () => {
  it('renders one row per problem, numbered 1..N', () => {
    render(<Harness initial={seedProblems(3)} onValue={() => {}} />)
    expect(screen.getByText('Задача 1')).toBeInTheDocument()
    expect(screen.getByText('Задача 2')).toBeInTheDocument()
    expect(screen.getByText('Задача 3')).toBeInTheDocument()
  })

  it('grows the list from the slider, appending single-part problems', () => {
    const onValue = vi.fn()
    render(<Harness initial={seedProblems(2)} onValue={onValue} />)
    fireEvent.change(screen.getByLabelText('Количество задач'), { target: { value: '4' } })
    const last = lastValue(onValue)
    expect(last.map((p) => p.number)).toEqual([1, 2, 3, 4])
    expect(last.every((p) => p.subproblem_count === 0)).toBe(true)
  })

  it('shrinks from the tail, preserving leading problems and their ids', () => {
    const onValue = vi.fn()
    const initial: ProblemDraft[] = [
      { id: 11, number: 1, subproblem_count: 2 },
      { id: 22, number: 2, subproblem_count: 0 },
      { id: 33, number: 3, subproblem_count: 1 },
    ]
    render(<Harness initial={initial} onValue={onValue} />)
    fireEvent.change(screen.getByLabelText('Количество задач'), { target: { value: '2' } })
    const last = lastValue(onValue)
    expect(last).toEqual([
      { id: 11, number: 1, subproblem_count: 2 },
      { id: 22, number: 2, subproblem_count: 0 },
    ])
  })

  it('adds and removes subproblems with the per-problem steppers', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness initial={seedProblems(1)} onValue={onValue} />)

    await user.click(screen.getByRole('button', { name: 'Добавить подзадачу к задаче 1' }))
    expect(lastValue(onValue)[0].subproblem_count).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Убрать подзадачу у задачи 1' }))
    expect(lastValue(onValue)[0].subproblem_count).toBe(0)
  })

  it('disables the minus stepper at zero subproblems', () => {
    render(<Harness initial={seedProblems(1)} onValue={() => {}} />)
    expect(screen.getByRole('button', { name: 'Убрать подзадачу у задачи 1' })).toBeDisabled()
  })
})
