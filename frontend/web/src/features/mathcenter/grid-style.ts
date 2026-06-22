// grid-style.ts — the shared visual vocabulary for the two mathcenter grids:
// the «Кондуит» (conduit-page.tsx, center-wide) and the per-series «Таблица»
// (teacher-grid.tsx). Both import these so their borders, sticky behaviour,
// header look and coffin tint can't drift apart.
//
// Sticky rule used throughout: a frozen cell owns the border on the edge facing
// the scroll. The header row owns `border-b`; the name column owns `border-r`.
// That keeps the seam from showing through as content scrolls underneath.

import { cn } from '../../design/cn'

// The scroll surface: one full-width region (not a small rounded box) that
// pins the header/name-column inside it and hides its own scrollbar. Both
// tables wrap their <table> in a div with these classes plus a max-height.
export const gridScroller =
  'overflow-auto overscroll-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

// The <table> itself: collapsed borders so every cell shares 1px lines.
export const gridTable =
  'border-collapse text-sm [&_td]:border [&_td]:border-line [&_th]:border [&_th]:border-line'

// vert(firstInSeries) — the left divider between series. The first column of a
// series gets a thick strong rule; later columns just the normal line.
export function vert(firstInSeries: boolean): string {
  return firstInSeries
    ? 'border-l-2 border-l-line-strong'
    : 'border-l border-line'
}

// The corner «Ученик» header cell — sticky on both axes, top z-index so the
// embedded search Input is never overlapped by the other sticky cells.
export const cornerHeaderCell =
  'sticky left-0 top-0 z-40 min-w-44 bg-surface-muted px-3 py-2 text-left align-top font-medium text-ink'

// A plain (non-coffin) column header cell — sticky to the top, owns its
// bottom border.
export const headerCell =
  'sticky top-0 z-20 whitespace-nowrap bg-surface-muted px-3 py-2 text-center font-medium text-ink'

// The sticky student-name column cell. Owns `border-r` so it doesn't bleed,
// and tinted `bg-surface-muted` to read as a frozen rail.
export const nameCell =
  'sticky left-0 z-10 min-w-44 whitespace-nowrap bg-surface-muted px-3 py-1.5 text-ink'

// The group-label row's sticky inner label.
export const groupLabel =
  'sticky left-0 inline-block px-3 py-1 text-xs font-medium uppercase tracking-wide text-faint'

// coffinColumnClasses(isCoffin, open) — tint for a column *header* cell.
// Open coffins are amber (accepting submissions); разобранные (solved) coffins
// are gray; ordinary columns use the muted surface.
export function coffinColumnClasses(isCoffin: boolean, open: boolean): string {
  if (open) return 'bg-status-checking text-white'
  if (isCoffin) return 'bg-faint text-white'
  return 'bg-surface-muted text-muted'
}

// coffinCellClasses(isCoffin, open) — the lighter tint for a *data* cell of a
// coffin column (the tile / initials sit on top of it). `/25` and `/35` keep it
// subtle. Returns '' for ordinary columns.
export function coffinCellClasses(isCoffin: boolean, open: boolean): string {
  if (open) return 'bg-status-checking/25'
  if (isCoffin) return 'bg-faint/35'
  return ''
}

// gridScrollerWithHeight composes the scroller classes with a max-height that
// makes the region fill the viewport below the page chrome (tabs + app bar).
export function gridScrollerWithHeight(maxHeightClass: string): string {
  return cn(gridScroller, maxHeightClass)
}
