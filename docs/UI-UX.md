# UI/UX

> This document is the UI+UX doctrine of task-sidebar. It's written for two audiences: (a) a designer porting the aesthetic + interaction language to a different dashboard, (b) a Claude Code agent extending or debugging the existing sidebar. Section 7 "Porting kit" is the practical copy-paste guide.

## 0. The doctrine in one sentence

**Unmistakably hand-crafted, narrow, calm, low-chroma, Lucide-iconed, Geist-typed, reduced-motion-respected, keyboard-first, undoable.**

If a change would make the sidebar less unmistakably hand-crafted (introduce emojis, gradients, soft-tinted cards, fluffy animations, stock iconography), reject it. See Section 6 for the explicit anti-pattern list.

## 1. Aesthetic system — "Darkroom-Minimal" extended

**Role colors** (3 and only 3):

```
--accent         #d84a3e (dark) / #a63228 (light)  — critical, overdue, action
--ok             #3ea372 (dark) / #2a8558 (light)  — in-progress, success, agent-driven
--text-secondary #9a9590 (dark) / #5a5955 (light)  — muted everything else
```

Nothing else is colored. Priority pills (P1–P4) use gray-scaled accent tints, NOT a rainbow. Backgrounds are true near-black (`#0a0a0a`) in dark mode, warm off-white (`#faf9f5`) in light. Separators are rgba-alpha variants, never hex grays.

**Token families** (defined in `src/styles.css :root` + `[data-theme="light"]` overrides):

| Family | Tokens |
|---|---|
| Surface | `--bg`, `--bg-surface`, `--bg-hover` |
| Text | `--text-primary`, `--text-secondary`, `--accent-foreground` |
| Separator | `--separator` (6% α), `--separator-strong` (18% α) |
| Role | `--accent`, `--accent-dim`, `--ok`, `--ok-dim` |
| Priority | `--priority-p1`, `--priority-p2`, `--priority-p3`, `--priority-p4` |
| Skeleton | `--skeleton`, `--skeleton-hi` |
| Motion | (inline cubic-bezier today; Plan II Sprint J consolidates to `--ease-*` + `--duration-*` tokens) |

Never use a hardcoded hex outside the `:root` block. The AI-tell grep `text-\[#|bg-\[#|border-\[#` must return 0.

## 2. Typography

- **Geist Sans** (variable font via `@fontsource/geist-sans`) for all UI text
- **Geist Mono** (via `@fontsource/geist-mono`) for numbers, dates, counts, code
- Font weights: regular (400) for body, medium (500) for headers, semi (600) for pills
- **NEVER `font-bold`** (700) — AI-tell grep enforces. If you need more weight, go to 500 or use Geist Sans SemiBold via the variable axis.
- **Tabular numerals everywhere data is aligned**: `font-variant-numeric: tabular-nums` on every element that displays counts, due offsets ("−3d", "+2d"), line numbers, etc. Prevents wobble on scroll.

## 3. Spacing + radii

- **4px grid**. Every padding, gap, margin rounds to a multiple of 4px (4, 8, 12, 16, 24). Two intentional exceptions in chips/pills (2px inner padding) — documented inline.
- **Small radii** — 3px buttons, 4px inputs, 6px popovers, 8px modals. No pill-round containers except explicit pills (P1–P4).
- **No shadows** except the 4px scroll-cue on sticky bucket headers (see `BucketHeader.tsx`).

## 4. Component catalog

Each entry: signature + a11y choice + distinctive affordance.

### `TaskRow.tsx`
Circle + action + project title + due chip + P1–P4 pill + pencil-on-hover (Lucide `Pencil` 12px, opacity 0→1 over 150ms on row hover). Error-dot is a dismissible `<button>` with `data-error-msg` → tooltip on hover/focus. 4px emerald left-stripe when status="in-progress". 60% opacity + ⧖ Lucide icon when blocked. Strikethrough + 70% when done.

### `TaskDetailPanel.tsx`
V4B breadcrumb (goal line → project+trash line → timestamps). Property List layout (96px label column / 1fr value). Every row is `<button>` when clickable (keyboard Tab + Enter/Space) OR `<div>` when editing (avoids nested-interactive WHATWG violation). `aria-hidden={isDeleting}` on panel root during delete window. `aria-live="assertive"` on mtime-conflict banner with programmatic focus via rAF.

### `BulkBar.tsx`
Fixed bottom bar. Slides up over 200ms from `bottom: -60px` when `selectedTaskIds.size > 0`. Before `clearSelection()` unmounts the bar, `restoreFocusBeforeUnmount()` moves focus to `.quick-add-input` (stable anchor) → first task row → body as fallbacks.

### `UndoToast.tsx`
Bottom-right portal. 5s countdown + Undo button + X dismiss. `⌘Z` bound globally but bails when focus is in `<input>`, `<textarea>`, `<select>`, or contenteditable. Identity-guarded finally: captures `originalRef = getState().pendingUndo` at entry, only clears if the store still points at the same object (preserves terminal feedback set by revert closures).

`PendingUndo.terminal?: boolean` — when true (e.g. "Restore failed"), Undo button is suppressed + `aria-live="assertive"`.

### `CommandPalette.tsx`
`⌘K` opens a portal modal. 4 scopes: Tasks · Projects · Tabs · + Create. Input → fuzzy matcher (`src/lib/fuzzy.ts`) → max 20 results grouped by scope. Arrow keys navigate, Enter selects, Esc closes, Tab cycles scopes. On open, `document.activeElement` is snapshotted; on close, refocused.

### `QuickAdd.tsx`
Always visible at bottom of sidebar (above BulkBar when bar is open). Fuzzy project combobox + action text input. 3-char minimum action (mirrored client + server). Entity-mode toggle → opens `EntityCreateForm` modal.

### `BucketHeader.tsx`
Sticky + chevron + count + scroll-shadow. IntersectionObserver sentinel (planned Plan II Sprint J) adds `.bucket-header--scrolled` class when content has scrolled past; CSS `::after` pseudo-element renders a 4px linear-gradient shadow.

### `SkeletonRow.tsx`
Shimmer animation (1.5s ease-in-out infinite). Height-matched to real rows so the crossfade doesn't jump layout. `@media (prefers-reduced-motion: reduce)` zeroes out the animation.

### `EmptyState.tsx`
Lucide icon in circular bg + title + hint. 2s ease-in-out "gentle bounce" on mount — ONE iteration only (not infinite). JS removes the class after first animation ends.

## 5. Motion language

**Three signature moments.** These are what make the sidebar feel alive:

1. **Task toggle to done** — spring-bounce on checkbox circle (cubic-bezier(0.25, 0.9, 0.35, 1.25), 360ms) + simultaneous strikethrough fade + 70% opacity. Triggered via class-swap + DOM-reflow trick (to retrigger keyframe on already-painted element).
2. **Theme swap** — 80ms cross-fade on `body` + `header` + `tab-strip` + `quick-add` + modals. All surfaces fade simultaneously; no flash of wrong theme.
3. **Bulk bar slide-up** — 200ms cubic-bezier(0.25, 0.9, 0.35, 1.05) `translateY(60px) → translateY(0)` with `opacity 0 → 1`. Mirror on close.

**Timing** (inline today, Plan II Sprint J tokenizes):
- Quick (80–120ms): cross-fades, popover reveal, error tooltip
- Medium (150–180ms): tab underline, color transitions, list item expand
- Signature (200–360ms): bulk-bar slide, undo-toast in, spring-bounce checkbox

**Easing**:
- `ease-out`: standard fades + color changes
- `cubic-bezier(0.25, 0.9, 0.35, 1.25)`: spring-bounce with 25% overshoot
- `cubic-bezier(0.25, 0.9, 0.35, 1.05)`: subtle spring for bulk-bar + toast

**Press feedback** — every button gets `.press-scale`:
```css
.press-scale:active:not([disabled]) { transform: scale(0.97); }
```

**Reduced motion** — at the very bottom of `styles.css`:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Every animation respects this without individual opt-in. Skeletons stop shimmering. Bounces don't bounce. Spring-bounce becomes instant snap.

## 6. Anti-patterns — explicitly rejected

AI-tell greps in `scripts/verify.sh` enforce these. Any PR that lands a match fails CI.

- ❌ **No emojis anywhere** — Lucide icons only. Even comments.
- ❌ **No Unicode pseudo-icons** — `⚙`, `⏎`, `›`, `○`, `●` are banned. Lucide equivalent exists.
- ❌ **No `font-bold`** — Geist Sans has a variable-weight axis; use 500 or 600.
- ❌ **No `as any`** — strict TypeScript. If you genuinely need it, create a proper type + document why inline.
- ❌ **No `console.log|warn|debug` in `src/`** — server may write to `process.stderr`.
- ❌ **No purple/blue gradients** — Darkroom-Minimal allows only the 3 role colors.
- ❌ **No generic spinner borders** — use the 3-state loading pattern (skeleton → real content) or explicit state labels.
- ❌ **No hardcoded hex colors in components** — always use token var refs.
- ❌ **No inline styles** — 2 exceptions documented in `CLAUDE.md` (dynamic `position:fixed` + `opacity` based on state). Any new inline style needs justification in `CLAUDE.md`.
- ❌ **No `text system-ui` fallback** — Geist Sans only. Specifying system-ui in the stack would let the browser swap fonts at FOUT, which breaks the aesthetic.

## 7. Keyboard + accessibility

### Global keyboard map (`src/lib/keyboard.ts`)

| Key | Action |
|---|---|
| `1` / `2` | Switch to Agenda / Projects tab |
| `a` | Focus QuickAdd input |
| `j` / `k` | Move selection down/up (bounded within current bucket) |
| `Shift+j` / `Shift+k` | Extend range selection |
| `gj` / `gk` | Jump to next/previous bucket |
| `Tab` | Native browser focus order (not hijacked) |
| `Space` | Toggle selection of focused row |
| `⌘A` | Select all visible tasks |
| `x` | Toggle done on selected task(s) |
| `e` | Open inline edit on focused task |
| `Enter` | Open detail panel on focused task |
| `Esc` | Close modal → clear selection → collapse detail |
| `⌘K` / `Ctrl+K` | Open command palette |
| `⌘D` / `Ctrl+D` | Cycle theme (system → light → dark → system) |
| `⌘Z` / `Ctrl+Z` | Undo last destructive action (5s window) |

Guards: `⌘Z` bails when `activeElement` is `<input>`, `<textarea>`, `<select>`, or contenteditable. `⌘K` deliberately DOES capture regardless — palette must always be reachable.

### Focus restoration patterns

- **Panel open/close** — snapshot `document.activeElement` on open, call `.focus()` on the snapshot on close.
- **Bulk bar unmount** — `restoreFocusBeforeUnmount()` helper moves focus to `.quick-add-input` before `clearSelection()` unmounts the bar.
- **Modal dismiss** — ConfirmModal restores focus to the button that opened it (trash icon, usually).
- **Theme popover outside-click** — restores focus to the gear button.

### ARIA

- Live regions: `role="status"` + `aria-live="polite"` for non-critical updates; `aria-live="assertive"` for failures (delete errors, mtime conflicts).
- `aria-hidden={isDeleting}` on the entire TaskDetailPanel root during delete window — screen readers don't navigate into an about-to-unmount subtree.
- `aria-label` on every icon-only button (trash, pencil, X dismiss, theme toggle).
- `aria-controls` / `aria-expanded` on bucket headers pointing at bucket-body ids.

### WHATWG nested-interactive avoidance

Property rows in the detail panel flip between `<button>` (read-only, keyboard-activatable) and `<div>` (edit mode, contains `<input>` or `<select>`). Never render an `<input>` inside a `<button>` — that's an HTML validation error AND a real screen-reader bug.

## 8. Porting kit

Everything you need to apply this aesthetic + interaction language to a different dashboard.

### 8.1 Token block

Copy `src/styles.css` `:root` + `[data-theme="light"]` blocks. That's the complete design-system in ~60 lines. No runtime CSS-in-JS, no Tailwind config, no theme provider component needed.

### 8.2 `.press-scale` utility

```css
.press-scale { transition: transform 80ms ease-out; }
.press-scale:active:not([disabled]) { transform: scale(0.97); }
```

Apply as a class on every interactive button. That's the entire tactile-feedback system.

### 8.3 Keyframes bundle

Copy every `@keyframes` rule from `src/styles.css`. Key ones:

- `@keyframes row-stagger-in` (row-mount fade-in)
- `@keyframes task-complete-bounce` (spring-bounce on checkbox done)
- `@keyframes bulk-bar-slide-up`
- `@keyframes undo-toast-in`
- `@keyframes popover-reveal`
- `@keyframes skel-shimmer`
- `@keyframes error-tooltip-in`
- `@keyframes row-stagger-in`

### 8.4 Reduced-motion guard

Paste at the very bottom of your stylesheet:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

That single rule instantly makes your entire app vestibular-disorder-safe. Forgetting this is one of the most common accessibility failures in modern UIs.

### 8.5 Lucide icon set

```bash
pnpm add lucide-react
```

Use the same 3-prop pattern throughout:
```tsx
<Trash2 size={12} strokeWidth={2} aria-hidden="true" />
```

Wrap in a `<button aria-label="...">` when clickable. Never use Unicode pseudo-icons (`⚙`, `⏎`, `›`, `○`, `●`) — they render inconsistently across platforms and break in dark mode.

### 8.6 Focus restoration pattern

```ts
// Before any mutation that will unmount interactive children:
function restoreFocusBeforeUnmount() {
  const active = document.activeElement as HTMLElement | null;
  const activeInTransient = active?.closest(".transient-bar") !== null;
  if (!activeInTransient) return;
  const stableAnchor = document.querySelector<HTMLInputElement>(".primary-input");
  if (stableAnchor) { stableAnchor.focus(); return; }
  const fallback = document.querySelector<HTMLElement>("[data-row]");
  if (fallback) fallback.focus();
}
```

Copy verbatim from `src/components/BulkBar.tsx`. Adapt selector names to your DOM. This prevents the silent focus-to-body failure that most apps ship with.

### 8.7 Signature-moment checklist for a new dashboard

If your dashboard should feel as hand-crafted as task-sidebar:

1. Pick exactly 3 role colors. No more.
2. Pick 1 font family + 1 mono family. No fallbacks to system fonts.
3. Use Lucide only. Zero emojis.
4. Paste the press-scale utility + reduced-motion guard.
5. Identify your app's 3 signature moments (task-sidebar's are: toggle-to-done, theme-swap, bulk-bar). Spring-bounce one, cross-fade one, slide one.
6. Run the AI-tell grep battery from `scripts/verify.sh` against your codebase after every commit.

That's the whole playbook. Four hours to adopt; four years to sustain.

## 9. The `/ui-ux` skill (creative direction source)

Most of the doctrine above traces back to the `ui-ux` skill at `~/.claude/skills/ui-ux/` — a private reference doctrine the author built. It enforces:

- "Unmistakable human intentionality" as the prime directive
- A hard ban on 11 AI-tell patterns
- Mandatory reduced-motion handling
- 4px spacing grid enforcement
- Lucide-only icon policy

This repo's CLAUDE.md + the anti-pattern list in §6 above are the publicly-copy-pasteable version. If you're a Claude Code agent working on this codebase, you inherit those rules via CLAUDE.md automatically. If you're porting the aesthetic to your own codebase, adopt §6's anti-pattern list into your own CLAUDE.md.
