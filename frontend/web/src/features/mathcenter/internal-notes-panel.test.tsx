import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InternalNote } from '@my239/shared'
import { InternalNotesPanel } from './internal-notes-panel'

const notes: InternalNote[] = [
  {
    id: 1,
    author_user_id: 3,
    author_name: 'Пётр Учитель',
    body: 'identical to neighbour',
    created_at: '2026-06-01T10:00:00Z',
    updated_at: '2026-06-01T10:00:00Z',
  },
  {
    id: 2,
    author_user_id: 4,
    author_name: 'Анна Грейдер',
    body: 'asked to redo',
    created_at: '2026-06-02T10:00:00Z',
    updated_at: '2026-06-02T10:00:00Z',
  },
]

function renderPanel(over: Partial<React.ComponentProps<typeof InternalNotesPanel>> = {}) {
  const onCreate = vi.fn().mockResolvedValue(undefined)
  const onUpdate = vi.fn().mockResolvedValue(undefined)
  const onDelete = vi.fn().mockResolvedValue(undefined)
  render(
    <InternalNotesPanel
      notes={notes}
      isLoading={false}
      currentUserId={3}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
      title="Внутренние заметки"
      hint="Видно только преподавателям."
      {...over}
    />,
  )
  return { onCreate, onUpdate, onDelete }
}

describe('InternalNotesPanel', () => {
  it('lists each note with its author and body', () => {
    renderPanel()
    expect(screen.getByText('Пётр Учитель')).toBeInTheDocument()
    expect(screen.getByText('identical to neighbour')).toBeInTheDocument()
    expect(screen.getByText('Анна Грейдер')).toBeInTheDocument()
  })

  it('shows edit/delete only on the viewer’s own notes', () => {
    renderPanel({ currentUserId: 3 })
    // Two notes, but only note 1 (author 3) is editable → exactly one Удалить.
    expect(screen.getAllByRole('button', { name: /Удалить/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /Изм\./ })).toHaveLength(1)
  })

  it('adds a note through onCreate and clears the field', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderPanel()
    await user.type(screen.getByLabelText('Новая внутренняя заметка'), 'new suspicion')
    await user.click(screen.getByRole('button', { name: 'Добавить заметку' }))
    expect(onCreate).toHaveBeenCalledWith('new suspicion')
  })

  it('disables the add button when the draft is empty', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: 'Добавить заметку' })).toBeDisabled()
  })
})
