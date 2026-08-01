const WHEEL_ZOOM_SENSITIVITY = 2400
const WHEEL_FRAME_LIMIT = 120
const PINCH_ZOOM_RESPONSE = 0.7

export function normalizeWheelDelta(deltaY: number, deltaMode: number, viewportHeight: number): number {
  const pixelsPerLine = 16
  const pixelsPerPage = viewportHeight || 800
  return deltaY * (deltaMode === 1 ? pixelsPerLine : deltaMode === 2 ? pixelsPerPage : 1)
}

export function wheelZoomFactor(delta: number): number {
  const pending = Math.max(-WHEEL_FRAME_LIMIT, Math.min(WHEEL_FRAME_LIMIT, delta))
  return Math.exp(-pending / WHEEL_ZOOM_SENSITIVITY)
}

export function pinchZoomFactor(distance: number, previousDistance: number): number {
  if (distance <= 0 || previousDistance <= 0) return 1
  return Math.pow(distance / previousDistance, PINCH_ZOOM_RESPONSE)
}

// Safari exposes trackpad pinch as a cumulative GestureEvent scale rather than
// two touch points. Treat each update as an incremental pinch step so the
// response matches the touch implementation and cannot compound too quickly.
export function safariGestureZoomFactor(scale: number, previousScale: number): number {
  return pinchZoomFactor(scale, previousScale)
}

export function touchMidpoint(first: { clientX: number; clientY: number }, second: { clientX: number; clientY: number }): [number, number] {
  return [(first.clientX + second.clientX) / 2, (first.clientY + second.clientY) / 2]
}
