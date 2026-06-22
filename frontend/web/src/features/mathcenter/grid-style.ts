// grid-style.ts — the shared visual vocabulary for the two mathcenter grids:
// the «Кондуит» (conduit-page.tsx, center-wide) and the per-series «Таблица»
// (teacher-grid.tsx). Both import these so their borders, sticky behaviour,
// header look and coffin tint can't drift apart.
//
// STICKY BORDER RULE (the important bit): the table uses `border-separate` so
// every border belongs to exactly ONE cell. A frozen (position: sticky) cell
// then draws the border on the edge facing the scrolling content, so the line
// travels WITH the cell instead of the table showing through at the seam:
//   - the header row owns its `border-b`
//   - the name column owns its `border-r`
//   - (conduit's bottom totals own their `border-t` — declared inline there)
// `border-collapse` does NOT do this (shared borders scroll away from sticky
// cells), so it must not be used here.

import { cn } from '../../design/cn'

// One full-width scroll surface (not a small rounded box); hides its own
// scrollbar. Callers add a height (`h-full` for the full-bleed Кондуит, a
// `max-h-[…]` for the «Таблица» that sits under the series tabs).
export const gridScroller =
  'overflow-auto overscroll-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

export function gridScrollerWithHeight(heightClass: string): string {
  return cn(gridScroller, heightClass)
}

// The <table>: separated borders so each cell owns its lines (see the rule
// above). Spacing 0 keeps the grid tight.
export const gridTable = 'border-separate border-spacing-0 text-sm'

// vert(firstInSeries) — a cell's LEFT vertical line: a thick strong rule at the
// start of a series, a hairline otherwise. Single-series tables pass `false`.
export function vert(firstInSeries: boolean): string {
  return firstInSeries
    ? 'border-l-2 border-l-line-strong'
    : 'border-l border-line'
}

// dataCell(firstInSeries) — the owned grid borders for a body data cell:
// bottom + its left vertical.
export function dataCell(firstInSeries: boolean): string {
  return cn('border-b border-line', vert(firstInSeries))
}

// The corner «Ученик» header cell — sticky on both axes, top z-index so the
// embedded search Input is never overlapped by the other sticky cells. Owns all
// four borders (it is the frame's corner), including the bottom + right edges
// that face the scrolling content.
export const cornerHeaderCell =
  'sticky left-0 top-0 z-40 min-w-44 border-b border-l border-r border-t border-line bg-surface-muted px-3 py-2 text-left align-top font-medium text-ink'

// The sticky student-name column cell. Owns `border-r` (the seam facing the
// scrolling columns) + `border-b`; tinted `bg-surface-muted` to read as a
// frozen rail.
export const nameCell =
  'sticky left-0 z-10 min-w-44 whitespace-nowrap border-b border-l border-r border-line bg-surface-muted px-3 py-1.5 text-ink'

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
