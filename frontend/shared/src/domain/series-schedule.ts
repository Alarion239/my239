// Pure scheduling helpers for the MathCenter series-creation defaults. No I/O,
// no DOM — `now` is injected so the logic is deterministic in tests.
//
// Sessions run Wednesday and Saturday at 16:00 Moscow time. Moscow has observed
// a fixed UTC+3 with no daylight saving since 2014, so a constant offset is
// correct; we never rely on the host's own timezone for the Moscow anchor.

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000
const DUE_HOUR_MSK = 16
// Day-of-week numbers (0=Sun) that hold a session: Wednesday and Saturday.
const SESSION_DOW = new Set([3, 6])

// nextMathcenterDueAt returns the absolute instant of the next session deadline:
// the soonest Wednesday or Saturday at 16:00 Europe/Moscow that is strictly
// after `now`. When `now` falls exactly on a session instant, the NEXT session
// is returned (the deadline must be in the future).
export function nextMathcenterDueAt(now: Date): Date {
  // Shift into Moscow wall-clock so getUTC* reads the Moscow calendar date.
  const msk = new Date(now.getTime() + MSK_OFFSET_MS)
  const y = msk.getUTCFullYear()
  const m = msk.getUTCMonth()
  const d = msk.getUTCDate()

  for (let i = 0; i < 14; i++) {
    // Midnight UTC of the candidate Moscow date — its getUTCDay is that date's
    // weekday. Date.UTC normalises month/day overflow for us.
    const dow = new Date(Date.UTC(y, m, d + i)).getUTCDay()
    if (!SESSION_DOW.has(dow)) continue
    // 16:00 Moscow == (16 - 3) = 13:00 UTC on that Moscow date.
    const instant = Date.UTC(y, m, d + i, DUE_HOUR_MSK - 3, 0, 0)
    if (instant > now.getTime()) return new Date(instant)
  }
  // Unreachable: two session days recur within any 7-day window.
  return new Date(Date.UTC(y, m, d, DUE_HOUR_MSK - 3, 0, 0))
}

// toDatetimeLocalValue renders a Date into the value a <input type="datetime-local">
// expects: "YYYY-MM-DDTHH:mm" in the VIEWER's local timezone. An invalid Date
// yields '' so the field clears rather than showing "Invalid Date".
export function toDatetimeLocalValue(date: Date): string {
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    'T' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes())
  )
}
