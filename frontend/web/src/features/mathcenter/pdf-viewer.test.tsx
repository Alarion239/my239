import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../../lib/api'
import { PdfViewer } from './pdf-viewer'
import { normalizeWheelDelta, pinchZoomFactor, touchMidpoint, wheelZoomFactor } from './pdf-zoom'

describe('PdfViewer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts with an accessible loading state and never creates a native PDF iframe', () => {
    vi.spyOn(apiClient, 'requestBlob').mockReturnValue(new Promise(() => {}))

    const { container } = render(<PdfViewer path="/mathcenter/series/7/pdf" title="Условие" />)

    expect(screen.getByRole('status', { name: 'Загрузка PDF' })).toBeInTheDocument()
    expect(screen.getAllByRole('toolbar', { name: 'Управление PDF' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Уменьшить масштаб' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Увеличить масштаб' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Масштаб PDF')).toHaveTextContent('Загрузка…')
    expect(screen.getByRole('document')).toHaveClass('absolute')
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('installs non-passive gesture listeners and removes them on unmount', () => {
    vi.spyOn(apiClient, 'requestBlob').mockReturnValue(new Promise(() => {}))
    const addSpy = vi.spyOn(HTMLElement.prototype, 'addEventListener')
    const removeSpy = vi.spyOn(HTMLElement.prototype, 'removeEventListener')
    const { unmount } = render(<PdfViewer path="/mathcenter/series/7/pdf" />)

    const documentCalls = addSpy.mock.calls.filter(([type, , options]) => ['wheel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'gesturestart', 'gesturechange', 'gestureend'].includes(String(type)) && (options as AddEventListenerOptions)?.passive === false)
    expect(documentCalls).toHaveLength(8)
    expect(documentCalls.every(([, , options]) => (options as AddEventListenerOptions)?.passive === false)).toBe(true)

    unmount()
    const removedTypes = removeSpy.mock.calls.map(([type]) => String(type))
    expect(removedTypes).toEqual(expect.arrayContaining(['wheel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'gesturestart', 'gesturechange', 'gestureend']))
  })

  it('offers a retry action when the authenticated PDF request fails', async () => {
    vi.spyOn(apiClient, 'requestBlob').mockRejectedValue(new Error('network down'))

    render(<PdfViewer path="/mathcenter/series/7/pdf" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('network down')
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
  })

  it('normalizes wheel input and keeps each frame precise', () => {
    expect(normalizeWheelDelta(2, 1, 800)).toBe(32)
    expect(normalizeWheelDelta(1, 2, 900)).toBe(900)
    expect(wheelZoomFactor(120)).toBeCloseTo(Math.exp(-120 / 2400))
    expect(wheelZoomFactor(10000)).toBeCloseTo(Math.exp(-120 / 2400))
  })

  it('uses incremental pinch scaling and the midpoint as its focal origin', () => {
    expect(pinchZoomFactor(200, 100)).toBeCloseTo(Math.pow(2, 0.7))
    expect(pinchZoomFactor(0, 100)).toBe(1)
    expect(touchMidpoint({ clientX: 100, clientY: 120 }, { clientX: 300, clientY: 220 })).toEqual([200, 170])
  })
})
