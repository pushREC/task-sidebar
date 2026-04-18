# vault-sidebar — Agent Governance

> **Read this file first when working in `codebases/vault-sidebar/`.**
> Vault project metadata lives at [`1-Projects/vault-sidebar/`](../../1-Projects/vault-sidebar/).
> Start with that README + HANDOFF.md before making changes.

This document is the single source of truth for HOW code is changed here.
Violating any rule in this file will break either the Zero Assumptions policy,
the aesthetic lock, or the life-os schema contract.

---

## Zero Assumptions Policy

Inherits the vault-root [CLAUDE.md](../../CLAUDE.md) policy in full. Three
specific corollaries for this codebase:

1. **Never assume server-client contract** — if you rename a field on the
   Task or Project type in `server/vault-index.ts`, you MUST also update
   `src/api.ts` + every consumer in `src/components/**` and `src/views/**`.
   The `text → action` regression in v2.0 cost a user-visible bug.

2. **Never write to the vault without `assertSafeTasksPath` + `writeFileAtomic`
   (or `writeFileExclusive` for creates).** Path safety is non-negotiable.

3. **Never assume `priority_infer.py` or `status_reconcile.py` is reachable.**
   Both are shell-outs with 500ms / 3s timeouts. Code must handle `null` /
   timeout gracefully. `priority === null` is a valid state.

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

| External | Path | What we use it for |
|----------|------|--------------------|
| life-os priority inference | `~/.claude/skills/life-os/scripts/priority_infer.py` | Subprocess call from `server/priority.ts` |
| life-os status reconcile | `~/.claude/skills/life-os/scripts/status_reconcile.py` | Fire-and-forget from `server/status-reconcile.ts` on done transitions |
| vault-manager skill | `~/.claude/skills/vault-manager/` | Not called at runtime; we implement safety in-process, but our validation rules MUST match vault-manager's allowlist |
| life-os entity schema | `~/.claude/skills/life-os/references/entity-schemas.md` | Task + Project frontmatter contract |
| Obsidian Tasks plugin | (external) | `[/]` checkbox char → in-progress per convention |
| Preview panel | Claude Code desktop app | Hosts the sidebar; `.claude/launch.json` declares the dev server |
| claude-peers broker | `127.0.0.1:7899` (via `codebases/claude-peers-mcp/`) | Planned v2.1 chat bridge |

---

## Safety invariants — non-negotiable

From vault-root [CLAUDE.md](../../CLAUDE.md) + life-os + sprint-2 hardening:

- Never write to `4-Archive/`, `Templates/`, `.obsidian/`
- Never accept a path that escapes VAULT_ROOT (realpath + startsWith check)
- Never follow a symlink whose realpath is outside VAULT_ROOT
- Never accept `..` / `\0` / `/` in a slug
- Never write `priority`, `created`, `constructor`, `__proto__`, `prototype`
  via `field-edit` (allowlist rejects)
- Status transitions MUST go through `/api/tasks/status-edit` (triggers
  reconcile); `field-edit` redirects with 400 if `field === "status"`
- Response paths MUST be vault-relative (`1-Projects/...`), never absolute
  (`/Users/...`). M19 sprint-2 guarantee.

---

## When a sprint completes

Update [`../../1-Projects/vault-sidebar/HANDOFF.md`](../../1-Projects/vault-sidebar/HANDOFF.md)
with what shipped. Mark tasks in [`../../1-Projects/vault-sidebar/tasks.md`](../../1-Projects/vault-sidebar/tasks.md) as `- [x]` + `@owner`.
Run `scripts/verify.sh` and paste the 68/68 result into HANDOFF.

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
- Any feature that reads `~/.claude/memory/memory.db` or similar
- Any auth layer (single-user loopback only)
- Any deployment target (local-only, never leaves the laptop)

If a user asks for one of these, first ask whether the right answer is to do
it in [pushrec-dashboard](../../1-Projects/pushrec-dashboard) instead.

---

*Last updated: 2026-04-18*
*Maintainer: this file + HANDOFF.md are the single source of truth. Keep them current.*
