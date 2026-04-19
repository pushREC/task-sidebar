# Data Model

> How a "task" and a "project" are represented. This is the contract every writer, reader, and client component must honor.

## Vault layout

```
$VAULT_ROOT/
├── 1-Projects/                 ← the only folder task-sidebar reads
│   └── <slug>/                 ← one subfolder per project
│       ├── README.md           ← project frontmatter + overview
│       ├── tasks.md            ← inline task stream
│       └── tasks/              ← entity tasks (one file each)
│           └── <task-slug>.md
├── 2-Areas/                    ← recognized but unused (no writes allowed)
├── 3-Resources/                ← recognized but unused
└── 4-Archive/                  ← recognized + hard-blocked by safety (Lock #safety)
```

`<slug>` matches `[a-zA-Z0-9_-]+`. No spaces, no `..`, no `\0`. Slug validation is enforced by `server/safety.ts:validateSlug`.

## The dual-model task representation

Tasks exist in two shapes. Both render identically in the UI. Choose based on how much structure a task needs:

```typescript
// src/shared/types.ts — the canonical definition
export type Task = InlineTask | EntityTask;

export interface InlineTask {
  source: "inline";
  id: string;                    // derived: `inline:{slug}:{line}`
  tasksPath: string;             // vault-relative, e.g. "1-Projects/demo-app/tasks.md"
  line: number;                  // 1-indexed line number in tasks.md
  action: string;                // text after the checkbox
  done: boolean;
  status: Status;                // "open" | "in-progress" | "done" | "blocked" | "cancelled"
  owner?: "human" | "agent" | "either";
  priority?: PriorityResult | null;   // inferred at read time
  due?: string;                  // ISO YYYY-MM-DD (parsed from inline comment)
  modified?: string;             // ISO mtime (server-computed)
}

export interface EntityTask {
  source: "entity";
  id: string;                    // derived: `entity:{entityPath}`
  entityPath: string;            // vault-relative
  action: string;
  done: boolean;
  status: Status;
  owner?: "human" | "agent" | "either";
  priority?: PriorityResult | null;
  due?: string;
  impact?: "low" | "medium" | "high";
  urgency?: "low" | "medium" | "high";
  tags?: string[];
  created?: string;
  modified?: string;
  parentProject?: string;        // wikilink from frontmatter
}
```

TypeScript narrows on the `source` discriminator — consumers use `isInlineTask(task)` / `isEntityTask(task)` helpers (see `src/shared/types.ts`).

## Inline task line format

```
- [ ] action text @owner(human)     ← open, owned by human
- [/] action text @owner(agent)     ← in-progress, owned by agent
- [x] action text @owner(either)    ← done
```

Checkbox regex: `^(\s*)- \[([ xX/])\]\s+(.+)$`. The `[/]` variant is an Obsidian Tasks plugin convention meaning "in-progress" — task-sidebar respects it.

**Due dates on inline tasks** — optional inline HTML comment: `- [ ] ship it <!-- due:2026-06-30 -->`. Parsed by `vault-index.ts`. Omit for no-date tasks.

**Owner tag** — `@owner(human|agent|either)`. Default if unset: `either`. Used for agent dispatch filtering (not required for task-sidebar UI; informational only).

## Entity task frontmatter schema

```yaml
---
# required
action: string                    # short action verb phrase
status: open | in-progress | done | blocked | cancelled
parent-project: "[[1-Projects/<slug>/README]]"

# recommended
created: YYYY-MM-DD               # or ISO timestamp
tags: [type/task]
due: YYYY-MM-DD

# priority inputs (never priority itself — Lock #8)
impact: low | medium | high
urgency: low | medium | high

# optional
created-by: human | agent
owner: human | agent | either
---

# <action heading>

<free-form markdown body — notes, context, checklists>
```

**The allowlist rule** (Lock #9): `POST /api/tasks/field-edit` accepts updates to these fields ONLY:

- `action`, `due`, `impact`, `urgency`, `tags`, `owner`, `parent-project`

Rejected fields:
- `status` — must go through `/api/tasks/status-edit` (triggers state-machine + reconcile)
- `priority` — never stored (inferred — Lock #8)
- `created`, `constructor`, `__proto__`, `prototype` — immutable / prototype-pollution guards

## Project `README.md` frontmatter schema

```yaml
---
# required
status: backlog | active | in-progress | blocked | paused | done | cancelled
tags: [type/project]
created: YYYY-MM-DD

# recommended
driver: human | agent | collaborative
timeframe: Q1-2026 | Q2-2026 | ...
due: YYYY-MM-DD
goal: "[[2-Areas/goals/<goal-slug>]]"

# for paused projects
pause-reason: string
resume-after: YYYY-MM-DD
---

# Project name

<free-form markdown>

[[3-Resources/anchors/status-<value>]]    ← inline link that graph-queries use
```

Projects with `status: done` or `cancelled` are filtered out of the Projects tab by default. Toggle "Show inactive" to surface them.

## Priority — inferred, never stored (Lock #8)

The UI shows P1–P4 pills. Those values are **never** written to disk. They are computed at read time via `server/priority.ts` → optional subprocess `priority_infer.py` → inputs (impact, urgency, due, parent-goal-timeframe) → score + rank + breakdown.

Without `PRIORITY_SCRIPT_PATH` configured, priority is always `null` and the UI renders an unranked chip. This is the default for public releases — set `PRIORITY_SCRIPT_PATH` to enable.

Why inferred: the inputs (impact/urgency/due/timeframe) don't drift; the output (priority) does drift as due dates tick closer. Storing drift is a data-integrity trap. Re-computing on read is cheap (LRU cache in `priority.ts`).

## Status state machine

```
backlog  ──┐
           ▼
open  ◄──►  in-progress  ──►  done
  │              │              ▲
  │              ▼              │
  └──►  blocked                 │
           │                    │
           └────► (unblock) ────┘
  │
  └──►  cancelled (terminal)
```

Rules enforced by `server/writers/task-status-edit.ts`:

- Any → `done` fires `status_reconcile.py` subprocess (if configured).
- `cancelled` and `done` are terminal — transitions away from them require deliberate reopen via `status-edit`.
- `blocked` requires a `blocked-by` field (planned Sprint I; currently advisory).

## Inline ↔ Entity promotion (Lock #5)

When a user edits any field on an inline task, the first edit auto-promotes it to an entity task:

1. Server removes the inline line from `tasks.md` (atomic write).
2. Server creates `tasks/<slug>.md` with O_EXCL (TOCTOU-safe).
3. Frontmatter is populated from what the inline line carried + the field being edited.
4. Response returns the new `entityPath`.

This is a single-call API: `POST /api/tasks/promote-and-edit`. There's no separate "Promote" button in the UI — promotion is the side-effect of caring enough to edit a field.

## Collision handling

- Two concurrent `POST /api/tasks/create-entity` with the same slug → `writeFileExclusive` fails all but one with EEXIST → server returns 409. Verify.sh test: 20 parallel creates → 1 succeeds with 201, 19 get 409.
- Two concurrent `POST /api/tasks/toggle` on the same line → atomic read + write + replace. Verify.sh test: 50 parallel toggles → 50/50 return 200, file stays consistent.
- Editor-external change + our write in the same millisecond → mtime optimistic lock. Client sends `expectedModified`; server stats disk + compares; 409 if stale. Client refetches + surfaces a non-destructive conflict banner.
- Tombstone restore + concurrent create of same path → `writeFileExclusive` on restore → 409 with `originalPath` in response. User decides (retry vs accept new file).

## Storage shapes (what lives where)

| Data | Location | Written by | Read by |
|---|---|---|---|
| Inline task | `1-Projects/<slug>/tasks.md` | toggle, add, edit, move, delete-inline writers | vault-index.ts |
| Entity task | `1-Projects/<slug>/tasks/<task-slug>.md` | create-entity, field-edit, body-edit, status-edit, promote writers | vault-index.ts |
| Project meta | `1-Projects/<slug>/README.md` | project-field-edit writer | vault-index.ts |
| Tombstone | `$VAULT_ROOT/.vault-sidebar-tombstones/{timestamp}__{kind}__{encoded-path}.md` | task-tombstone.ts (entity + inline) | task-tombstone.ts restore path |
| Client state | Browser localStorage (`vault-sidebar-state` key) | Zustand `persist` middleware | Zustand on mount |

Nothing writes to a database. There is no database. Your vault is the database.
