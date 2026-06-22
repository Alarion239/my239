// Fetch-based Server-Sent-Events reader. EventSource cannot attach an
// Authorization header, so we stream the response body ourselves: parse
// `event:`/`data:` line pairs, dispatch each frame, and reconnect with backoff.
// On 401 we refresh the token once and retry. The caller aborts via the signal.

export interface EventStreamOptions {
  url: string
  getToken: () => string | null
  refresh: () => Promise<string | null>
  onEvent: (kind: string, data: string) => void
  signal: AbortSignal
  // extraHeaders lets the caller attach request-scoped headers (e.g. the admin
  // act-as header) to every (re)connect.
  extraHeaders?: () => Record<string, string> | undefined
}

export async function openEventStream(opts: EventStreamOptions): Promise<void> {
  let backoff = 1000
  const maxBackoff = 30000
  while (!opts.signal.aborted) {
    try {
      const token = opts.getToken()
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const extra = opts.extraHeaders?.()
      if (extra) Object.assign(headers, extra)
      const res = await fetch(opts.url, { headers, signal: opts.signal })
      if (res.status === 401) {
        const fresh = await opts.refresh()
        if (!fresh) return // signed out — stop trying
        continue // reconnect with the new token (no backoff)
      }
      if (!res.ok || !res.body) {
        throw new Error(`SSE failed (${res.status})`)
      }
      backoff = 1000 // healthy connection resets backoff
      await pump(res.body, opts.onEvent, opts.signal)
    } catch {
      if (opts.signal.aborted) return
      // fall through to backoff
    }
    if (opts.signal.aborted) return
    await sleep(backoff, opts.signal)
    backoff = Math.min(backoff * 2, maxBackoff)
  }
}

async function pump(
  body: ReadableStream<Uint8Array>,
  onEvent: (kind: string, data: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) return
      buf += decoder.decode(value, { stream: true })
      let sep: number
      // Frames are separated by a blank line.
      while ((sep = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, sep)
        buf = buf.slice(sep + 2)
        dispatchFrame(frame, onEvent)
      }
    }
  } finally {
    reader.cancel().catch(() => undefined)
  }
}

function dispatchFrame(
  frame: string,
  onEvent: (kind: string, data: string) => void,
): void {
  let event = 'message'
  let data = ''
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue // comment / heartbeat
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data += line.slice(5).trim()
  }
  if (data) onEvent(event, data)
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        resolve()
      },
      { once: true },
    )
  })
}
