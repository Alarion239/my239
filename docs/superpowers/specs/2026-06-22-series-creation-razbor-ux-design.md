# MathCenter series-creation & разбор UX — design

Date: 2026-06-22
Status: approved (pending spec review)

## Goal

Five related improvements to the teacher-facing MathCenter surfaces:

1. A green frame on Stats-tab rows whose subproblem already has a разбор.
2. Removal of two help sentences in the Stats tab.
3. Auto-filled defaults (number, due date) when creating the next series.
4. A reordered 3-step series-creation wizard: statement upload before problem entry.
5. A new problem builder: a slider for the number of problems + per-problem
   subproblem steppers (default 0 subproblems).

All five are UI/UX changes plus one small backend tolerance change. No new
domain concepts are introduced.

## Affected code (current state)

- `frontend/web/src/features/mathcenter/upload-series-dialog.tsx` — the
  create/edit dialog. Today a 2-step wizard: `DetailsStep` (metadata + problem
  rows) → `AttachStep` (TeX/PDF). Problem rows use two columns: a number input
  and a free-text `subparts` field ("3" or "c").
- `frontend/web/src/features/mathcenter/teacher-problem-stats.tsx` —
  `ProblemStatRow` border precedence is `active (accent) → coffin (checking) →
  line`. A small "Разбор ✓" text badge already exists (`hasRazbor`).
- `frontend/web/src/features/mathcenter/series-page.tsx` — `StatsTab` help
  paragraph (lines ~553–558); `CreateSeriesCard` (~88) renders
  `UploadSeriesDialog`; `CenterSeries` holds the per-center series list.
- `frontend/web/src/features/mathcenter/statement-panel.tsx` — `StatementPanel`
  renders a series statement (TeX via KaTeX, or PDF). Reused as the Step-3
  preview.
- `frontend/shared/src/validation/series.ts` — Zod `createSeriesSchema`, the
  `subparts`↔count helpers, and `toSeriesBody`.
- `backend/internal/handlers/mathcenter/series.go` — `validateSeriesPayload`
  (line ~921) rejects 0 problems; used by both `CreateSeries` and `UpdateSeries`.

## Decisions (resolved with the user)

- **Creation flow:** allow creating a series with **0 problems** (small backend
  change) so the statement can be uploaded before problems exist. 3-step wizard.
- **Problem builder:** slider + steppers apply to **both create and edit**;
  edits preserve existing problem/subproblem IDs by only adding/removing at the
  **tail**.
- **Time zone:** default due time is **16:00 Europe/Moscow (UTC+3, no DST)**,
  converted to the viewer's local clock for the `datetime-local` field.
- **Green frame:** a green **border** on the per-subproblem rows in the teacher
  **Stats tab** (keeping the existing "Разбор ✓" badge).

## Feature 1 — Green frame for разбор-attached rows

File: `teacher-problem-stats.tsx`, `ProblemStatRow`.

Change the border logic so a row with a разбор always shows a green frame, and
selection is shown by an additive ring rather than replacing the frame:

- Base border: `hasSolution ? 'border-status-accepted' : isCoffin ?
  'border-status-checking' : 'border-line'`.
- When `active`, add `ring-2 ring-accent/50` (and keep `border-accent` only when
  the row has neither разбор nor coffin, so accent selection still reads on
  plain rows). The green frame must remain visible while a разбор row is being
  previewed.

The "Разбор ✓" badge is unchanged.

## Feature 2 — Remove two sentences

File: `series-page.tsx`, `StatsTab`.

Remove:
- "Каждая подзадача (5а, 5б, …) — самостоятельная единица: у неё свой разбор и
  свой срок."
- the parenthetical "(подзадача остаётся открытой для сдачи после дедлайна, пока
  не выйдет разбор)".

Resulting paragraph:
> Значок ☠ отмечает гроб; «Разбор» — чтобы прикрепить официальное решение.

## Feature 3 — Auto-filled new-series defaults

New pure, platform-agnostic helpers in `frontend/shared` (injectable `now` for
tests), e.g. in `frontend/shared/src/domain/series-schedule.ts`:

- `nextMathcenterDueAt(now: Date): Date` — returns the absolute instant of the
  next Wednesday **or** Saturday (whichever is sooner and strictly after `now`)
  at 16:00 Europe/Moscow. Implemented by computing the target wall-clock in
  UTC+3 and returning the corresponding `Date`. Moscow has no DST, so a fixed
  +3 offset is correct.
- A `toDatetimeLocalValue(date: Date): string` helper (moves the existing
  `toLocalInput` logic out of the dialog into shared) producing the
  `YYYY-MM-DDTHH:mm` string in the viewer's local zone.

`defaultNumber`: `CenterSeries` computes `max(series.number) + 1` (or `1` when
the list is empty) and passes it to `CreateSeriesCard` → `UploadSeriesDialog`.

The wizard's create defaults become: `number = defaultNumber`, `name = ''`,
`due_at = toDatetimeLocalValue(nextMathcenterDueAt(new Date()))`, `problems =
[]`.

## Feature 4 — 3-step creation wizard

### Backend
`validateSeriesPayload` (`series.go` ~921): drop the "at least one problem is
required" check so 0 problems is accepted. Everything downstream
(`writeProblems`, `reconcileSubproblems`, `buildSeriesView`, the Stats tab's
"В этой серии пока нет задач." empty state) already tolerates an empty problem
set. Add/adjust a backend test asserting 0-problem create returns 201.

Publishing rules are unchanged (out of scope).

### Frontend wizard
Restructure `upload-series-dialog.tsx` into an orchestrator plus focused step
components (split into separate files to keep each focused):

- **Step 1 — «Серия» (`MetaStep`):** number (auto), name, due (auto). On submit:
  - create: `CreateSeries({ number, name, due_at, problems: [] })`, then advance.
  - edit: no-op save here is avoided — the wizard holds metadata in state and
    the final problem save (`UpdateSeries`) sends metadata + problems together.
- **Step 2 — «Условие» (`StatementStep`):** today's `AttachStep`, renamed; TeX or
  PDF upload against the now-existing series.
- **Step 3 — «Задачи» (`ProblemsStep`):** `<StatementPanel series={attachTo}
  bare />` rendered alongside the `ProblemBuilder`; side-by-side on ≥md, stacked
  on mobile. Saves via `UpdateSeries({ number, name, due_at, problems })`.

Header reads "Шаг N из 3". Edit mode opens on Step 1 with existing values and can
navigate across all three steps. The only window in which a series has 0 problems
is immediately after create, before Step 3 is saved.

## Feature 5 — Problem builder (slider + steppers)

New controlled component `frontend/web/src/features/mathcenter/problem-builder.tsx`:

- Value: `Array<{ id?: number; number: number; subproblem_count: number }>`.
- A **slider** sets the list length N (0..40). Numbers are positional 1..N.
  - Grow: append `{ number: len+1, subproblem_count: 0 }`.
  - Shrink: pop from the **tail**, preserving leading items (and their `id`s).
- Each problem row: label "Задача k" + a **− / + stepper** for
  `subproblem_count`, default **0**, clamped 0..26 (MAX_SUBPARTS). Optionally a
  hint showing the resulting labels (e.g. "а–в") for count > 0.

### Validation / wire format
`frontend/shared/src/validation/series.ts`:
- Replace the form field `subparts: string` with `subproblem_count: number`
  (int, 0..26). `seriesProblem` validates the number directly.
- Allow `problems` to be an **empty array** (drop `.min(1)`); keep the
  duplicate-number refine.
- `toSeriesBody` maps `subproblem_count` straight through (no string parsing).
- `subpartsToCount` / `countToSubparts` are retained only if still referenced
  elsewhere; remove if unused after this change.

### Edit preservation
Because growth/shrink is tail-only and numbers are positional, an existing
problem keeps its `id` (and thus its threads/разборы) as long as it stays within
the new length. A pre-existing non-consecutive numbering (e.g. 1, 2, 5) is
normalized to 1, 2, 3 — IDs preserved, display renumbered. Accepted by the user
(numbering is consistent in practice).

## File-level change summary

Backend:
- `backend/internal/handlers/mathcenter/series.go` — allow 0 problems in
  `validateSeriesPayload`.
- backend series handler test — 0-problem create succeeds.

Shared:
- `frontend/shared/src/domain/series-schedule.ts` (new) — `nextMathcenterDueAt`,
  `toDatetimeLocalValue` + unit tests.
- `frontend/shared/src/validation/series.ts` — `subproblem_count` form field,
  empty-problems allowed, `toSeriesBody` update.
- shared barrel exports as needed.

Web:
- `upload-series-dialog.tsx` — split into wizard orchestrator + `MetaStep` /
  `StatementStep` / `ProblemsStep`.
- `problem-builder.tsx` (new) — slider + steppers.
- `series-page.tsx` — remove two sentences; compute & pass `defaultNumber`.
- `teacher-problem-stats.tsx` — green border on разбор rows.

## Testing

- Shared: `series-schedule` unit tests (next Wed/Sat selection, strictly-future,
  16:00 MSK anchoring across viewer zones, injectable now); validation tests for
  numeric `subproblem_count` and empty-problems-allowed.
- Web: updated `upload-series-dialog.test.tsx` for the 3-step flow and builder
  (slider grow/shrink at tail, stepper default 0, id preservation on edit);
  `teacher-problem-stats` green-border assertion; `series-page` sentence-removal
  assertion.
- Backend: 0-problem create returns 201; problems can be added later via update.

## Out of scope

- Changes to publishing rules / empty-series publication guards.
- Razbor authoring/attachment behavior beyond the green frame.
- Native (non-web) form parity.
