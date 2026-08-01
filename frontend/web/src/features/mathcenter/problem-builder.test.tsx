import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ProblemBuilder } from './problem-builder'
import { seedProblems, type ProblemDraft } from './problem-builder-model'

function lastValue(spy: { mock: { calls: unknown[][] } }): ProblemDraft[] {
  const calls = spy.mock.calls
  return calls[calls.length - 1][0] as ProblemDraft[]
}

function Harness({ initial, onValue }: { initial: ProblemDraft[]; onValue: (v: ProblemDraft[]) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <ProblemBuilder value={value} onChange={(next) => { setValue(next); onValue(next) }} />
  )
}

describe('ProblemBuilder', () => {
  it('adds one neutral problem card at a time', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness initial={[]} onValue={onValue} />)

    expect(screen.getByText('Задач пока нет')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Добавить задачу' }))

    expect(screen.getByText('Задача 1')).toBeInTheDocument()
    expect(lastValue(onValue)).toEqual([{ number: 1, subproblem_count: 0 }])
  })

  it('opens card editing and changes subproblem count', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness initial={seedProblems(1)} onValue={onValue} />)

    await user.click(screen.getByRole('button', { name: 'Редактировать задачу 1' }))
    await user.click(screen.getByRole('button', { name: 'Добавить подзадачу к задаче 1' }))
    expect(lastValue(onValue)[0].subproblem_count).toBe(1)
    expect(screen.getByText('подзадача a')).toBeInTheDocument()
  })

  it('deletes a card, renumbers the rest, and preserves ids', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness initial={[
      { id: 11, number: 1, subproblem_count: 2 },
      { id: 22, number: 2, subproblem_count: 0 },
      { id: 33, number: 3, subproblem_count: 1 },
    ]} onValue={onValue} />)

    await user.click(screen.getByRole('button', { name: 'Удалить задачу 2' }))
    expect(lastValue(onValue)).toEqual([
      { id: 11, number: 1, subproblem_count: 2 },
      { id: 33, number: 2, subproblem_count: 1 },
    ])
  })

  it('adds and edits an exercise without changing regular problem ids', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness initial={[
      { id: 11, number: 1, subproblem_count: 0 },
      { id: 22, number: 2, subproblem_count: 1 },
    ]} onValue={onValue} />)

    await user.click(screen.getByRole('button', { name: 'Добавить упражнение' }))
    expect(lastValue(onValue).map((problem) => problem.number)).toEqual([0, 1, 2])
    expect(lastValue(onValue).map((problem) => problem.id)).toEqual([undefined, 11, 22])
    await user.click(screen.getByRole('button', { name: 'Добавить подзадачу к упражнению' }))
    expect(screen.getByText('подзадача Уa')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Удалить упражнение' }))
    expect(lastValue(onValue).map((problem) => problem.id)).toEqual([11, 22])
  })
})
