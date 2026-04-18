# Sprint 0 — Visual picks

**URL:** http://127.0.0.1:5174/docs/visual-previews/
**Locked on:** 2026-04-18 by Robert

---

## V1 — In-progress row treatment → **V1A**

Static 4px emerald left-edge stripe. No pulse. Calm, unambiguous, zero motion cost.

## V2 — Priority pill style → **V2B**

P1/P2/P3/P4 pills (Linear-style). Red · amber · gray · faint.

## V3 — Agenda bucket headers → **V3A**

Sticky + chevron + count. Overdue/Today/Tomorrow use accent red for the header text.

## V4 — Detail panel breadcrumb → **V4B**

Two-line stacked: Goal on its own line, Project on its own line. Then timestamps. Then Action.
**Plan decision D24 updated to V4B (was default V4A).**

---

## Meta + §16 resolutions

- **Git strategy:** `git init` a scoped repo inside `codebases/vault-sidebar/`. Per-finding commits go to that repo.
- **Animation budget:** ALL four animations kept — status-toggle spring bounce (P01), bucket stagger-fade on mount (Sprint B), sync pill "saving→synced" transition (P04), undo toast slide-up (Sprint G). They never fire simultaneously so motion-noise stays controlled.
- **§16.1 Bulk delete copy:** `"Delete {N} tasks? Removes files. Cannot be undone."` — Cancel / Delete buttons, 500ms debounce on Delete.
- **§16.2 `c` shortcut for cancel:** *Default — awaiting explicit sign-off. Plan assumes safe (no conflict with existing bindings).*
- **§16.3 Palette width:** 480px fixed, responsive full-width at <520px viewport.
- **§16.5 Density threshold:** *Default — 10 tasks trigger Upcoming→Next Week+Later split.*
- **§16.6 Done-task retention:** *Default — done tasks stay strikethrough in their bucket until SSE refreshes them out or session reload.*

---

## Audit directive

Run **full codebase audit first** — 4 parallel ui-ux agents scan `src/` against ui-ux skill §1-13. Surface additional findings beyond the 44 already catalogued. Merge into Sprint A scope before execution.
