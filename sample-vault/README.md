# Sample Vault

This is the demo vault that ships with `task-sidebar`. It's a minimal PARA-structured Obsidian-style markdown hierarchy that the sidebar reads at startup. The shape is what matters — the content is placeholder.

## Shape

```
sample-vault/
├── 1-Projects/          ← active work with deadlines (task-sidebar reads this)
│   ├── demo-app/
│   │   ├── README.md    ← project frontmatter (status, timeframe, goal, driver)
│   │   ├── tasks.md     ← inline checkbox tasks (the "quick capture" stream)
│   │   └── tasks/       ← one-file-per-task entity tasks (richer frontmatter)
│   │       ├── wire-auth-flow.md
│   │       └── ship-landing-page.md
│   ├── writing-project/
│   └── home-reno/
├── 2-Areas/             ← ongoing responsibilities (no deadline) — not yet surfaced in UI
├── 3-Resources/         ← reference material by topic — not yet surfaced
└── 4-Archive/           ← completed items (sidebar refuses to write here — Lock #safety)
```

## Frontmatter contracts

See `docs/DATA-MODEL.md` at repo root for the full schema reference. Quick version:

**Project `README.md`** — required: `status`, `tags: [type/project]`, `created`. Optional: `timeframe`, `goal`, `driver`, `due`, `pause-reason`.

**Inline task** (line in `tasks.md`) — format: `- [ ] action text @owner(human|agent|either) <!-- optional due:YYYY-MM-DD -->`. Checkbox variants: `[ ]` open, `[/]` in-progress, `[x]` done.

**Entity task** (`tasks/<slug>.md`) — required: `action`, `status`, `parent-project: "[[1-Projects/<slug>/README]]"`. Optional: `due`, `impact`, `urgency`, `tags`.

## Running against this vault

`pnpm dev` — VAULT_ROOT defaults to `./sample-vault`. Server reads this tree, watches it for external changes, exposes CRUD via `http://127.0.0.1:5174`.

## Running against your own vault

Export `VAULT_ROOT=/absolute/path/to/your-vault` before `pnpm dev`. The shape above is the only hard requirement. See `.env.example` at repo root.

## Why "Projects / Areas / Resources / Archive"?

PARA is Tiago Forte's framework. The sidebar surfaces `1-Projects/` only — the other folders are recognized (writes into them are blocked by the safety layer) but not listed in the UI. Your vault can have more PARA folders (e.g. `0-Inbox/`, `Daily/`) — the sidebar ignores anything outside `1-Projects/`.
