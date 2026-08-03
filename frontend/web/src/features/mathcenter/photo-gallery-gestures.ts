export interface SwipePoint {
  x: number
  y: number
}

const SWIPE_THRESHOLD = 56

// A horizontal touch gesture changes the page only while the image is fitted.
// Once zoomed, the same movement is reserved for panning the handwriting.
export function swipeDirection(
  start: SwipePoint,
  current: SwipePoint,
  scale: number,
  pointerType: string,
): -1 | 0 | 1 {
  if (scale !== 1 || pointerType === 'mouse') return 0
  const dx = current.x - start.x
  const dy = current.y - start.y
  if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy) * 1.2) return 0
  return dx < 0 ? 1 : -1
}
