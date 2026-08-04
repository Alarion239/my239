# my239 design system — “239 Indigo”

The visual language of my239 is crisp, neutral, and unmistakably tied to the
school identity. Deep indigo carries actions and navigation; amber is a rare
239 marker, never a call-to-action. Cards and work surfaces stay quiet so the
content and homework states remain the focus.

Everything is an owned token or component. See [`theme.css`](./theme.css),
[`ui/`](./ui), [`cn.ts`](./cn.ts), [`theme-provider.tsx`](./theme-provider.tsx),
and the module registry in [`../shell/modules.ts`](../shell/modules.ts).

## Principles

1. **Neutral hierarchy.** `canvas`, `surface`, `surface-subtle`, and
   `surface-strong` create depth without chromatic muddiness.
2. **Role before hue.** Actions, links, selection, focus, borders, and statuses
   each have a token. Do not reuse a token because its hex value looks close.
3. **Identity in restraint.** Indigo is the interaction color. `signature` amber
   appears only in the small wordmark marker and teacher-private annotations.
4. **Accessible states.** Status meaning is always conveyed by glyphs and text
   as well as color. Ordinary text pairs target 4.5:1; controls and focus target
   3:1. Decorative borders may be quieter.
5. **Human, not “AI”.** No gradients, translucent blurred chrome, global rise-in
   animation, or ubiquitous accent decoration. Use `rounded-lg` for cards and
   `rounded-md` for controls; reserve `rounded-full` for pills and avatars.
6. **Dark mode is first-class.** Every role has light and dark values. The
   `my239.theme` preference and OS fallback remain unchanged.

## Typography

Spectral (`font-display`) is reserved for the `my239` wordmark and top-level
page headings (`h1`). IBM Plex Sans (`font-sans`, the body default) is used for
cards, dialogs, tables, section headings, labels, and controls. IBM Plex Mono
(`font-mono`) is for code, TeX, tokens, and IDs. Use regular and medium weights.

## Role tokens

The values below are the contract exposed as Tailwind utilities (`bg-*`,
`text-*`, `border-*`). Add new roles in `theme.css` in both theme blocks rather
than writing a raw hex in a component.

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| `canvas` | `#F5F6F8` | `#0F1118` | Page background |
| `surface` | `#FFFFFF` | `#171A23` | Cards, inputs, menus |
| `surface-subtle` | `#EAEDF2` | `#222733` | Table headers, hover, selected context |
| `surface-strong` | `#DDE2EA` | `#2D3441` | Disabled and nested regions |
| `text` | `#171A22` | `#F2F3F7` | Primary text |
| `muted` | `#4E5868` | `#BBC2CE` | Secondary text |
| `text-subtle` | `#626D7E` | `#9CA6B6` | Metadata and placeholders |
| `border` | `#C9D0DB` | `#3A4251` | Decorative separators |
| `border-control` | `#7C8798` | `#747F91` | Inputs and identifiable controls |
| `action` / `action-hover` | `#202566` / `#171B52` | `#5B68C4` / `#4F5CB3` | Solid actions with `on-action` |
| `link` | `#2F439E` | `#B9C1FF` | Text links only |
| `focus` | `#425CC7` | `#AAB4FF` | Full-opacity 2px focus ring |
| `selected` / `selected-text` | `#E5E9F8` / `#202566` | `#292F59` / `#D9DDFF` | Selected surfaces and content |
| `selected-border` | `#596CCB` | `#8E9BE8` | Active tabs and selected controls |
| `signature` / `on-signature` | `#FBB03B` / `#202566` | `#FBB03B` / `#202566` | Rare identity marker; never white on amber |

Pairings are explicit: `bg-action text-on-action`, `bg-danger text-on-danger`,
`bg-selected text-selected-text`, and `bg-*-soft text-*`. Use `border` for
decoration and `border-control` for a boundary users must identify or operate.

### Semantic and homework states

| Meaning | Light text / fill | Dark text / fill |
| --- | --- | --- |
| Accepted | `#216E4A` / `#E4F3EB` | `#82D0A9` / `#193529` |
| Rejected / danger | `#A92530` / `#FBE7E9` | `#EF858B` / `#3B2025` |
| Checking / warning | `#755400` / `#FFF0C2` | `#E8C766` / `#382F18` |
| Grading / info | `#245A96` / `#E3EDF8` | `#91B9E8` / `#1B2D44` |
| Appeal | `#684384` / `#EFE7F4` | `#C9ADE2` / `#30243F` |
| Unsolved | `#4E5868` / `#DDE2EA` | `#BBC2CE` / `#2D3441` |

The web layer exposes these as `status-*` and `status-*-soft`. Keep glyphs and
text legends. Cards remain neutral; homework color belongs on the problem or
subproblem identifier controls.

An open coffin is a teacher workflow state, not a submission verdict. Its
problem header and empty/active problem cells use `bg-warning-soft
text-warning`; accepted, checking, rejected, and appeal treatments still take
precedence when a cell has a submission status. A released coffin returns to
the neutral `surface-subtle` header treatment.

Teacher-private notes use `private`, `private-soft`, and `private-border`. The
photo viewer uses its owned `media-*` tokens so its dark canvas is intentional,
not an undocumented gallery hex.

## Navigation and components

The left rail uses a restrained `selected` background and a narrow indigo edge.
The active top-bar tab uses an indigo bottom rule, not a rounded pill. Buttons,
inputs, selects, textareas, dialogs, cards, tables, and dropdowns are owned
components and should use the role utilities above. Never remove a focus ring.

The class-based theme is toggled by `ThemeProvider` and persisted as
`localStorage` key `my239.theme`; `ThemeToggle` lives in the top bar. The module
registry drives rail entries and top-bar pages from one source.

## Extension checklist

- Add a token to `theme.css` under `@theme`, `:root`, and `.dark`.
- Use a semantic pairing and verify contrast with `npm run test:colors`.
- Keep card surfaces neutral and status communication redundant with text/glyphs.
- Avoid raw hex, Tailwind named palettes, gradients, blurred chrome, and
  decorative amber/indigo repetition.
