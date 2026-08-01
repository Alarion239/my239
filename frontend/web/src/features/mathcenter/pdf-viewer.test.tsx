import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../../lib/api'
import { PdfViewer } from './pdf-viewer'

describe('PdfViewer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts with an accessible loading state and never creates a native PDF iframe', () => {
    vi.spyOn(apiClient, 'requestBlob').mockReturnValue(new Promise(() => {}))

    const { container } = render(<PdfViewer path="/mathcenter/series/7/pdf" title="Условие" />)

    expect(screen.getByRole('status', { name: 'Загрузка PDF' })).toBeInTheDocument()
    expect(screen.getByRole('document')).toHaveClass('absolute')
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('offers a retry action when the authenticated PDF request fails', async () => {
    vi.spyOn(apiClient, 'requestBlob').mockRejectedValue(new Error('network down'))

    render(<PdfViewer path="/mathcenter/series/7/pdf" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('network down')
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
  })
})
