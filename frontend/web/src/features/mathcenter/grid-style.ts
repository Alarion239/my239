// grid-style.ts — the visual vocabulary for the center-wide «Кондуит»:
// borders, sticky behaviour, and header look.
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
// scrollbar. The caller adds the full-bleed height.
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

// Coffin columns use the same quiet header treatment as ordinary columns. The
// current/solved split is structural, not a second status-color system.
export function coffinColumnClasses(_isCoffin: boolean, _open: boolean): string {
  return 'bg-surface-muted text-muted'
}

// Coffin data cells do not add a separate coffin tint; submission status colors
// remain the only state colors in the grid.
export function coffinCellClasses(_isCoffin: boolean, _open: boolean): string {
  return ''
}

// Exercise columns have a quiet accent wash so the special У problem remains
// recognizable without adding explanatory copy.
export function exerciseColumnClasses(isExercise: boolean): string {
  return isExercise ? 'bg-accent-soft text-accent-ink' : ''
}

export function exerciseCellClasses(isExercise: boolean): string {
  return isExercise ? 'bg-accent-soft/70 font-medium text-accent-ink' : ''
}
