import { useCallback, useEffect, useRef, useState } from 'react'

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

interface UseAutosaveOptions<T> {
  initialValue: T
  save: (value: T) => Promise<unknown>
  equals?: (left: T, right: T) => boolean
  isValid?: (value: T) => boolean
  invalidMessage?: string
  formatError?: (error: unknown) => string
  debounceMs?: number
  maxWaitMs?: number
}

export interface AutosaveController<T> {
  status: AutosaveStatus
  error: string | null
  isDirty: boolean
  schedule: (value: T) => void
  setBaseline: (value: T) => void
  flush: () => Promise<boolean>
}

const defaultEquals = <T,>(left: T, right: T) => Object.is(left, right)

/**
 * A small serialized autosave queue. A new value always replaces a queued
 * value, while a request already in flight is allowed to finish first.
 */
export function useAutosave<T>({
  initialValue,
  save,
  equals = defaultEquals,
  isValid = () => true,
  invalidMessage = 'Исправьте значение перед сохранением.',
  formatError = (error) => error instanceof Error ? error.message : 'Не удалось сохранить изменения.',
  debounceMs = 1500,
  maxWaitMs = 15000,
}: UseAutosaveOptions<T>): AutosaveController<T> {
  const baselineRef = useRef(initialValue)
  const pendingRef = useRef<T | null>(null)
  const inFlightRef = useRef<Promise<boolean> | null>(null)
  const idleTimerRef = useRef<number | null>(null)
  const maxTimerRef = useRef<number | null>(null)
  const saveRef = useRef(save)
  const equalsRef = useRef(equals)
  const isValidRef = useRef(isValid)
  const invalidMessageRef = useRef(invalidMessage)
  const formatErrorRef = useRef(formatError)
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => { saveRef.current = save }, [save])
  useEffect(() => { equalsRef.current = equals }, [equals])
  useEffect(() => { isValidRef.current = isValid }, [isValid])
  useEffect(() => { invalidMessageRef.current = invalidMessage }, [invalidMessage])
  useEffect(() => { formatErrorRef.current = formatError }, [formatError])

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    if (maxTimerRef.current !== null) window.clearTimeout(maxTimerRef.current)
    idleTimerRef.current = null
    maxTimerRef.current = null
  }, [])

  const drain = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) return inFlightRef.current

    // A successful idle save satisfies the max-wait window as well. Clear the
    // old deadline so it cannot fire later with an already-empty queue.
    if (maxTimerRef.current !== null) {
      window.clearTimeout(maxTimerRef.current)
      maxTimerRef.current = null
    }

    const candidate = pendingRef.current
    if (candidate === null || equalsRef.current(candidate, baselineRef.current)) {
      pendingRef.current = null
      setIsDirty(false)
      setStatus('idle')
      return true
    }
    if (!isValidRef.current(candidate)) {
      setIsDirty(true)
      setStatus('error')
      setError(invalidMessageRef.current)
      return false
    }

    pendingRef.current = null
    setIsDirty(true)
    setStatus('saving')
    setError(null)
    const request = saveRef.current(candidate)
      .then(() => {
        baselineRef.current = candidate
        setIsDirty(pendingRef.current !== null)
        setStatus('saved')
        setError(null)
        return true
      })
      .catch((value: unknown) => {
        if (pendingRef.current === null) pendingRef.current = candidate
        setIsDirty(true)
        setStatus('error')
        setError(formatErrorRef.current(value))
        return false
      })
      .finally(() => {
        inFlightRef.current = null
        if (pendingRef.current !== null && !equalsRef.current(pendingRef.current, candidate)) {
          void drain()
        }
      })
    inFlightRef.current = request
    return request
  }, [])

  const flush = useCallback(async () => {
    clearTimers()
    if (inFlightRef.current) {
      const completed = await inFlightRef.current
      if (!completed) return false
    }
    return drain()
  }, [clearTimers, drain])

  const schedule = useCallback((value: T) => {
    if (equalsRef.current(value, baselineRef.current) && pendingRef.current === null) {
      setIsDirty(false)
      setStatus('idle')
      return
    }
    pendingRef.current = value
    setIsDirty(true)
    setStatus('dirty')
    setError(null)
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null
      void drain()
    }, debounceMs)
    if (maxTimerRef.current === null) {
      maxTimerRef.current = window.setTimeout(() => {
        maxTimerRef.current = null
        void drain()
      }, maxWaitMs)
    }
  }, [debounceMs, drain, maxWaitMs])

  const setBaseline = useCallback((value: T) => {
    baselineRef.current = value
    pendingRef.current = null
    clearTimers()
    setIsDirty(false)
    setError(null)
    setStatus('idle')
  }, [clearTimers])

  useEffect(() => () => {
    clearTimers()
  }, [clearTimers])

  return { status, error, isDirty, schedule, setBaseline, flush }
}
