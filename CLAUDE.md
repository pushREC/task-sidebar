# task-sidebar — Agent Governance

> **Read this file first when working in this repo.**
> High-level architecture lives in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
> Design doctrine lives in [`docs/UI-UX.md`](docs/UI-UX.md).
> Decision rationale lives in [`docs/DECISIONS.md`](docs/DECISIONS.md).

This document is the single source of truth for HOW code is changed here.
Violating any rule in this file will break either the Zero Assumptions policy,
the aesthetic lock, or the data-model contract.

---

## Zero Assumptions Policy

Three corollaries specific to task-sidebar:

1. **Never assume server-client contract** — if you rename a field on the
   Task or Project type in `server/vault-index.ts`, you MUST also update
   `src/api.ts` + every consumer in `src/components/**` and `src/views/**`.
   The `text → action` regression in v2.0 cost a user-visible bug.

2. **Never write to the vault without `assertSafeTasksPath` + `writeFileAtomic`
   (or `writeFileExclusive` for creates).** Path safety is non-negotiable.
   See [`docs/SECURITY.md`](docs/SECURITY.md) for the full safety-boundary catalog.

3. **Never assume `priority_infer.py` or `status_reconcile.py` is reachable.**
   Both are optional env-gated subprocess integrations (see [`docs/LIFE-OS.md`](docs/LIFE-OS.md)).
   Graceful degradation is required — `priority === null` is a valid state.

---

## Architecture lock

These cannot be changed without explicit user approval:

| # | Lock | Rationale |
|---|------|-----------|
| 1 | **Darkroom-Minimal aesthetic** (both themes low-chroma, single accent) | /ui-ux skill Section 11 — committed aesthetic direction |
| 2 | **Geist Sans + Geist Mono** via `@fontsource` | AI-tell avoidance (system-ui is flagged) |
| 3 | **Lucide icons only** | Ditto — zero Unicode pseudo-icons |
| 4 | **Property List detail panel** (label-left, click-to-edit, `+ set X` placeholders) | User-tested, matches pushrec-dashboard density |
| 5 | **Auto-promote on first field edit** (no Promote button) | User explicitly requested in detail-panel redesign |
| 6 | **Responsive body width** (no fixed 340px, no resize handle) | Follows Preview panel width naturally |
| 7 | **Vault-relative paths in all API responses** | M19 sprint-2 guarantee; zero absolute-path leakage |
| 8 | **Priority INFERRED, never stored** | DECISION-037 from life-os |
| 9 | **Field allowlist on field-edit** (status/priority/created/constructor rejected) | Sprint-2 P0 security fix |
| 10 | **`writeFileExclusive` (O_EXCL) for creates** | TOCTOU-safe |

If a sprint needs to change any of these, the user must reopen the decision
explicitly. Do not silently migrate.

---

## Quality gates

No commit / ship without ALL of these passing:

```bash
bash scripts/verify.sh           # 68 functional + UI + safety checks
pnpm tsc --noEmit                # zero new TS errors in src/
grep -rn "console\.\(log\|warn\|debug\)" src/   # must be empty
grep -rn "as any\|font-bold" src/               # must be empty
grep -rn "⚙\|⏎\|›\|○\|●" src/                  # must be empty (Unicode pseudo-icons banned)
grep -rn "task\.text" src/                      # must be empty (field renamed to action)
```

The 68-check `scripts/verify.sh` covers: read endpoints, SSE, 4-Archive /
Templates / path-traversal blocks, invalid-JSON handling, field allowlist,
50-parallel toggle race, symlink blocks, TOCTOU, CRUD round-trips, entity
auto-promote round-trip, project inferred fields, parent-goal-timeframe
bonus, and AI-tell greps.

---

## What lives where

```
codebases/vault-sidebar/
├── .claude/launch.json          ← Preview panel config
├── package.json
├── vite.config.ts
├── tsconfig.json
├── server/                      ← Express + Vite middleware, port 5174
│   ├── index.ts                 ← bootstrap + error middleware + SSE
│   ├── vault-index.ts           ← dual-model parser (inline + entity), priority call, goal-timeframe lookup
│   ├── priority.ts              ← subprocess pool (4 workers) to priority_infer.py
│   ├── status-reconcile.ts      ← fire-and-forget to status_reconcile.py on done transitions
│   ├── sse.ts                   ← GET /api/events
│   ├── watcher.ts               ← chokidar on 1-Projects/**/*.md
│   ├── safety.ts                ← assertSafeTasksPath + resolveTasksPath + safetyError
│   ├── routes.ts                ← 11 POST endpoints
│   └── writers/
│       ├── atomic.ts            ← writeFileAtomic + writeFileExclusive (O_EXCL)
│       ├── slug.ts              ← shared extractSlug
│       ├── task-toggle.ts       ← [ ]/[/]/[x] tri-state
│       ├── task-add.ts
│       ├── task-edit.ts
│       ├── task-move.ts
│       ├── task-field-edit.ts   ← allowlist + per-field validators
│       ├── task-status-edit.ts  ← state machine + reconcile
│       ├── task-create-entity.ts ← O_EXCL creation
│       ├── task-promote.ts       ← inline → entity migration
│       ├── task-promote-and-edit.ts ← auto-promote + field-edit atomic
│       └── project-field-edit.ts
├── src/                         ← React app
│   ├── main.tsx
│   ├── App.tsx                  ← tabs, SSE subscription, keyboard wiring, theme popover
│   ├── api.ts                   ← typed fetch wrappers (11 endpoints)
│   ├── store.ts                 ← Zustand; expandedTaskId, expandedProjectSlug, entityCreateMode
│   ├── styles.css               ← all CSS; Darkroom-Minimal tokens; 3 themes
│   ├── components/
│   │   ├── TaskRow.tsx
│   │   ├── TaskDetailPanel.tsx  ← Property List, WikilinkChip, RankChip, DueChip
│   │   ├── ProjectDetailPanel.tsx
│   │   ├── QuickAdd.tsx         ← entity-mode toggle
│   │   ├── EntityCreateForm.tsx ← modal for canonical task creation
│   │   ├── SkeletonRow.tsx      ← shimmer during load
│   │   └── EmptyState.tsx       ← Lucide + gentle-bounce
│   ├── views/
│   │   ├── TodayView.tsx
│   │   ├── ProjectsView.tsx
│   │   └── AllTasksView.tsx
│   └── lib/
│       ├── keyboard.ts          ← global keydown handler
│       └── theme.ts             ← system/light/dark cycle
└── scripts/
    └── verify.sh                ← 68-check regression battery
```

**Never place code outside `src/` / `server/` / `scripts/`.**

---

## Integration points (read these before changing anything related)

| External | Configured via | What it provides |
|----------|-----------------|------------------|
| life-os priority inference | `PRIORITY_SCRIPT_PATH` env var (see `.env.example`) | Optional — computes `priority.rank` + `priority.score` from impact/urgency/due/goal-timeframe. Without it, tasks surface `priority: null`. |
| life-os status reconcile | `RECONCILE_SCRIPT_PATH` env var | Optional — fires after `status: "done"` transitions for parent-goal rollup. Without it, done-transitions stay local. |
| Obsidian Tasks plugin convention | (external) | `[/]` checkbox char → in-progress per convention |
| Vault filesystem | `VAULT_ROOT` env var (defaults to `./sample-vault`) | Your PARA-structured vault |

See [`docs/LIFE-OS.md`](docs/LIFE-OS.md) for the priority-script API contract if you want to enable the integration.

---

## Safety invariants — non-negotiable

- Never write to `4-Archive/`, `Templates/`, `.obsidian/`
- Never accept a path that escapes VAULT_ROOT (realpath + startsWith check)
- Never follow a symlink whose realpath is outside VAULT_ROOT
- Never accept `..` / `\0` / `/` in a slug
- Never write `priority`, `created`, `constructor`, `__proto__`, `prototype`
  via `field-edit` (allowlist rejects)
- Status transitions MUST go through `/api/tasks/status-edit` (triggers
  reconcile); `field-edit` redirects with 400 if `field === "status"`
- Response paths MUST be vault-relative (`1-Projects/...`), never absolute
  (`/Users/...`). Lock #7 guarantee.

Full catalog + live verification commands in [`docs/SECURITY.md`](docs/SECURITY.md).

---

## When a sprint completes

Document what shipped in a project HANDOFF / changelog of your own choosing. Mark TODO items complete. Run `scripts/verify.sh` and confirm `37/37 passed, 0 failed` (against the bundled sample-vault) before declaring done.

---

## Not in scope for this codebase

Do NOT build here:

- Kanban view (pushrec-dashboard has this)
- CodeMirror editor (pushrec-dashboard has this)
- CRM (pushrec-dashboard has this)
- Filter builder UI
- SQLite cache of vault (we read the filesystem directly, on purpose)
- Drag-drop task reorder
- Tags with colored enum UI
- Subtasks nested editing (v2.2 maybe; not now)
- Any auth layer (single-user loopback only)
- Any deployment target (local-only, never leaves the laptop)

If a user asks for one of these, first ask whether a different tool is a better fit for the need. task-sidebar is intentionally narrow; dilution kills the thing that makes it good.

---

*Last updated: 2026-04-18*
*Maintainer: this file + HANDOFF.md are the single source of truth. Keep them current.*
