# my239 design system — "Scholarly warm"

The visual language of the my239 web app. It should feel like a **well-made
textbook**: warm paper, a refined serif for headings, a clean humanist sans for
the UI, generous whitespace, hairline rules, and restraint with motion and
colour. Quiet and scholarly — never flashy.

Everything here is defined as **design tokens** (CSS variables surfaced as
Tailwind v4 utilities) and a small set of **owned components** built on Radix
primitives. There is no third-party theme to fight; we own every pixel.

- Tokens & theme: [`theme.css`](./theme.css)
- Owned components: [`ui/`](./ui) (barrel: [`ui/index.ts`](./ui/index.ts))
- Class helper: [`cn.ts`](./cn.ts)
- Light/dark switch: [`theme-provider.tsx`](./theme-provider.tsx)
- Module navigation: [`../shell/modules.ts`](../shell/modules.ts)

---

## Principles

1. **Paper, not screens.** The base is warm off-white (`paper`), surfaces are a
   touch lighter, separators are hairline. Avoid hard black and pure white.
2. **Serif for voice, sans for work.** Display serif (Spectral) for the wordmark
   and page/section titles; humanist sans (IBM Plex Sans) for everything
   interactive. Mono (IBM Plex Mono) for code/TeX.
3. **One accent, used sparingly.** A single deep teal carries primary actions,
   active states, and links. Colour earns its place; most of the UI is ink on
   paper.
4. **Hairlines over boxes.** Prefer a `border-line` rule or whitespace to heavy
   borders and shadows. Cards are flat with a thin border.
5. **Restrained motion.** One staggered page-load reveal (`animate-rise`); subtle
   hover transitions. Always honour `prefers-reduced-motion`.
6. **Cyrillic-first.** The product is Russian — every font is chosen for full
   Cyrillic coverage and self-hosted so it always renders.
7. **Dark mode is first-class.** Every token has a light and dark value; never
   hard-code a colour in a component.

---

## Typography

Three self-hosted families (via `@fontsource`, imported in
[`main.tsx`](../main.tsx); weights 400/500/600 only — we use just **regular**
and **medium**):

| Role | Family | Tailwind | Use for |
| --- | --- | --- | --- |
| Display | **Spectral** (serif) | `font-display` | Wordmark, page titles (`<h1>`), section/card titles |
| Body / UI | **IBM Plex Sans** | `font-sans` (default on `body`) | All interface text, labels, tables, buttons |
| Mono | **IBM Plex Mono** | `font-mono` | Code, raw TeX, tokens, IDs |

Conventions:
- Page title: `font-display text-3xl font-medium text-ink`.
- Card/section title: `font-display text-xl font-medium`.
- Body is `font-sans` by default (set on `body`) — you rarely set it explicitly.
- Two weights only: **400** (normal) and **500** (`font-medium`). Avoid 600/700.
- Sentence case everywhere (including Russian); no ALL-CAPS except tiny meta
  labels like `СКОРО`.

---

## Colour tokens

Defined once in [`theme.css`](./theme.css) as CSS variables and exposed as
Tailwind colour utilities (`bg-*`, `text-*`, `border-*`). **Always use the token
utility — never a raw hex.**

| Token / utility | Light | Dark | Meaning |
| --- | --- | --- | --- |
| `paper` | `#faf7f0` | `#14120d` | Page background |
| `surface` | `#fffdf8` | `#1c1a13` | Cards, inputs, raised surfaces |
| `surface-muted` | `#f2ede1` | `#262218` | Subtle fills, hover, metric tiles |
| `ink` | `#211d17` | `#ece5d6` | Primary text |
| `muted` | `#6c6557` | `#a79e8c` | Secondary text |
| `faint` | `#948c7b` | `#7d7564` | Tertiary text, placeholders, hints |
| `line` | `#e7e0cf` | `#322d21` | Hairline borders, row separators |
| `line-strong` | `#d7cdb6` | `#433c2c` | Emphasised borders, input outline |
| `accent` | `#0f6e56` | `#3cc39d` | Primary actions, links, active state |
| `accent-strong` | `#0b5743` | `#57d3b0` | Accent hover/active |
| `accent-soft` | `#e3f0ea` | `#143329` | Accent-tinted fills (badges, pills, active tab) |
| `accent-ink` | `#0b4636` | `#bdeadf` | Text/icon on `accent-soft` |
| `danger` | `#a3331f` | `#e8826f` | Destructive text/actions |
| `danger-soft` | `#f7e7e2` | `#2e1a16` | Destructive tint |
| `success` | `#2f7a4f` | `#5fbd86` | Success text |
| `warning` | `#97670f` | `#d8a44a` | Warning text |

Pairing rule: text on a tinted fill uses the matching `*-ink`/semantic token,
never plain black/grey — e.g. `bg-accent-soft text-accent-ink`,
`bg-danger-soft text-danger`.

---

## Theming (light / dark)

- Class-based: `theme.css` declares `@custom-variant dark (&:where(.dark, .dark *))`.
  Tokens live on `:root` (light) and `.dark` (dark).
- [`ThemeProvider`](./theme-provider.tsx) toggles `document.documentElement.classList`
  between light/dark, persists the choice to `localStorage` (`my239.theme`), and
  defaults to the OS `prefers-color-scheme`. Read/flip it with `useTheme()`; the
  [`ThemeToggle`](./ui/theme-toggle.tsx) button is in the top bar.
- **To add a token:** add `--color-x: var(--x)` under `@theme`, then `--x` values
  under both `:root` and `.dark`. It's now usable as `bg-x` / `text-x` / `border-x`.

---

## Shape, spacing, motion

- **Radius:** `rounded-lg` for controls (buttons, inputs), `rounded-2xl` for
  cards, `rounded-full` for badges/avatars.
- **Borders:** hairline `border border-line`; `border-line-strong` for emphasis
  (e.g. input outline). Avoid drop shadows; the one exception is the dropdown/
  dialog content (`shadow-lg shadow-black/5`).
- **Focus:** `focus-visible:ring-2 focus-visible:ring-accent/40` (+
  `ring-offset-2 ring-offset-paper` on buttons). Never remove focus rings.
- **Spacing:** generous — page content is centred in `max-w-5xl`; cards pad
  `p-6`; vertical rhythm in `rem`.
- **Motion:** `animate-rise` (0.5s ease-out, fade + 6px lift) for page/section
  entrances; stagger siblings with inline `style={{ animationDelay }}`. It is a
  no-op under `prefers-reduced-motion`. Buttons use `active:scale-[0.98]`.

---

## The `cn` helper

[`cn.ts`](./cn.ts) = `clsx` + `tailwind-merge`. Use it to compose conditional
classes and let later Tailwind classes win:

```tsx
import { cn } from '../design/cn'
<div className={cn('rounded-2xl border border-line', active && 'border-line-strong', className)} />
```

---

## Components

All live in [`ui/`](./ui) and are exported from [`ui/index.ts`](./ui/index.ts).
They are **ours** — built on Radix primitives where interactive, styled only with
tokens, and free to restyle. Import from the barrel:

```tsx
import { Button, Card, CardContent, Field, Input, Badge, Table, Tr, Td } from '../design/ui'
```

| Component | Variants / parts | Notes |
| --- | --- | --- |
| `Button` | `variant`: primary · secondary · ghost · danger · link · `size`: sm · md · lg · icon | `asChild` to render as a link, e.g. `<Button asChild><Link …/></Button>` |
| `Input` | `invalid` flag | Token-styled; pairs with `Field` |
| `Label` | — | Radix Label |
| `Field` | render-prop `({ id, invalid }) => …` | Wires label + control + error message with the right `id`/aria; the standard form row |
| `Card` | `CardHeader` · `CardTitle` · `CardDescription` · `CardContent` | Flat surface, thin border, `rounded-2xl` |
| `Avatar` | `initials` | Initials chip on `accent-soft` (Cyrillic-aware via `initials()` in `@my239/shared`) |
| `Badge` | `variant`: accent · neutral · success · danger | Role/status pills |
| `Spinner` / `FullPageSpinner` | — | Inline loader / centred full-page loader for route guards |
| `Dialog` | `Trigger` · `Content` · `Title` · `Description` · `Close` · `Overlay` | Radix Dialog; used by the admin create-token / create-center flows |
| `DropdownMenu` | `Trigger` · `Content` · `Item` · `Label` · `Separator` | User menu, mobile nav |
| `Table` | `THead` · `TBody` · `Tr` · `Th` · `Td` | Hairline rows, responsive overflow wrapper; admin lists |
| `ThemeToggle` | — | Light/dark switch |

### Form pattern (the house style)

`react-hook-form` + `zod` (schemas from `@my239/shared`) + `Field` + `Input`,
mapping backend `APIError.fields` onto form errors:

```tsx
const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(loginSchema) })
…
<Field label="Имя пользователя" error={errors.username?.message}>
  {({ id, invalid }) => <Input id={id} invalid={invalid} {...register('username')} />}
</Field>
```

---

## Module navigation (the "macOS" pattern)

A defining piece of the system: a **unified per-module navigation**. The left
rail is the module switcher (the "Dock"); the top bar shows the active module's
**pages as tabs** to the right of the `my239` wordmark (the "menu bar").

It is data-driven from one registry, [`../shell/modules.ts`](../shell/modules.ts):

```ts
interface ModuleDef {
  id; label; description; path; icon            // identity + rail entry
  status: 'active' | 'soon'                      // 'soon' renders disabled ("СКОРО")
  adminOnly?: boolean                            // hidden from non-admins
  pages?: { label; path; end? }[]               // top-bar tabs for this module
}
```

- `activeModule(pathname, isAdmin)` resolves the current module by longest path
  prefix (so `/admin/users` → the admin module), excluding `adminOnly` modules
  for non-admins.
- The top bar (`../shell/top-bar.tsx`) renders that module's `pages` as
  `NavLink` tabs (active tab = `accent-soft` pill); the rail
  (`../shell/nav-rail.tsx`) renders the module list.

**Adding a module** is one registry entry (+ its routes): give it `pages`, an
icon, and `adminOnly`/`status` as needed — the rail and top-bar tabs update
automatically.

---

## Extending the system — checklist

- **New colour?** Add it as a token in `theme.css` (both themes). Never hard-code.
- **New component?** Put it in `ui/`, build on a Radix primitive if interactive,
  style only with tokens, export from `ui/index.ts`, and support dark mode by
  construction (you will, if you only use tokens).
- **New page in a module?** Add a `ModulePage` to the module's `pages` and a route.
- **New module?** Add a `ModuleDef` to `modules.ts` + routes.

## Don'ts

- ❌ Raw hex / Tailwind palette colours (`text-gray-500`, `#333`) — breaks dark mode.
- ❌ `font-weight` 600/700, Title Case, or ALL-CAPS (except tiny meta labels).
- ❌ Drop shadows on cards, heavy borders, gradients.
- ❌ Removing focus rings.
- ❌ A second accent colour — keep it to the teal + semantic danger/success/warning.
