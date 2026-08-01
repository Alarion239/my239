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

  it('selects a letter and every previous square, clearing every next square', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness initial={seedProblems(1)} onValue={onValue} />)

    const group = screen.getByRole('group', { name: 'Подзадачи · Задача 1' })
    expect(group).toHaveTextContent('abcdef')
    await user.click(screen.getByRole('button', { name: 'Задача 1, подзадача d' }))
    expect(lastValue(onValue)[0].subproblem_count).toBe(4)
    for (const letter of ['a', 'b', 'c', 'd']) {
      expect(screen.getByRole('button', { name: 'Задача 1, подзадача ' + letter })).toHaveAttribute('aria-pressed', 'true')
    }
    for (const letter of ['e', 'f']) {
      expect(screen.getByRole('button', { name: 'Задача 1, подзадача ' + letter })).toHaveAttribute('aria-pressed', 'false')
    }

    await user.click(screen.getByRole('button', { name: 'Задача 1, подзадача b' }))
    expect(lastValue(onValue)[0].subproblem_count).toBe(2)
    expect(screen.getByRole('button', { name: 'Задача 1, подзадача c' })).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByRole('button', { name: 'Задача 1, подзадача b' }))
    expect(lastValue(onValue)[0].subproblem_count).toBe(0)
  })

  it('reveals more letters progressively after f', async () => {
    const user = userEvent.setup()
    render(<Harness initial={seedProblems(1)} onValue={() => {}} />)

    expect(screen.queryByRole('button', { name: 'Задача 1, подзадача g' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Задача 1, подзадача f' }))
    expect(screen.getByRole('button', { name: 'Задача 1, подзадача g' })).toBeInTheDocument()
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

  it('adds an exercise with the same square control without changing regular problem ids', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness initial={[
      { id: 11, number: 1, subproblem_count: 0 },
      { id: 22, number: 2, subproblem_count: 1 },
    ]} onValue={onValue} />)

    await user.click(screen.getByRole('button', { name: 'Добавить упражнение' }))
    expect(lastValue(onValue).map((problem) => problem.number)).toEqual([0, 1, 2])
    expect(lastValue(onValue).map((problem) => problem.id)).toEqual([undefined, 11, 22])
    await user.click(screen.getByRole('button', { name: 'Упражнение, подзадача c' }))
    expect(lastValue(onValue)[0].subproblem_count).toBe(3)
    expect(screen.getByRole('button', { name: 'Упражнение, подзадача c' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Удалить упражнение' }))
    expect(lastValue(onValue).map((problem) => problem.id)).toEqual([11, 22])
  })
})
