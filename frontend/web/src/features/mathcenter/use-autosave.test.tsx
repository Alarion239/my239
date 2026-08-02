import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAutosave } from './use-autosave'

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useAutosave', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('saves after a pause and forces a maximum wait during continuous editing', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave({ initialValue: '', save }))

    act(() => result.current.schedule('one'))
    act(() => { vi.advanceTimersByTime(1499) })
    expect(save).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(1)
      await settle()
    })
    expect(save).toHaveBeenCalledWith('one')

    act(() => result.current.schedule('two'))
    for (let index = 0; index < 14; index += 1) {
      act(() => { vi.advanceTimersByTime(1000) })
      act(() => result.current.schedule('continuous-' + index))
    }
    await act(async () => {
      vi.advanceTimersByTime(1000)
      await settle()
    })
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith('continuous-13')
  })

  it('coalesces a newer value behind an in-flight request', async () => {
    vi.useFakeTimers()
    let resolveFirst: (() => void) | undefined
    const save = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave({ initialValue: '', save }))

    act(() => result.current.schedule('first'))
    act(() => { vi.advanceTimersByTime(1500) })
    expect(save).toHaveBeenCalledWith('first')
    act(() => result.current.schedule('latest'))
    await act(async () => {
      resolveFirst?.()
      await result.current.flush()
      await settle()
    })
    expect(save).toHaveBeenNthCalledWith(2, 'latest')
  })

  it('does not retry a failed value forever and exposes the failure', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useAutosave({ initialValue: '', save }))

    act(() => result.current.schedule('draft'))
    await act(async () => {
      vi.advanceTimersByTime(1500)
      await settle()
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('offline')
  })
})
