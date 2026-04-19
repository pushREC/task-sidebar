# Architecture

> Read this doc to understand how task-sidebar is wired. For the *why* behind specific design choices, see [`DECISIONS.md`](DECISIONS.md). For the data shapes, see [`DATA-MODEL.md`](DATA-MODEL.md). For the a11y + motion language, see [`UI-UX.md`](UI-UX.md).

## Two halves, one process

task-sidebar is a single-process Vite dev server with Express middleware handling the API. Client + server live in the same Node process, port 5174.

```
┌──────────────────────────────────────────────────┐
│  Vite dev server (HMR + static assets)           │
│  ─────────────────────────────────               │
│  Express middleware (POST /api/*, SSE /api/events)│
│  ─────────────────────────────────               │
│  chokidar watcher on $VAULT_ROOT/1-Projects/     │
└──────────────────────────────────────────────────┘
                    │
                    ▼
            $VAULT_ROOT (your vault)
```

No separate backend server, no WebSocket, no database. Plain markdown in → plain markdown out. Everything else is middleware.

## Server layer

Every file under `server/`.

### Bootstrap (`server/index.ts`)

Boots in this exact order (matters for the tombstone-restore invariant):

1. `ensureTombstoneDir()` — creates `$VAULT_ROOT/.vault-sidebar-tombstones/` with mode 700.
2. `cleanupOrphans()` — sweeps tombstones older than 1 hour (catches crash-restart residue).
3. `app.listen(PORT)` — now accepting HTTP.
4. `setInterval(sweepTombstones, 8_000)` — sweeps any tombstone older than 8s.
5. SIGTERM/SIGINT/beforeExit → clear sweep interval, close watcher, final sweep.

### Request flow

```
POST /api/tasks/toggle
  │
  ▼
server/routes.ts                    ← 11 POST handlers
  │   extracts input + catches SafetyError → 403/400/409/500
  ▼
server/writers/task-toggle.ts       ← per-endpoint writer
  │   calls assertSafeTasksPath(path) → rejects if unsafe
  │   calls resolveTasksPath(path)    → realpath + startsWith guard
  │   reads file, mutates, writes via writeFileAtomic (temp + rename)
  │
  └─→ invalidates in-memory vault index (Plan II I.4, when that ships)
      └─→ server/sse.ts broadcasts "vault-changed" to all clients
```

### Writer catalog (`server/writers/`)

| File | Endpoint | What it does |
|---|---|---|
| `task-toggle.ts` | `POST /api/tasks/toggle` | Flips `[ ]` / `[/]` / `[x]` on an inline task. Tri-state supports `done: "next"` (cycles). |
| `task-add.ts` | `POST /api/tasks/add` | Appends a new `- [ ] text` line under Open or Inbox section. Enforces ≥3 char minimum. |
| `task-edit.ts` | `POST /api/tasks/edit` | Replaces the action text of an existing inline task (line-indexed). |
| `task-move.ts` | `POST /api/tasks/move` | Moves a task between sections. |
| `task-field-edit.ts` | `POST /api/tasks/field-edit` | Updates a single frontmatter field on an entity task. Hard allowlist rejects `status`/`priority`/`created`/`constructor`. |
| `task-status-edit.ts` | `POST /api/tasks/status-edit` | State machine for status transitions. Fires reconcile subprocess on `done`. |
| `task-create-entity.ts` | `POST /api/tasks/create-entity` | Creates a new `tasks/<slug>.md` with O_EXCL. TOCTOU-safe — only 1 of N concurrent creates wins. |
| `task-promote.ts` | `POST /api/tasks/promote` | Inline line → entity file. Removes the inline line atomically. |
| `task-promote-and-edit.ts` | `POST /api/tasks/promote-and-edit` | Promote + field-edit in one call (Lock #5: auto-promote on first field edit). |
| `task-delete.ts` | `POST /api/tasks/delete-entity` + `POST /api/tasks/delete-inline` | Moves target to tombstone. Response includes `tombstoneId` for undo. |
| `task-body-edit.ts` | `POST /api/tasks/body-edit` | Rewrites markdown body of entity task. mtime optimistic lock: client passes `expectedModified` string; 409 + `currentModified` if stale. |
| `task-tombstone.ts` | `POST /api/tasks/restore-tombstone` | Writer module + restore route. See [`SECURITY.md`](SECURITY.md) for details. |
| `project-field-edit.ts` | `POST /api/projects/field-edit` | Updates a single frontmatter field on a project `README.md`. |

### Safety boundary (`server/safety.ts`)

**The most important file in the repo.** Every writer calls `assertSafeTasksPath` before any filesystem write. Guards:

- Path must be under `$VAULT_ROOT` after `realpath` resolution (blocks symlink escapes).
- Path must NOT contain a forbidden segment: `4-Archive`, `Templates`, `.obsidian`.
- Path must match one of three regex shapes: `1-Projects/<slug>/tasks.md`, `1-Projects/<slug>/tasks/<task-slug>.md`, or `1-Projects/<slug>/[<SLUG>-]README.md`.
- Slug must not contain `..`, `/`, or `\0`.
- `VAULT_ROOT` is the single source of truth — exported once from this file, imported by all 13 other server modules. Configurable via `VAULT_ROOT` env var; defaults to `./sample-vault`.

### Parser (`server/vault-index.ts`)

Walks `$VAULT_ROOT/1-Projects/*/` at every `GET /api/vault`. For each project:

1. Read `README.md` → gray-matter → project frontmatter.
2. Read `tasks.md` line-by-line → extract inline tasks (regex matches checkbox + action + `@owner(...)`).
3. Read `tasks/*.md` → gray-matter → entity task frontmatter.
4. Compute inferred priority via `server/priority.ts` (optional subprocess).
5. Compute inferred project fields (progress %, health chips).

Returns a `VaultIndex` structure: `{ projects: Project[], generatedAt }`. See [`DATA-MODEL.md`](DATA-MODEL.md) for the exact shape.

Plan II Sprint I adds an in-memory cache layer; until then, every `/api/vault` is a full walk (< 50ms for sample-vault, ~20ms for the author's 30-project vault).

### File watcher (`server/watcher.ts`)

chokidar watches `$VAULT_ROOT/1-Projects/**/README.md` and `**/tasks.md` and `**/tasks/*.md`. On any change:

1. Extract the slug from the file path.
2. Debounce 150ms (to absorb editor save-bursts).
3. Broadcast `event: vault-changed\ndata: {"slug":"demo-app"}` to all SSE subscribers.

Clients receiving the event call `fetchVault()` and re-render. Writer-originated changes will also invalidate the in-memory cache synchronously before broadcasting (Plan II Lock #7, shipping in Sprint I).

### SSE (`server/sse.ts`)

A single route: `GET /api/events`. Holds the response open; writes `event: ...` lines when `broadcast()` is called. Clients: `new EventSource("/api/events")`.

### Optional subprocess integrations

- `server/priority.ts` — shells out to `priority_infer.py` (life-os) with a 4-worker pool + 500ms hard timeout + LRU cache. Returns `{score, rank, breakdown}` or `null`. Env-gated via `PRIORITY_SCRIPT_PATH`; no-op if unset.
- `server/status-reconcile.ts` — fire-and-forget subprocess to `status_reconcile.py` on every `status: "done"` transition. 3s hard timeout. Env-gated via `RECONCILE_SCRIPT_PATH`; no-op if unset.

See [`LIFE-OS.md`](LIFE-OS.md) for wiring.

## Client layer

Every file under `src/`.

### Store (`src/store.ts`)

Zustand store with `persist` middleware. Persisted: `activeTab`, `collapsedBucketsArr`, `expandedProjectsArr`. Transient (not persisted): `vault`, `selectedTaskIds`, `pendingUndo`, `errorTaskIds`, `taskErrorMessages`, `maxAppliedVaultSeq`.

Every store mutation is a single setter — no action/reducer boilerplate. Components subscribe to narrow slices via `useSidebarStore(s => s.X)`. (Plan II Sprint I.3 will collapse the 13 TaskRow subscriptions into one `useShallow` tuple with careful Map-exclusion; see [`DECISIONS.md`](DECISIONS.md) B2.)

### Data fetching (`src/api.ts`)

Typed wrappers around `fetch`. Every wrapper returns `ApiResult<T> = {ok:true, data:T} | {ok:false, error:string}`. No throws on HTTP errors — always a discriminated union.

Monotonic sequence counter `nextVaultSeq()` pairs with every `fetchVault()` call; stale responses are dropped by `setVault(vault, seq)`. See Plan II R2 D3 commit for the race this fixes.

### Components (`src/components/`)

Each component follows the same discipline: one concern, ≤300 lines, zero inline styles (2 explicit exceptions documented), zero emojis, zero `as any`, zero `console.log`. See [`UI-UX.md`](UI-UX.md) for the full catalog.

### Views (`src/views/`)

- `AgendaView.tsx` — time-bucketed tasks across all projects. Overdue / Today / Tomorrow / This Week / auto-split (Next Week vs Later) / No date buckets. Done inline with strikethrough; cancelled hidden.
- `ProjectsView.tsx` — grouped by project. Show inactive toggle.

### Keyboard (`src/lib/keyboard.ts`)

Global `keydown` listener. Guards against capturing keys when focus is in an input/textarea/select/contenteditable. Dispatches to store setters based on key + modifier.

### Theme (`src/lib/theme.ts`)

3-way cycle: system / light / dark. Reads `prefers-color-scheme` for system mode. Applies `data-theme` attribute on `<html>` — CSS custom properties swap via attribute selectors.

## Data flows

### Reads

```
Client mount
  │
  ▼
fetchVault() ──────► GET /api/vault
                    │
                    ▼
               vault-index.ts walks VAULT_ROOT/1-Projects/
                    │
                    ▼
               returns VaultIndex JSON
  │
  ▼
store.setVault(vault, seq)
  │
  ▼
All subscribed components re-render
```

Plus a parallel `new EventSource("/api/events")` that triggers a re-fetch on `vault-changed` events.

### Writes (optimistic)

```
User toggles checkbox
  │
  ▼
store.optimisticToggle(taskId)  ← flips the task locally first
  │
  ▼
toggleTaskApi({tasksPath, line, done})
  │    │
  │    ▼ (fire-and-forget, non-blocking)
  │  POST /api/tasks/toggle
  │    │
  │    ▼
  │  task-toggle.ts writes file atomically
  │    │
  │    ▼
  │  chokidar detects change → SSE broadcast
  │
  └─→ on 200: nothing (store already flipped)
      on error: store.markTaskError(taskId, errorMessageFor(result))
```

### Writes (undoable)

```
User bulk-deletes 5 tasks
  │
  ▼
loop: deleteEntityTaskApi per task → collects [tombstoneId × 5]
  │
  ▼
store.setPendingUndo({
  action: "delete",
  taskIds: [...],
  label: "5 tasks deleted",
  revert: async () => {
    for (id of tombstoneIds.reverse())
      await restoreTombstoneApi({tombstoneId: id})
  }
})
  │
  ▼
UndoToast renders 5s countdown. User clicks Undo OR presses ⌘Z.
  │
  ▼
revert() fires. Files restored from tombstones (byte-identical).
```

Tombstones live in `$VAULT_ROOT/.vault-sidebar-tombstones/`, outside the chokidar-watched tree. Filename encodes `{timestampMs}__{kind}__{base64url(path)}.md` for entity; inline tombstones carry the line + text in the filename too. Sweeper reclaims anything older than 8s. See [`SECURITY.md`](SECURITY.md) for the full hardening story.

## Non-goals

task-sidebar is intentionally **not** building:

- Kanban view (different tool — columns vs rows)
- CodeMirror editor (use Obsidian itself for editing)
- CRM (different data model)
- Any auth layer (single-user loopback only)
- Any remote/cloud sync (the vault is your sync — use Obsidian Sync, iCloud, Syncthing, or git)

Adding any of those would violate Lock #6 (responsive body width = stays narrow) or dilute the single purpose. Keep the sidebar narrow; run Obsidian full-width in another pane.
