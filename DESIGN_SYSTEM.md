# Hot Cocoa Design System

Dense reference for AI assistants working on UI. Paste this at the start of any session that touches visual code.

---

## Token source of truth

`app/styles/tokens.css` — all raw values as CSS custom properties on `:root` using `--hc-*` prefix.
`app/globals.css` — Tailwind v4 `@theme inline` maps `--color-*`, `--font-*` to token vars, exposing Tailwind utilities.
`app/layout.tsx` — imports tokens.css before globals.css to establish cascade order.

**Never hardcode a hex value that maps to an existing token. Always use the Tailwind utility class or the CSS var.**

---

## Color tokens

| Token var          | Tailwind class     | Value     | Role                                  |
| ------------------ | ------------------ | --------- | ------------------------------------- |
| `--hc-base`        | `bg-base`          | `#100f0f` | Darkest surface: editor, auth, landing|
| `--hc-bg`          | `bg-bg`            | `#18181a` | App shell background                  |
| `--hc-panel`       | `bg-panel`         | `#1c1b1b` | Cards, inputs, panels, modals         |
| `--hc-elevated`    | `bg-elevated`      | `#1f1f21` | Above-panel surfaces                  |
| `--hc-hover`       | `bg-hover`         | `#252220` | Hover state for panels                |
| `--hc-text`        | `text-text`        | `#e8e6e3` | Primary text                          |
| `--hc-muted`       | `text-muted`       | `#9b9890` | Secondary/subdued text                |
| `--hc-subtle`      | `text-subtle`      | `#413e3c` | Tertiary text, labels, icons          |
| `--hc-accent`      | `bg-accent` / `text-accent` | `#755c4b` | Primary accent (warm brown) |
| `--hc-accent-hi`   | `bg-accent-hi`     | `#8b6d5a` | Accent hover state                    |
| `--hc-border`      | `border-border`    | `#252220` | Default border                        |
| `--hc-border-subtle` | `border-border-subtle` | `#1c1b1b` | Hair/structural border           |
| `--hc-error`       | `text-error`       | `#ef4444` | Error states                          |
| `--hc-warning`     | `text-warning`     | `#f59e0b` | Warning states                        |
| `--hc-success`     | `text-success`     | `#84cc16` | Success states                        |

Opacity modifier syntax works: `bg-accent/60`, `text-subtle/50`, `border-accent/40`.

---

## Typography

Font families: `--hc-font-sans` (Inter) is the default. `--hc-font-mono` (JetBrains Mono) for code.

### Type scale used in the app

| Size      | Tailwind     | Usage                                    |
| --------- | ------------ | ---------------------------------------- |
| 9px       | `text-[9px]` | Chapter grid thumbnail labels            |
| 10px      | `text-[10px]`| Metadata, overlay hints, progress steps  |
| 11px      | `text-[11px]`| Section headers, form labels (uppercase) |
| 12px/`xs` | `text-xs`    | Secondary body, links, captions          |
| 14px/`sm` | `text-sm`    | Button text, primary body copy           |
| 16px/`base`| `text-base` | Inputs, form fields (min for iOS)        |
| 18px/`lg` | `text-lg`    | Auth page headings                       |
| 20px/`xl` | `text-xl`    | Chapter title, account page heading      |

### Label pattern (uppercase tracking)
```
text-[11px] font-medium tracking-wide uppercase text-subtle
```
Use the `Label` component from `components/ui` for form labels. For non-form section headers (e.g. in sidebars), apply these classes directly to `<p>` or `<span>`.

---

## Radius

| Token var          | Value   | Tailwind equiv | Usage                          |
| ------------------ | ------- | -------------- | ------------------------------ |
| `--hc-radius-sm`   | 4px     | `rounded`      | Chapter grid items             |
| `--hc-radius`      | 8px     | `rounded-lg`   | Inputs, buttons, scene blocks, cards |
| `--hc-radius-lg`   | 12px    | `rounded-xl`   | Account cards                  |
| `--hc-radius-xl`   | 16px    | `rounded-2xl`  | Modals                         |
| `--hc-radius-full` | 9999px  | `rounded-full` | Pills, circular buttons        |

Use Tailwind's `rounded-*` classes directly — they map to the radius scale above.

---

## Component library: `components/ui/`

All components use token-based Tailwind classes. No hardcoded hex.

### `Button`

```tsx
import { Button } from "@/components/ui";

// primary (default) — w-full, accent bg
<Button loading={loading} onClick={fn}>Log in</Button>

// secondary — auto width, panel bg with border
<Button variant="secondary" className="self-start">Send reset link</Button>

// ghost — plain text link style
<Button variant="ghost" onClick={fn}>Cancel</Button>
```

**Variants:**
- `primary`: `w-full py-2.5 rounded-lg bg-accent text-text text-sm font-semibold tracking-wide hover:bg-accent-hi disabled:opacity-50`
- `secondary`: `px-4 py-2 rounded-lg bg-panel border border-border text-text text-xs font-medium hover:border-accent/40 disabled:opacity-50`
- `ghost`: `text-xs text-subtle/60 hover:text-subtle`

`loading` prop disables the button and replaces children with "Please wait…".

### `Input`

```tsx
import { Input } from "@/components/ui";

<Input type="email" placeholder="you@example.com" value={val} onChange={fn} />
```

Always `w-full`. Background `bg-panel`, border `border-border`, focus ring `focus:border-accent/60`. Font size `text-base` (16px, prevents iOS zoom).

Supports `ref` via `forwardRef`. Pass `className` to override (e.g. `className="bg-base"` when the input sits on a darker panel).

### `Label`

```tsx
import { Label } from "@/components/ui";

<Label>Email</Label>
<Label htmlFor="phone">Phone number</Label>
```

Renders a `<label>` element. Styles: `text-[11px] font-medium tracking-wide uppercase text-subtle mb-1.5`. Only for form inputs — for section headers use the raw classes on `<p>`.

### `Modal`

```tsx
import { Modal } from "@/components/ui";

{open && (
  <Modal onClose={() => setOpen(false)} maxWidth="max-w-sm" backdrop="medium">
    <div className="p-5 flex flex-col gap-3">
      {/* content */}
    </div>
  </Modal>
)}
```

Renders via `createPortal` into `document.body`. Handles Escape key. Clicking the backdrop calls `onClose`. Container: `bg-panel rounded-2xl shadow-2xl`. Props: `maxWidth` (default `max-w-lg`), `backdrop` (`"dark"` = `bg-black/85`, `"medium"` = `bg-black/70`).

---

## Recurring patterns NOT yet extracted

These appear in multiple places but live inline. Match them exactly when adding new UI.

### Section header (sidebar/library)
```tsx
<p className="text-[11px] font-medium tracking-wide uppercase text-subtle mb-2">
  Section name
</p>
```

### Scene block (focus state)
```tsx
className={`rounded-lg px-4 py-3 mb-2 transition-colors cursor-text ${
  focused ? "bg-panel" : "bg-transparent hover:bg-panel/50"
}`}
```

### Hover-reveal icon button
```tsx
className="hidden group-hover:flex text-subtle hover:text-error transition-colors"
```
Parent needs `className="group"`.

### Drag-over drop zone
```tsx
className={`rounded-lg border border-dashed transition-colors ${
  dragging ? "border-accent bg-accent/5" : "border-border-subtle hover:border-border"
}`}
```

### Resizable column divider
```tsx
className="w-px flex-shrink-0 bg-border-subtle hover:bg-accent/40 cursor-col-resize transition-colors active:bg-accent/60"
```

---

## Layout constants (write page)

From `app/write/page.tsx`:
```ts
LEFT_MIN = 160px,  LEFT_MAX = 360px,  LEFT_DEFAULT = 208px
RIGHT_MIN = 160px, RIGHT_MAX = 400px, RIGHT_DEFAULT = 240px
CENTER_MAX = 700px  // max-w-[700px] on the content column
```

---

## z-index scale

| Layer         | z-index |
| ------------- | ------- |
| Modals        | 50      |
| Save indicator| 10      |

---

## Motion

Default transition: `transition-colors` (150ms ease via Tailwind default).
Slow transition: `transition-all duration-300` — only for progress bars and panel slides.
Mobile panel slide: `transition-transform duration-200`.

---

## Scrollbar

Global 4px scrollbar defined in `globals.css`. Thumb: `var(--hc-border)`. Track: transparent. Applied automatically.

---

## iOS notes

- All `<input>` and `<textarea>` must have `font-size >= 16px` to prevent auto-zoom. The `Input` component enforces `text-base`. `[contenteditable]` is globally fixed with `font-size: 16px !important` in globals.css.

---

## File map

```
app/styles/tokens.css      — all CSS custom properties (--hc-*)
app/globals.css            — @theme inline mapping + base styles
app/layout.tsx             — imports tokens.css then globals.css
components/ui/Button.tsx   — Button component (primary/secondary/ghost)
components/ui/Input.tsx    — Input component
components/ui/Label.tsx    — Label component
components/ui/Modal.tsx    — Modal overlay + container
components/ui/index.ts     — barrel export
```
