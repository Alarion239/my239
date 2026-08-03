import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PhotoView } from '@my239/shared'
import { PhotoAttachments } from './photo-gallery'
import { swipeDirection } from './photo-gallery-gestures'

function photo(index: number, url = `https://cdn.example.test/solution-${index}.jpg`): PhotoView {
  return {
    index,
    object_key: `solution-${index}`,
    url,
    content_type: 'image/jpeg',
    size_bytes: 100,
  }
}

function renderGallery(photos = [photo(0), photo(1), photo(2)]) {
  return render(<PhotoAttachments photos={photos} title="Решение ученика" />)
}

async function openPhoto(index: number) {
  renderGallery()
  const user = userEvent.setup()
  const thumbnails = screen.getAllByRole('button', {
    name: `Открыть фото ${index + 1} из 3`,
  })
  await user.click(thumbnails[0])
  return user
}

describe('PhotoAttachments', () => {
  it('opens the selected frame and navigates within one event only', async () => {
    const user = await openPhoto(2)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Предыдущее фото' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Следующее фото' })).toBeDisabled()

    await user.keyboard('{Home}')
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Предыдущее фото' })).toBeDisabled()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
  })

  it('supports keyboard navigation and restores focus to the source thumbnail', async () => {
    const user = userEvent.setup()
    renderGallery()
    const source = screen.getAllByRole('button', { name: 'Открыть фото 2 из 3' })[0]
    await user.click(source)
    await user.keyboard('{End}')
    expect(screen.getByText('3 / 3')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.activeElement).toBe(source)
  })

  it('resets zoom when changing frames', async () => {
    const user = await openPhoto(0)

    await user.click(screen.getByRole('button', { name: 'Увеличить масштаб' }))
    expect(screen.getByLabelText('Масштаб')).toHaveTextContent('125%')

    expect(screen.getByText('1 / 3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Следующее фото' }))
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(screen.getByLabelText('Масштаб')).toHaveTextContent('100%')
  })

  it('recognizes horizontal touch swipes only at fit scale', () => {
    expect(swipeDirection({ x: 220, y: 300 }, { x: 100, y: 300 }, 1, 'touch')).toBe(1)
    expect(swipeDirection({ x: 220, y: 300 }, { x: 100, y: 300 }, 2, 'touch')).toBe(0)
    expect(swipeDirection({ x: 220, y: 300 }, { x: 100, y: 420 }, 1, 'touch')).toBe(0)
    expect(swipeDirection({ x: 220, y: 300 }, { x: 100, y: 300 }, 1, 'mouse')).toBe(0)
  })

  it('keeps unavailable photos as disabled placeholders and hides navigation for one photo', async () => {
    const view = renderGallery([photo(0, ''), photo(1)])
    expect(screen.getByRole('img', { name: 'Фото 1 из 2 недоступно' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Открыть фото 1 из 2' })).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Открыть фото 2 из 2' }))
    expect(screen.getByText('2 / 2')).toBeInTheDocument()

    view.unmount()
    renderGallery([photo(0)])
    await user.click(screen.getByRole('button', { name: 'Открыть фото 1 из 1' }))
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Предыдущее фото' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Следующее фото' })).not.toBeInTheDocument()
  })
})
