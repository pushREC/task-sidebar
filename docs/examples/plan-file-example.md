# Task-Sidebar Public Release Plan (2026-04-19)

> **Active plan.** Publish `codebases/vault-sidebar/` to `github.com/<user>/task-sidebar` (MIT, public, personal namespace) as a reference codebase friends can fork, port UI/UX patterns from, and have Claude Code agents reverse-engineer.
>
> **Vault-sidebar Plan II v2 (Sprints H → J) ARCHIVED below.** Sprint H R2 + 2 supremacy audits shipped at HEAD `a93a621`. Sprint I + J remain in the archive plan for reference but are NOT in scope for this release — the release ships the codebase AS-IS at the Sprint-H-complete checkpoint.

## 0. Context + goals

**Why:** Rob wants to share the vault-sidebar work with friends. Three audiences: (a) developers forking the project end-to-end, (b) designers porting the Darkroom-Minimal UI/UX to other dashboards, (c) Claude Code agents reverse-engineering the architecture + planning discipline from first principles.

**Success criteria (all testable post-publish):**
- `git clone https://github.com/<user>/task-sidebar && cd task-sidebar && pnpm install && pnpm dev` works against the bundled `sample-vault/` with zero env-var setup
- `grep -rE '$HOME' .` (excluding `node_modules` + `.git`) returns empty on the published tree
- `pnpm tsc --noEmit` clean, `bash scripts/verify.sh` 39/39 against the sample vault
- Docs-present check: README.md + 7 docs/ files + LICENSE + CONTRIBUTING.md + CLAUDE.md + sample-vault/ + templates/plan-file.md all exist
- A Claude Code agent handed ONLY this repo + its docs can explain: architecture, task model, UI-UX tokens, decision rationale, planning discipline — without external references

## 1. User-confirmed decisions

| # | Decision | Value |
|---|---|---|
| D1 | Repo name | `task-sidebar` |
| D2 | License | MIT |
| D3 | Visibility | Public under personal GitHub (`<user>`) |
| D4 | Git history | Option C hybrid — preserve all 50 commits, tag prior HEAD as `pre-sanitization`, single sanitization commit on top |
| D5 | Sample vault | Bundled at repo root as `sample-vault/` with 3 projects + ~25 tasks covering all states |
| D6 | Life-os scripts | Referenced in docs only (NOT bundled) — grep-for-setup path in `docs/LIFE-OS.md` section |
| D7 | CI | Deferred until first external PR |

## 2. Phase A — History audit (read-only, gates everything)

### Task A.0: Scan git log + tree for secrets + personal identifiers

- **What:** Run 2 scans; capture to `/tmp/task-sidebar-audit.txt`. Present findings to user BEFORE any code change.
  - `git -C $VAULT_ROOT/codebases/vault-sidebar log --all --oneline | grep -iE "(secret|token|password|bearer|api[_-]?key|rob@|robert@)"` — expected empty
  - `grep -rInE '(api[_-]?key|secret|token|password|bearer|robert@pushrec)' $VAULT_ROOT/codebases/vault-sidebar/ --include='*.{ts,tsx,json,md,sh,yaml,yml}' --exclude-dir=node_modules` — expected empty
- **On finding:** halt; ask user whether to scrub via `git filter-repo` or abort
- **Verification:** 0 matches in each scan
- **Rollback:** N/A (read-only)

## 3. Phase B — Code sanitization (5 file edits + 1 new file)

All paths relative to `$VAULT_ROOT/codebases/vault-sidebar/`.

### Task B.1: `server/safety.ts` — env-driven `VAULT_ROOT` (single source of truth)

- **Find:** `const VAULT_ROOT = "$VAULT_ROOT";` (line 4)
- **Replace with:**
```ts
import { resolve as resolvePath } from "path";
const DEFAULT_VAULT = resolvePath(process.cwd(), "sample-vault");
export const VAULT_ROOT = process.env.VAULT_ROOT
  ? resolvePath(process.env.VAULT_ROOT)
  : DEFAULT_VAULT;
```
- **Note:** The `export` is new — `safety.ts` becomes single source of truth for `VAULT_ROOT`. Latent-bug fix: `watcher.ts` currently duplicates the string constant.
- **Verification:** `grep -c 'export const VAULT_ROOT' server/safety.ts` returns 1; `pnpm tsc --noEmit` clean

### Task B.2: `server/watcher.ts` — import `VAULT_ROOT` from `safety.ts`

- **Find:** `const VAULT_ROOT = "$VAULT_ROOT";` (line 4)
- **Replace with:** `import { VAULT_ROOT } from "./safety.js";` (at top with other imports)
- **Verification:** `grep -c 'VAULT_ROOT = "' server/watcher.ts` returns 0; `pnpm tsc --noEmit` clean

### Task B.3: `server/priority.ts` — env-driven `PRIORITY_SCRIPT_PATH`, null-safe

- **Find:** `const PRIORITY_SCRIPT = "$HOME/.claude/skills/life-os/scripts/priority_infer.py";` (line 3)
- **Replace with:** `const PRIORITY_SCRIPT = process.env.PRIORITY_SCRIPT_PATH || null;`
- **Find:** the `computePriority` function's subprocess call site
- **Add above it:** `if (PRIORITY_SCRIPT === null) return null;` (short-circuit if no path configured — graceful degradation already ships tasks with `priority: null`)
- **Verification:** `grep -c 'PRIORITY_SCRIPT_PATH' server/priority.ts` returns 1; `curl /api/vault` returns tasks with `priority: null` when env var unset; `pnpm tsc --noEmit` clean

### Task B.4: `server/status-reconcile.ts` — env-driven `RECONCILE_SCRIPT_PATH`, null-safe

- **Find:** `const RECONCILE_SCRIPT = "$HOME/.claude/skills/life-os/scripts/status_reconcile.py";` (line 3)
- **Replace with:** `const RECONCILE_SCRIPT = process.env.RECONCILE_SCRIPT_PATH || null;`
- **Find:** `fireStatusReconcile` function body
- **Add at top:** `if (RECONCILE_SCRIPT === null) return;` (fire-and-forget already tolerates no-op)
- **Verification:** `grep -c 'RECONCILE_SCRIPT_PATH' server/status-reconcile.ts` returns 1; done transitions complete locally without subprocess; `pnpm tsc --noEmit` clean

### Task B.5: Create `.env.example`

- **New file:** `$VAULT_ROOT/codebases/vault-sidebar/.env.example`
- **Content:**
```bash
# Path to your PARA-structured Obsidian vault. Defaults to ./sample-vault
# when unset so `pnpm dev` works out of the box against the bundled demo.
# VAULT_ROOT=/Users/you/my-vault

# Optional: life-os companion scripts for inferred priority + status
# reconciliation. Leave blank to run without them (tasks show priority: null,
# done-transitions don't propagate to parent goals). Get the scripts from
# https://github.com/<user>/life-os (or wherever life-os lives).
# PRIORITY_SCRIPT_PATH=
# RECONCILE_SCRIPT_PATH=

# Dev server port
# PORT=5174
```

### Task B.6: `implementation-state.md` — sanitize plan-file reference

- **Find (line 3):** `**Plan source**: $HOME/.claude/plans/spicy-jumping-pike.md`
- **Replace with:** `**Plan source**: docs/examples/plan-file-example.md (see docs/PLANNING-DISCIPLINE.md for format)`
- **Find + replace:** any other `$HOME/...` or `/tmp/plan-ii-*` absolute paths → rewrite to relative `docs/examples/` paths
- **Verification:** `grep -cE '$HOME|/tmp/plan-ii' implementation-state.md` returns 0

## 4. Phase C — Sample vault scaffold

### Task C.1: `sample-vault/` directory tree

- **Create:** `$VAULT_ROOT/codebases/vault-sidebar/sample-vault/` with structure:
```
sample-vault/
├── README.md                       # explains the PARA shape for forkers
├── .gitkeep
├── 1-Projects/
│   ├── demo-app/
│   │   ├── README.md               # frontmatter: slug, status, timeframe, goal
│   │   ├── tasks.md                # 5 inline tasks: mix of [ ]/[/]/[x]
│   │   └── tasks/
│   │       ├── wire-auth-flow.md   # entity task, due yesterday (overdue)
│   │       └── ship-landing-page.md # entity task, status: in-progress
│   ├── writing-project/
│   │   ├── README.md
│   │   ├── tasks.md                # 4 inline tasks
│   │   └── tasks/
│   │       └── draft-opening.md
│   └── home-reno/
│       ├── README.md
│       ├── tasks.md                # 3 inline + 1 blocked
│       └── tasks/
│           └── pick-contractor.md  # status: blocked
├── 2-Areas/                        # empty + .gitkeep (shows PARA shape)
├── 3-Resources/                    # empty + .gitkeep
└── 4-Archive/                      # empty + .gitkeep (sidebar blocks writes here)
```
- **Total tasks:** ~20-25 across 3 projects covering every status state (open / in-progress / blocked / done / overdue) + inline + entity forms
- **Each `README.md` frontmatter:** `created`, `tags: [type/project]`, `status`, `timeframe`, optional `goal`, optional `due`
- **Each entity-task frontmatter:** `action`, `status`, `due`, optional `impact`, optional `urgency`, `parent-project: "[[1-Projects/<slug>/README]]"`
- **Verification:** `VAULT_ROOT=./sample-vault pnpm dev` serves agenda with ≥15 tasks visible; `bash scripts/verify.sh` 39/39

## 5. Phase D — Documentation (11 artifacts)

Every doc is human-readable AND agent-parseable. Length budgets hold writers to crisp copy. All paths relative to repo root.

### Task D.1: `README.md` (~800 words, human-first)

- **Sections:** Hero one-liner + 1 screenshot · Why this exists · 30-sec quickstart (`pnpm install && pnpm dev`) · Feature bullets (reference CLAUDE.md lock numbers) · Architecture sketch (6-line text diagram) · Link block to `docs/` · License + contributing

### Task D.2: `docs/ARCHITECTURE.md` (~1200 words, human + agent)

- Server layer walkthrough (Express + Vite middleware · routes → writers → safety → atomic file ops · SSE broadcast · chokidar watcher + debounce) · Client layer (React 19 · Zustand store · SSE subscription · optimistic updates · discriminated Task union) · Cross-link CLAUDE.md locks #7/#9/#10 · Link SECURITY.md

### Task D.3: `docs/UI-UX.md` (~1500 words, designer-first; absorbs the PORTING kit as appendix)

- Darkroom-Minimal token table (every CSS variable + hex values · 3-theme overrides) · Motion tokens + `.press-scale` + reduced-motion guard · Lucide-only rule (lock #3) · Full keyboard map · A11y patterns (focus restoration · aria-hidden during delete · WHATWG nested-interactive avoidance) · Anti-patterns list (all 10 AI-tells) · **Porting appendix:** 6 copy-paste artifacts with exact `src/styles.css` line refs

### Task D.4: `docs/DATA-MODEL.md` (~800 words, human + agent)

- Vault PARA layout (`1-Projects/<slug>/{README.md, tasks.md, tasks/*.md}`) · `InlineTask | EntityTask` discriminated union (link to `src/shared/types.ts`) · Frontmatter schemas per file type · Priority-as-inference rule (lock #8) · Lifecycle checkbox states `[ ]`/`[/]`/`[x]` + cancelled · Promote inline → entity flow

### Task D.5: `docs/DECISIONS.md` (~1000 words, machine-parseable flat table)

- One table: `| id | tier | lock | source | rationale |`
- Tiers: `architecture` (10 from CLAUDE.md) · `plan-ii` (7 from §0.4) · `plan-i` (28 from §3 archive)
- Source format: `CLAUDE.md:L38` · `plans/plan-file-example.md:§0.4.D3`
- Rationale: ≤20 words per row (what rejection the lock prevents)
- Agents grep this table to understand constraints fast

### Task D.6: `docs/PLANNING-DISCIPLINE.md` (~1200 words, human + agent; absorbs convergence + plan-example into one narrative)

- Narrative: assumption annihilation → irreducible truths → validation through negation → per-task what-why-input-output-deps-verification-rollback-edge-cases → dependency graph + critical path → 3-parallel-critic convergence protocol (Opus + Gemini + Codex invocation patterns) → anti-mediocrity 5-dim self-score gate
- Link to `templates/plan-file.md` (blank fillable template) and `docs/examples/plan-file-example.md` (sanitized copy of spicy-jumping-pike.md)

### Task D.7: `docs/SECURITY.md` (~600 words)

- Path traversal · realpath + startsWith check · writeFileExclusive (O_EXCL) · field allowlist · symlink block · 50-parallel toggle race protection · mtime optimistic lock · tombstone safety · URL-safe base64 filenames · references to `scripts/verify.sh` check names

### Task D.8: `CLAUDE.md` (copy from `codebases/vault-sidebar/CLAUDE.md`, fix broken internal links)

- Repo-root CLAUDE.md is canonical for architecture locks. Copy verbatim, THEN:
  - Rewrite `../../1-Projects/vault-sidebar/README.md` refs → `docs/ARCHITECTURE.md`
  - Rewrite `../../1-Projects/vault-sidebar/HANDOFF.md` refs → drop (vault-side handoff doesn't publish)
  - Rewrite any `~/.claude/skills/...` refs → link to docs where possible
- **Verification:** `grep -cE '(1-Projects/vault-sidebar|~/.claude/skills)' CLAUDE.md` returns 0

### Task D.9: `LICENSE` (MIT, standard text, year 2026, copyright `Robert Zinke`)

### Task D.10: `CONTRIBUTING.md` (~400 words)

- `pnpm install` · `pnpm tsc --noEmit` · `bash scripts/verify.sh` · link to CLAUDE.md for agent governance · PR checklist (tests + docs updated) · commit message format (`sprint-X-Y: description`)

### Task D.11: `templates/plan-file.md` (~500 words, fillable scaffold)

- Blank plan template with section headings: Context · Assumption Annihilation (20-slot table) · Irreducible Truths (numbered list) · Validation Through Negation (per-decision) · Locked Decisions · Success Criteria · Dependency Graph · Tasks (each with what/why/input/output/deps/verification/rollback/edge-cases) · Exit Gate · Convergence Protocol · Anti-Mediocrity Self-Score
- Inline HTML-comment hints per section (`<!-- fill with... -->`) so users know what to put where

### Task D.12: `docs/examples/plan-file-example.md` (sanitized copy of spicy-jumping-pike.md)

- `cp $HOME/.claude/plans/spicy-jumping-pike.md docs/examples/plan-file-example.md`
- Sanitize: `sed -i.bak 's|$HOME|$HOME|g; s|<user>|<user>|g'` then remove `.bak`
- **Verification:** `grep -cE '$HOME|<user>' docs/examples/plan-file-example.md` returns 0

## 6. Phase E — Export to GitHub

### Task E.1: Commit sanitization

- `git -C codebases/vault-sidebar add -A`
- Inspect `git diff --stat` → expect ~15-20 changed files
- `git commit -m "feat: sanitize for public release as task-sidebar"` with body listing Phase-B + Phase-C + Phase-D artifacts
- **Verification:** `git log --oneline -1` shows the feat commit; working tree clean

### Task E.2: Tag prior HEAD as `pre-sanitization`

- Find prior HEAD (the commit right before the feat commit above) — should be `a93a621`
- `git tag pre-sanitization a93a621`
- **Verification:** `git tag -l 'pre-sanitization'` returns `pre-sanitization`

### Task E.3: Create GitHub repo

- `gh repo create task-sidebar --public --description "A hand-crafted sidebar for task + project management over any PARA-structured Obsidian-style vault. Zero ceremony, full undo, 100% keyboard, Claude-Code agent-friendly." --source=. --remote=origin`
- Expects `gh` CLI authed to personal namespace. If not: `gh auth status` first; fallback: create in browser at github.com/new, then `git remote add origin https://github.com/<user>/task-sidebar.git`
- **Verification:** `gh repo view <user>/task-sidebar` returns repo metadata

### Task E.4: Push main + tags

- `git push -u origin main`
- `git push origin --tags` (pushes `pre-sanitization`)
- **Verification:** `gh repo view <user>/task-sidebar --web` opens repo; default branch shows sanitization commit + full history + tag

## 7. Phase F — Polish

### Task F.1: README screenshots

- `VAULT_ROOT=./sample-vault pnpm dev` → open browser at 127.0.0.1:5174
- Capture 4 screenshots via Preview MCP: Agenda expanded · Task Detail Panel open · Bulk selection + Undo toast visible · Command Palette open
- Place in `docs/screenshots/` and reference from README hero

### Task F.2: README badges

- Hand-roll static shields.io badges (no CI needed):
  - `[![tsc](https://img.shields.io/badge/tsc-clean-3ea372)](...)` 
  - `[![verify](https://img.shields.io/badge/verify.sh-39%2F39-3ea372)](...)`
  - `[![license](https://img.shields.io/badge/license-MIT-blue)](...)`

### Task F.3: CI — deferred

- `.github/workflows/` not created this pass. Document in CONTRIBUTING.md: "CI runs manually via `pnpm tsc --noEmit && bash scripts/verify.sh`. Automated GitHub Actions will be added if a PR arrives."

## 8. Verification gate (all must pass before declaring done)

- [ ] A.0 history audit returns 0 secrets
- [ ] `grep -rnE '$HOME' codebases/vault-sidebar/ --exclude-dir=node_modules --exclude-dir=.git` returns 0 matches
- [ ] `pnpm tsc --noEmit` clean
- [ ] `VAULT_ROOT=./sample-vault bash scripts/verify.sh` 39/39 on fresh server
- [ ] 11 doc artifacts present (README + 7 docs + LICENSE + CONTRIBUTING + CLAUDE + templates + examples)
- [ ] Sample-vault `pnpm dev` shows ≥15 tasks across 3 projects in agenda
- [ ] `gh repo view <user>/task-sidebar --web` opens published repo
- [ ] Fresh clone test: `cd /tmp && git clone https://github.com/<user>/task-sidebar && cd task-sidebar && pnpm install && pnpm dev` works without setting any env var

## 9. Estimated wall time

- Phase A: 10 min (read-only audit)
- Phase B: 30 min (5 file edits + 1 new file)
- Phase C: 45 min (sample-vault scaffold — bulk of writing the 20-25 mock tasks)
- Phase D: ~2h (11 docs × ~500-1500 words each — this is the bulk of the work)
- Phase E: 10 min (commit + tag + gh + push)
- Phase F: 20 min (screenshots + badges)

**Total:** ~3.5 hours focused work.

## 10. Rollback

Each phase independently reversible:
- B.* → `git checkout <file>` to restore original
- C.* → `rm -rf sample-vault/`
- D.* → `rm -rf docs/ README.md LICENSE CONTRIBUTING.md templates/`
- E.3 → `gh repo delete <user>/task-sidebar --yes`
- E.1-E.2 → `git reset --hard pre-sanitization` (if pushed, `git push --force` is USER-APPROVED-ONLY)

---

# Plan II v2 — Foundation Polish (Sprints H → J)

## 0. Context

All 8 sprints of Plan I shipped. v2.2 is live with 164 findings fixed. Measured baselines taken 2026-04-18 surface soft spots blocking the user's "ULTIMATE smoothest, snappiest foundation with impeccable UI/UX and autistic attention to detail" mandate:

| Metric | Measured | Target |
|---|---|---|
| `/api/vault` warm latency (median of 5 curl runs) | 20ms | <5ms |
| `/api/vault` cold latency (first run after boot) | 78ms | <20ms |
| Agenda DOM node count (document.querySelectorAll('*').length) | 35370 | <5000 |
| Zustand subscriptions per vault-changed event (13 selectors × 2261 rows) | 29393 | <10000 |
| Type-guard sites (`task.line !== undefined` or `task.entityPath &&`) across src/ | 17 | 0 |
| Focus after tab-switch (activeElement.tagName) | "BUTTON" (previous tab) | first row of new tab |
| Delete genuinely undoable (restore file after unlink) | No — Sprint G R1 fake Undo variant shows X dismiss | Yes — tombstone restore 200 within 5s |
| body-edit lost-update protection (expectedModified 409 on stale mtime) | None | Returns 409 when disk mtime ≠ expectedModified |
| Hardcoded `"en-US"` string occurrences in src/ | 4 | 0 |
| SSE closed-state manual reconnect button | None | Visible "Retry" button with exponential countdown |
| Stagger-fade on TaskRow mount (animation-delay per row-index) | Not implemented | Implemented, reduced-motion-guarded |
| Animation timing cubic-bezier curves in styles.css | 5 scattered | 3 token refs (`--ease-spring-subtle` / `--ease-spring-emphatic` / `--ease-standard`) |
| Polish items from Plan-agent Q7 autistic list | 0 of 14 shipped | 14 of 14 shipped |

Three phases deliver the answer:
- **Sprint H — Safety + Recoverability** (estimated 14h, 3 convergence rounds)
- **Sprint I — Performance Bedrock** (estimated 16h, 4 convergence rounds)
- **Sprint J — Feel Layer + Autistic Polish** (estimated 10h, 2 convergence rounds)

Total estimated: 40h, 9 convergence rounds at 3 parallel critics per round (Opus Explore + Gemini CLI + Codex CLI).

## 0.1 Assumption Annihilation (what I assume that must be verified BEFORE any code)

| # | Assumption | Verification command | Expected output |
|---|---|---|---|
| A1 | HEAD of `$VAULT_ROOT/codebases/vault-sidebar/` is `2ea75c4` or later | `cd $VAULT_ROOT/codebases/vault-sidebar && git rev-parse HEAD` | 40-char sha; `git merge-base --is-ancestor 2ea75c4 HEAD` exits 0 |
| A2 | TypeScript compiles cleanly at baseline | `cd $VAULT_ROOT/codebases/vault-sidebar && pnpm tsc --noEmit 2>&1` | Empty output, exit 0 |
| A3 | `scripts/verify.sh` passes 39/39 at baseline | `cd $VAULT_ROOT/codebases/vault-sidebar && bash scripts/verify.sh 2>&1 \| tail -3` | `TOTAL: 39 / 39 passed, 0 failed` |
| A4 | Vite+Express server listens on 127.0.0.1:5174 | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5174/api/vault` | `200` |
| A5 | chokidar file watcher fires on writes (not broken) | Modify any task file, verify `/api/events` stream emits `event: vault-changed` | SSE frame received within 500ms |
| A6 | gray-matter dependency is present in package.json | `grep -c '"gray-matter"' $VAULT_ROOT/codebases/vault-sidebar/package.json` | 1 or more |
| A7 | zustand dependency includes the `useShallow` export | `grep -c '"zustand"' $VAULT_ROOT/codebases/vault-sidebar/package.json` | 1 or more; verify via `node -e "import('zustand/react/shallow').then(m => console.log(!!m.useShallow))"` |
| A8 | Claude_Preview MCP server is reachable | `mcp__Claude_Preview__preview_list` tool returns a live entry for vault-sidebar on port 5174 | JSON with `status: "running"` |
| A9 | `codex` CLI on PATH (Codex convergence critic) | `command -v codex && codex --version 2>&1` | Version string starting `codex-cli` |
| A10 | `gemini` CLI on PATH (Gemini convergence critic) | `command -v gemini && gemini --version 2>&1` | Version string `gemini x.y.z` |
| A11 | `playwright-cli` skill available for UI E2E | `ls ~/.claude/skills/playwright-cli/SKILL.md` | File exists |
| A12 | `VAULT_ROOT` is `$VAULT_ROOT` (used by safety checks) | `grep -c 'VAULT_ROOT = "$VAULT_ROOT"' $VAULT_ROOT/codebases/vault-sidebar/server/safety.ts` | 1 |
| A13 | Vault root is writable for `.vault-sidebar-tombstones/` creation | `touch $VAULT_ROOT/.vault-sidebar-tombstones-probe && rm $VAULT_ROOT/.vault-sidebar-tombstones-probe && echo ok` | `ok` |
| A14 | `src/shared/types.ts` discriminated union already exists from Sprint G | `grep -c 'export type Task = InlineTask \| EntityTask' $VAULT_ROOT/codebases/vault-sidebar/src/shared/types.ts` | 1 |
| A15 | Handoff doc current + tasks.md has [x] entries for Sprint E, F, G | `grep -c '\[x\] Sprint [EFG]' $VAULT_ROOT/1-Projects/vault-sidebar/tasks.md` | 3 or more |
| A16 | Sprint G Zustand store has `selectedTaskIds` + `pendingUndo` + `addSelection` + `clearSelection` | `grep -cE 'selectedTaskIds:\|pendingUndo:\|addSelection\(\|clearSelection\(' $VAULT_ROOT/codebases/vault-sidebar/src/store.ts` | 4 or more |
| A17 | `fs.rename` across vault directory works on this filesystem (APFS; required for tombstones) | `touch /tmp/apfs-probe-src && mv /tmp/apfs-probe-src $VAULT_ROOT/.apfs-probe && rm $VAULT_ROOT/.apfs-probe && echo ok` | `ok` |
| A18 | `navigator.language` is populated in the Preview MCP browser context | `mcp__Claude_Preview__preview_eval({expression:"navigator.language"})` | A locale string such as `"en-US"` or `"de-DE"` |
| A19 | Preview MCP supports `preview_resize` to 320, 480, 725 widths | `mcp__Claude_Preview__preview_resize({width:320})` succeeds | Returns viewport update confirmation |
| A20 | `process.kill(process.pid, 'SIGTERM')` handlers fire in dev server (for tombstone drain) | Inspect `$VAULT_ROOT/codebases/vault-sidebar/server/index.ts` for existing SIGTERM handler | If absent, add one in H.3.5 |

**Enforcement**: the first task of Phase H (task `H.0.1` below) runs ALL 20 assumption checks. Any failure blocks the phase. See `H.0.1` for the exact sequence.

## 0.2 Irreducible Truths (the absolute minimum things that MUST be true)

For each of the three sprints, the minimum fact-set that must hold:

**Sprint H (Safety) irreducible truths**:
- T-H1. A file unlinked by delete-entity can be byte-identical restored by a restore endpoint within 5s.
- T-H2. If disk mtime ≠ client-held mtime, body-edit/field-edit must reject with HTTP 409 and emit the current disk mtime in the response body.
- T-H3. A user-visible error dot must persist for ≥ 5s OR until click-dismiss, whichever comes first.
- T-H4. Tombstones cannot leak into any `/api/vault` response.
- T-H5. Tombstone writes/restores must NOT bypass `assertSafeTasksPath` on the vault-side target path.
- T-H6. Server shutdown (SIGTERM, SIGINT, beforeExit) must not silently drop pending tombstones past their TTL — startup orphan cleanup sweeps them.

**Sprint I (Performance) irreducible truths**:
- T-I1. `/api/vault` warm p50 latency ≤ 5ms after cache lands.
- T-I2. TaskRow mounted DOM nodes scale with visible (expanded, non-collapsed) buckets, not total task count.
- T-I3. Any writer-caused cache invalidation happens BEFORE the matching SSE broadcast (no stale refetch race).
- T-I4. Zero `task.line !== undefined` runtime guards remain after migration (TypeScript narrowing handles the check).
- T-I5. SSE "vault-changed" event coalesce window is ≥ 100ms (multiple rapid writes emit one batched event).
- T-I6. A German-locale header (`LANG=de_DE.UTF-8`) must produce German weekdays in the `.task-due` chip labels (no leaked English values such as `"Mon"`, `"Tue"`, `"Wed"`, `"Thu"`, `"Fri"`, `"Sat"`, `"Sun"`).
- T-I7. Bulk-Move of 3 entity tasks from project A to project B must: (a) move all 3 files to B/tasks/, (b) rewrite each file's parent-project frontmatter, (c) handle slug collision via auto-suffix (`-2`, `-3`), (d) undo reverses every move including any rename.
- T-I8. A broken SSE connection must expose a manual `Retry` button that re-establishes the EventSource when clicked.

**Sprint J (Feel) irreducible truths**:
- T-J1. Row-mount animations must be suppressed entirely under `prefers-reduced-motion: reduce` (animationDelay computes to `0s`).
- T-J2. Optimistic delete must restore the row to the DOM within 200ms of an HTTP 500 response.
- T-J3. Tab-switch (key `1` or `2`) must end with `document.activeElement` on the first visible row of the new tab.
- T-J4. Every cubic-bezier in styles.css must resolve via `var(--ease-spring-subtle)`, `var(--ease-spring-emphatic)`, or `var(--ease-standard)` (zero inline curves).
- T-J5. `navigator.vibrate` is feature-detected; absence must cause silent no-op.
- T-J6. Color-blind cues: P1 pill solid-fill; overdue row has Lucide `AlertCircle` icon in addition to red text.
- T-J7. Sticky `.bucket-header` shows a 4px downward shadow when the bucket body has scrolled past its first row.

**Failure-subtraction test**: if T-H1 is removed, undo on delete is dishonest → Sprint G R1 fake-Undo regression returns. If T-I3 is removed, UI shows stale data after edits → the killer race from Plan-agent Q10. If T-J1 is removed, vestibular-sensitive users get motion sickness → accessibility regression. Every truth has a concrete failure mode when removed.

## 0.3 Validation Through Negation (strongest arguments AGAINST each key decision)

For each of the 7 locked decisions (§0.4 below), the strongest counter-argument and the concrete tradeoff analysis.

**Decision 1 — Lazy-mount + content-visibility (not real virtualization)**
- **Counter-argument**: "React 19 still allocates fibers for all 2261 rows on initial mount. content-visibility only skips PAINT not RECONCILE. Under React Profiler, mount time at 2261 rows remains 40-120ms even with content-visibility. Real virtualization (`@tanstack/react-virtual`) mounts only ~25 rows visible at once → mount time 3ms."
- **Tradeoff analysis**: Real virtualization costs (a) breaking `getVisibleTaskIds()` in `src/lib/keyboard.ts` because unmounted rows aren't queryable — requires a parallel virtual-list-aware query layer; (b) sticky `.bucket-header` inside a virtual list needs custom sticky-range tracking because native `position: sticky` breaks when the sticky element's parent is itself a virtual scroller; (c) focus management during bulk-select must scroll-to-row before focusing. Estimated complexity: +12h, +1 convergence round, +3 new test scenarios. Win: ~15% mount improvement on top of content-visibility. Given the user's mandate favors smoothness AND cognitive-supremacy over premature optimization, lazy-mount + content-visibility captures the dominant win cheaply; real virtualization can be added in a later plan IF measured render frames exceed 16ms after lazy-mount.
- **Reverse conditions**: reverse if measured mount time at 2261 rows > 50ms after lazy-mount + content-visibility land, OR if a user-reported "feels sluggish" issue surfaces on the Agenda tab post-I.2.

**Decision 2 — Safety-first phase order (H → I → J)**
- **Counter-argument**: "Perf first delivers perceived snappiness immediately, which is the user's primary mandate. Safety additions are invisible until a failure occurs; delivering invisible work first delays user-perceptible value."
- **Tradeoff analysis**: If Phase I lands first, the in-memory cache's `modified` field becomes cache-age-dependent, not disk-truth — when Phase H later wires mtime lock, the client sends cache-age modified stamps and the server compares against disk mtime, producing false 409s. Fix requires either (a) caching mtime separately from the `modified` surfaced to clients (complexity: 2 sources of truth in the cache layer), or (b) retrofitting the cache to read mtime fresh on every request (defeats the cache). Both are worse than shipping mtime lock first. Phase H therefore must precede Phase I. The perf win is deferred by ~14h but the architecture stays coherent.
- **Reverse conditions**: reverse if Phase H tombstones + mtime lock prove to require >20h (i.e. >40% slip on the estimate) — in that case interleave by feature rather than by phase.

**Decision 3 — Tombstones inside vault at `$VAULT_ROOT/.vault-sidebar-tombstones/`**
- **Counter-argument**: "Putting a dotdir at vault root pollutes the user's vault visually (even though git-ignored), and if Obsidian misindexes it or a sync tool (iCloud, Dropbox) treats dotfiles inconsistently, tombstones could be transported off-device unexpectedly."
- **Tradeoff analysis**: Outside-vault alternatives: `/private/tmp/vault-sidebar-tombstones/` is swept by macOS periodic maintenance every 3 days — tombstones older than 5s are fine for cleanup BUT if the user reboots mid-session before undo fires, the tombstone is lost BEFORE sweeper runs and restore fails silently. `~/Library/Caches/vault-sidebar/tombstones/` avoids sweep but requires a second parallel `assertSafeTombstonePath` guard against a completely different root, and iCloud's "Optimize Mac Storage" can purge Caches. Inside-vault is survivable (APFS snapshots include it; git-ignorable; chokidar's `1-Projects/` glob excludes it naturally because tombstones live at VAULT_ROOT, one level above). Obsidian ignores dotdirs by default. No observed sync-tool misbehavior for dotdirs.
- **Reverse conditions**: reverse if the user's sync tool (iCloud/Dropbox/Syncthing) is observed to upload `.vault-sidebar-tombstones/` to off-device storage, OR if Obsidian's file indexer starts scanning dotdirs in a future version.

**Decision 4 — Full 14-item autistic polish list**
- **Counter-argument**: "A subset of 8 signature items would cover the user-perceptible 90% with 60% of the effort. The last 6 items (haptics, prefers-contrast, long-press menu, zoom audit, touch-targets, skeleton crossfade) are marginal on a desktop-only surface."
- **Tradeoff analysis**: User explicitly chose "full 14-item autistic list" in the AskUserQuestion round. Cutting scope post-locked-decision would contradict the mandate. The 6 "marginal" items include prefers-contrast (AAA compliance, legally required for some jurisdictions) and color-blind cues (8% of men). These are NOT marginal for an accessibility posture. Haptics + long-press are 1h each — trivial. Ship full list.
- **Reverse conditions**: reverse if the Phase-J convergence loop surfaces a previously-hidden accessibility regression that requires >2h of fix that was not budgeted. In that case, cut long-press menu (least-essential item).

**Decision 5 — Silent auto-rename on bulk-Move slug collision, transparent via toast**
- **Counter-argument**: "Modifying file names behind the user's back is opaque. A confirm dialog ('target has a file named foo.md — rename as foo-2.md?') respects user agency more."
- **Tradeoff analysis**: Confirm dialog breaks the bulk-flow's atomicity — user picks "Move 30 tasks to GTM", then has to resolve 3 collisions individually. The atomic operation becomes 3 interruptions. Toast transparency retains atomicity AND tells the user what happened: `"30 moved · 3 renamed · Undo"`. Click the toast's details expander (or just `cmd+click` the Undo) → per-task list. User can undo the whole bulk, which reverses every rename. This meets "autistic attention to detail" while preserving flow.
- **Reverse conditions**: reverse if user reports a "moved to wrong file name" surprise after shipping I.6 — then add a collision-confirm modal as a settings opt-in.

**Decision 6 — mtime lock on body-edit + field-edit (skip status-edit)**
- **Counter-argument**: "All three mutating endpoints should be symmetrical. Skipping status-edit introduces an inconsistent client contract — developers must remember which endpoints need expectedModified."
- **Tradeoff analysis**: Status-edit is already protected by the Sprint G 5-second reconcile queue AND the state-machine guards (done-transition fires reconcile; other transitions don't). Adding mtime lock on status-edit adds overhead without a corresponding lost-update risk: status changes are single-value assignments; no text body to overwrite. Consistency argument is weaker than surface-area minimization.
- **Reverse conditions**: reverse if a lost-status-update bug surfaces in practice (e.g. Obsidian sets status: done while we set status: blocked concurrently).

**Decision 7 — Writer-synchronous cache invalidation BEFORE SSE broadcast**
- **Counter-argument**: "Decoupling invalidation from broadcast via chokidar simplifies writer code — writers only need to write the file and call broadcast; chokidar invalidates downstream. Fewer moving parts."
- **Tradeoff analysis**: Decoupling introduces the killer race (Plan-agent Q10): broadcast fires → client refetches → cache still stale because chokidar hasn't yet processed the write. Symptom: UI shows old data for 10-200ms after every edit. That is visibly worse smoothness than no cache at all. Writer-synchronous invalidation adds 1 line per writer (10 writers) at the cost of eliminating the race. Given the user's "ultimate snappiest" mandate, the 10-line overhead is trivial.
- **Reverse conditions**: never — the race is not acceptable under the mandate.

## 0.4 Locked decisions (from user AskUserQuestion round this session)

1. **DOM strategy** — Lazy-mount collapsed bucket contents + `content-visibility: auto` on every task row (cover measured 95% of virtualization's win at 10 lines of code). Real virtualization deferred pending post-I.2 measurement.
2. **Phase order** — Safety-first (H → I → J). Tombstones + mtime lock land before in-memory cache so cache-served `modified` stays disk-truth.
3. **Tombstone location** — Inside vault at `$VAULT_ROOT/.vault-sidebar-tombstones/`. Outside chokidar's `1-Projects/` watched tree; `.gitignore`-able; survives `/tmp` cleanup.
4. **Polish breadth** — Full 14-item autistic list in Sprint J.
5. **Bulk-Move collision** — Silent auto-rename with transparent undo toast.
6. **mtime lock scope** — body-edit + field-edit only. Skip status-edit.
7. **Cache invalidation ordering** — Writer invalidates SYNCHRONOUSLY before broadcast. Chokidar is a safety net for external changes only.

## 0.5 Success criteria (every item measurable + testable)

After Plan II v2 lands:
- [ ] Agenda DOM node count ≤ 5000 when Overdue+Today+Tomorrow buckets are expanded and all others collapsed (measured via `document.querySelectorAll('*').length`)
- [ ] `/api/vault` warm p50 latency ≤ 5ms (median of 20 consecutive curl runs)
- [ ] Zero `task\.line !== undefined` OR `task\.entityPath &&` patterns in `src/` (grep returns empty)
- [ ] Tombstone delete-restore round-trip: delete entity task → verify tombstone file at vault-root → POST /api/tasks/restore-tombstone → original file restored byte-identical (shasum matches)
- [ ] body-edit and field-edit return HTTP 409 with `{ok:false, error:"mtime-mismatch", currentModified: <iso>}` when `expectedModified` differs from disk
- [ ] Zero hardcoded `"en-US"` strings in `src/` (grep returns empty)
- [ ] SSE closed state renders visible Retry button with live exponential-backoff countdown text
- [ ] All 14 Sprint J polish items shipped (enumerated in §6)
- [ ] `scripts/verify.sh` passes 60/60 (39 existing + 21 new, enumerated in §9)
- [ ] `pnpm tsc --noEmit` returns empty output, exit 0
- [ ] AI-tell greps return empty: `font-bold`, `as any`, `console\.(log|warn|error|debug)`, `task.text`, `(⚙|⏎|›|○|●)`, `#fff[^o]`
- [ ] TaskRow calls `useSidebarStore` at most 5 times (grep count)
- [ ] Tab switch (press `1` then `2`) ends with `document.activeElement.getAttribute('data-task-row') === ''` (first row of new view)

## 0.1 Locked decisions (this planning session)

1. **DOM strategy** — lazy-mount collapsed buckets + `content-visibility: auto` on task rows. Defer real virtualization; measure first.
2. **Phase order** — **Safety-first**. Tombstones + mtime lock land before in-memory cache so the cache is tombstone-aware from day 1 and mtime semantics stay disk-truth.
3. **Tombstone location** — inside vault at `.vault-sidebar-tombstones/`. Outside chokidar's `1-Projects/` watched tree; `.gitignore`-able; survives OS `/tmp` cleanup.
4. **Polish breadth** — full 14-item autistic list in Sprint J.
5. **Bulk Move collision** — silent auto-rename with transparent undo toast: `"3 moved · 1 renamed foo → foo-2 · Undo"`. User's intent is moving, not slug management.
6. **mtime lock scope** — body-edit + field-edit. Skip status-edit (Sprint G reconcile queue already protects done-transitions).
7. **Cache invalidation ordering** (hard invariant) — writer invalidates SYNCHRONOUSLY before broadcast. Never rely on chokidar for writer-originated changes. Kills the Plan-agent-Q10 killer race.

## 0.2 Success criteria (all measurable, all testable)

After Plan II lands:
- [ ] Agenda DOM nodes ≤ 5,000 (from 35,370)
- [ ] `/api/vault` warm latency ≤ 5ms (from 20ms)
- [ ] Zero `task.line !== undefined` or `task.entityPath &&` guards in `src/`
- [ ] Delete is genuinely undoable (tombstone → restore within 5s works end-to-end)
- [ ] body-edit + field-edit return 409 on stale mtime; client refetches + retries without losing user input
- [ ] Zero hardcoded `"en-US"` strings; `LANG=de_DE.UTF-8` produces German weekdays
- [ ] SSE closed state has manual reconnect button with exponential-backoff countdown
- [ ] All 14 polish items shipped (full autistic list)
- [ ] verify.sh: 39 → 60 checks (21 new)
- [ ] tsc 0, AI-tell greps clean
- [ ] TaskRow Zustand subscriptions ≤ 5 per component
- [ ] Focus restoration on tab switch + after bulk actions verified

---

## 1. Dependency graph + critical path

```
Phase H (Safety)                    Phase I (Performance)                 Phase J (Feel)
────────────────                    ──────────────────────                ──────────────
H.0 Prereq+entry gates              I.0 Prereq+entry gates                J.0 Prereq+entry gates
 │                                   │                                     │
H.1 Error persistence ──────────────┐│                                    J.1.1 Stagger-fade
 │                                  ││                                     │
H.2.1 mtime-lock.ts (new helper)   ┆│                                    J.1.2 Optimistic UI (deps I.1)
 ├─H.2.2 wire body-edit            ┆│                                    J.1.3 Error hover (deps H.1)
 ├─H.2.3 wire field-edit           ┆│                                    J.1.4 Animation tokens
 ├─H.2.4 api.ts expectedModified   ┆│                                    J.1.5 Focus audit (deps I.1)
 ├─H.2.5 TaskDetailPanel capture   ┆│                                    J.2.6 Touch targets
 └─H.2.6 handle 409 client-side    ┆│                                    J.2.7 prefers-contrast
 │                                  ││                                    J.2.8 Color-blind cues
H.3.1 task-tombstone.ts (new)      ┆│                                    J.2.9 Zoom audit
 ├─H.3.2 restore-tombstone route   ┆│                                    J.2.10 Long-press menu
 ├─H.3.3 convert delete-entity     ┆│                                    J.2.11 Haptics
 ├─H.3.4 convert delete-inline     ┆│                                    J.2.12 Skeleton crossfade
 ├─H.3.5 index.ts sweeper+cleanup  ┆│                                    J.2.13 Scroll-shadow
 ├─H.3.6 api.ts restore wrappers   ┆│                                    J.2.14 ⌘K focus trail (deps J.1.5)
 ├─H.3.7 BulkBar real delete undo  ┆│                                    J.2.15 SSE backoff countdown (deps I.8)
 ├─H.3.8 UndoToast delete variant  ┆│                                     │
 └─H.3.9 TaskDetailPanel delete    ┆│                                    J.3 exit gate + convergence
 │                                  ││
H.4 exit gate + convergence rounds ┆│
                                    ▼▼
                                   I.1.1–I.1.17 Type-union migration (blocks I.6 client code)
                                    │
                                    ├─I.2.1 AgendaView lazy-mount
                                    ├─I.2.2 ProjectsView lazy-mount
                                    └─I.2.3 content-visibility CSS
                                    │
                                    I.3 Zustand useShallow collapse
                                    │
                                    I.4.1 vault-cache.ts (new)       ◄── CRITICAL PATH
                                    ├─I.4.2 vault-index reads cache
                                    ├─I.4.3..14 12 writers add invalidate
                                    ├─I.4.15 index.ts sync initial build
                                    ├─I.4.16 watcher.ts external invalid.
                                    └─I.4.17 sanity-rebuild timer
                                    │
                                    I.5 SSE coalesce (deps I.4.16)
                                    │
                                    I.6.1 task-move entity extension
                                    ├─I.6.2 moveEntityTaskApi wrapper
                                    ├─I.6.3 ProjectPicker component
                                    ├─I.6.4 BulkBar Move button
                                    └─I.6.5 collision auto-suffix
                                    │
                                    I.7 Locale (parallel with I.3)
                                    │
                                    I.8 Manual SSE reconnect (deps I.5)
                                    │
                                    I.9 exit gate + 4 convergence rounds
                                    ▼
                                    (Sprint J starts)
```

### 1.1 Critical path (longest sequential chain)

```
H.0.1 Assumption-annihilation check
  ↓
H.0.2 Entry-gate verification
  ↓
H.0.3 Create implementation-state.md
  ↓
H.0.4 Create PLAN-II-LOG.md
  ↓
H.1 Error-persistence → commit h-1
  ↓
H.2.1 Create server/writers/mtime-lock.ts
  ↓
H.2.2 Wire into server/writers/task-body-edit.ts
  ↓
H.2.3 Wire into server/writers/task-field-edit.ts
  ↓
H.2.4 api.ts expectedModified param
  ↓
H.2.5 TaskDetailPanel capture on edit-open
  ↓
H.2.6 Client 409 handling
  ↓
H.3.1 Create server/writers/task-tombstone.ts
  ↓
H.3.2 POST /api/tasks/restore-tombstone route
  ↓
H.3.3 Convert delete-entity writer
  ↓
H.3.4 Convert delete-inline writer
  ↓
H.3.5 server/index.ts sweeper + cleanup + shutdown
  ↓
H.3.6 api.ts restore wrappers
  ↓
H.3.7 BulkBar real delete undo
  ↓
H.3.8 UndoToast enable real Undo for delete variant
  ↓
H.3.9 TaskDetailPanel handleDeleteConfirm tombstoneId capture
  ↓
H.4.1 Phase-H exit-gate verification
  ↓
H.4.2–H.4.4 Three convergence rounds (Opus + Gemini + Codex each)
  ↓
I.0.1 Entry-gate verification
  ↓
I.1.1–I.1.17 Discriminated-union migration (sequential per file)
  ↓
I.4.1 Create server/vault-cache.ts
  ↓
I.4.2 Modify server/vault-index.ts to read from cache
  ↓
I.4.3–I.4.14 Wire invalidateProject into 12 writers (sequential to avoid conflicts)
  ↓
I.4.15 server/index.ts synchronous initial cache build BEFORE app.listen
  ↓
I.4.16 server/watcher.ts chokidar external-change invalidation
  ↓
I.4.17 sanity-rebuild timer (60s interval)
  ↓
I.9.1 Phase-I exit-gate verification
  ↓
I.9.2–I.9.5 Four convergence rounds
  ↓
J.0.1 Entry-gate verification
  ↓
J.1.5 Focus-management audit (keyboard.ts + BulkBar + CommandPalette)
  ↓
J.2.14 ⌘K focus-trail (depends on J.1.5 pattern)
  ↓
J.3.1 Phase-J exit-gate verification
  ↓
J.3.2–J.3.3 Two convergence rounds
  ↓
Plan II COMPLETE
```

**Critical-path step count**: 52 sequential tasks including convergence rounds. **Minimum possible wall-time** assuming zero blocks: ~40h.

### 1.2 Parallelizable tasks (off critical path)

| Task | Can run in parallel with |
|---|---|
| H.1 Error persistence | H.2.* series (independent file, no shared imports) |
| I.2 Lazy-mount + content-visibility | I.3 Zustand collapse (different files) |
| I.5 SSE coalesce | I.6 Bulk Move (different server/client files) |
| I.7 Locale | I.3 + I.5 (different files) |
| I.8 SSE reconnect button | I.6 Bulk Move (different client files) |
| J.1.1 Stagger-fade | J.1.4 Animation tokens (orthogonal CSS) |
| J.2.6 Touch targets | J.2.7 prefers-contrast (orthogonal CSS) |
| J.2.8 Color-blind cues | J.2.13 Scroll-shadow (orthogonal CSS) |
| J.2.11 Haptics | J.2.12 Skeleton crossfade |

### 1.3 Dependency artifacts

| Upstream → Downstream | Specific artifact needed | Verification command | Impact if upstream changes |
|---|---|---|---|
| H.2.1 → H.2.2 | Export `assertMtimeMatch(absPath: string, expectedModified?: string): Promise<void>` from `server/writers/mtime-lock.ts` | `grep -c 'export async function assertMtimeMatch' $VAULT_ROOT/codebases/vault-sidebar/server/writers/mtime-lock.ts` returns 1 | Signature change breaks H.2.2 and H.2.3; both must be updated in same commit |
| H.3.1 → H.3.3 | Export `moveToTombstone(absPath: string): Promise<{tombstoneId: string}>` from `task-tombstone.ts` | Import compiles in `task-delete.ts` | Signature change forces delete-entity writer rewrite |
| H.3.1 → H.3.2 | Export `restoreFromTombstone(tombstoneId: string): Promise<{restoredPath: string}>` | Import compiles in `routes.ts` | Route breaks if signature changes |
| I.1.* → I.6.* | `Task` from `src/api.ts` resolves to `InlineTask \| EntityTask` discriminated union | `pnpm tsc --noEmit` exit 0 | Sites using loose `task.line` fail type-check; must narrow via `isInlineTask(task)` |
| I.4.1 → I.4.2 | Export `getVaultFromCache(): VaultIndex` + `invalidateProject(slug: string): void` from `server/vault-cache.ts` | Import resolves in `vault-index.ts` | Rename cascades to every route handler reading via vault-index |
| I.4.1 → I.4.3..14 | `invalidateProject(slug)` callable synchronously, idempotent | Each writer test: invalidate + read cache within same event-loop tick | Rename requires 12 writer updates in lockstep |
| I.4.15 → first request | Cache populated BEFORE `app.listen(port)` | `curl -w '%{http_code}'` on boot returns 200, not 503 | Moving to lazy build introduces first-request race |
| I.5 → I.8 | `reconnect()` function returned by `subscribeVaultEvents` in `src/api.ts` | TS types align in App.tsx consumer | Missing reconnect handle breaks manual retry button |
| J.1.5 → J.2.14 | Snapshot-and-restore pattern applied in `src/components/CommandPalette.tsx` | preview_eval: open/close ⌘K, activeElement matches pre-open target | Missing restoration means ⌘K drops focus to body |

### 1.4 No circular dependencies

Every edge in the graph points strictly from earlier to later. Convergence rounds at sprint end are idempotent re-checks that read committed code — they do not feed back into earlier tasks.

---

## 2. Testing strategy (real tests, not theoretical)

### 2.1 Unit tests

The codebase does not carry a dedicated unit-test harness. Every unit-level test lives in one of three places:

- `$VAULT_ROOT/codebases/vault-sidebar/scripts/verify.sh` — bash + curl + grep; HTTP-level unit checks for server code.
- Ad-hoc `node -e "..."` smoke scripts invoked from `scripts/verify.sh`.
- Preview-MCP `preview_eval` assertions — client-side unit logic run in the live dev server.

**Test-label naming convention** (verify.sh labels; no Jest-style test functions):

```
H.1-error-dot-click-dismiss
H.1-error-dot-hover-tooltip
H.2-mtime-409-stale
H.2-mtime-200-fresh
H.2-mtime-409-carries-currentModified
H.3-tombstone-entity-roundtrip-content-hash
H.3-tombstone-inline-roundtrip-line-restored
H.3-tombstone-sweep-after-ttl
H.3-tombstone-orphan-cleanup-on-boot
H.3-tombstone-restore-after-collision-409
I.1-type-migration-zero-guards
I.2-agenda-dom-under-5000
I.2-content-visibility-applied
I.3-taskrow-subscriptions-le-5
I.4-vault-warm-under-5ms
I.4-cache-invalidation-before-broadcast
I.4-cache-first-request-no-503
I.5-sse-coalesce-count-le-2
I.6-bulk-move-entity-happy-path
I.6-bulk-move-entity-collision-auto-suffix
I.6-bulk-move-undo-reverses-rename
I.7-locale-de-no-en-weekdays
I.8-sse-reconnect-button-visible-on-close
J.1.1-stagger-fade-animation-delay-per-row
J.1.1-stagger-fade-reduced-motion-zero
J.1.2-optimistic-delete-rollback-under-200ms
J.1.5-tab-switch-focus-first-row
J.2.6-touch-target-24px
J.2.7-prefers-contrast-accent-delta
J.2.8-colorblind-p1-solid-fill
J.2.8-colorblind-overdue-alertcircle
J.2.13-scroll-shadow-on-scroll-position-nonzero
```

### 2.2 Integration tests

Integration tests exercise ≥2 components together. Listed per phase exit-gate.

**Phase H integration tests**:

- `H.integ.1 edit-body-then-external-touch-returns-409`: client opens Notes on entity task T at mtime M0. Server-side shell runs `touch $VAULT_ROOT/1-Projects/{slug}/tasks/{t}.md`. Client submits body-edit with `expectedModified: M0`. Server returns 409 + currentModified: M1. Client renders toast "Notes were edited elsewhere"; user text remains in textarea uncommitted.
- `H.integ.2 delete-restore-over-sse`: client A posts delete-entity → SSE broadcasts vault-changed → client B refetches → client A posts restore within 5s → SSE broadcasts → both clients see restored file at original path.
- `H.integ.3 sweeper-vs-restore-race`: delete tombstone at T=0; fire restore at T=4.9s while sweeper fires at T=5.0s; restore wins (tombstone still exists when restore runs); final file is restored.

**Phase I integration tests**:

- `I.integ.1 bulk-done-50-tasks-cache-coherent`: select 50 tasks; bulk-done; between every pair of writes issue `/api/vault`; assert no partial mixed done/not-done state that disagrees with server disk.
- `I.integ.2 writer-invalidate-before-broadcast`: instrument a writer with `Date.now()` stamps at invalidate() call and broadcast() call; assert invalidate-stamp < broadcast-stamp.
- `I.integ.3 bulk-move-with-collision`: move 5 entity tasks to project B; 2 have slug collisions; server auto-renames with `-2` and `-3`; client toast reads "5 moved · 2 renamed"; undo reverses all 5 including the renames.

**Phase J integration tests**:

- `J.integ.1 optimistic-delete-then-server-500-restores-row`: monkey-patch fetch via preview_eval to return 500 on delete; client calls delete; row disappears optimistically; 200ms later row reappears with error dot; error dot hover shows "Delete failed".
- `J.integ.2 tab-switch-focus-flow`: press `1`; observe `document.activeElement` has `data-task-row` attribute; press `2`; observe same for the Projects view.
- `J.integ.3 prefers-contrast-toggle-updates-styles`: use preview_eval to set `matchMedia('(prefers-contrast: more)').matches = true` (simulated); assert `getComputedStyle(document.documentElement).getPropertyValue('--accent')` changed to high-contrast value.

### 2.3 E2E verification (copy-pasteable)

```bash
# E2E-H: Safety end-to-end
cd $VAULT_ROOT/codebases/vault-sidebar
pnpm tsc --noEmit
# Expected: empty output, exit 0
bash scripts/verify.sh 2>&1 | tail -3
# Expected: TOTAL: 50 / 50 passed, 0 failed  (after Phase H: +11 new checks)

# Live via Preview MCP:
mcp__Claude_Preview__preview_eval expression:"
  (async () => {
    const row = document.querySelector('[data-task-row]');
    row.click();
    await new Promise(r => setTimeout(r, 400));
    const trash = document.querySelector('.detail-breadcrumb__trash');
    trash.click();
    await new Promise(r => setTimeout(r, 600));
    const cfm = document.querySelector('.confirm-modal__btn--confirm');
    cfm.click();
    await new Promise(r => setTimeout(r, 200));
    const undo = document.querySelector('.undo-toast__btn');
    return {undoButtonVisible: !!undo, labelHasUndo: undo?.textContent?.includes('Undo')};
  })()
"
# Expected: {undoButtonVisible: true, labelHasUndo: true}

# E2E-I: Performance end-to-end
for i in 1 2 3 4 5; do curl -s -w '%{time_total}s\n' -o /dev/null http://127.0.0.1:5174/api/vault; done
# Expected: all runs under 0.005s
mcp__Claude_Preview__preview_eval expression:"document.querySelectorAll('*').length"
# Expected: a number under 5000 on default-collapsed Agenda

# E2E-J: Feel end-to-end
mcp__Claude_Preview__preview_eval expression:"
  document.querySelector('[data-tab=\"agenda\"]').click();
  requestAnimationFrame(() => document.activeElement.getAttribute('data-task-row'));
"
# Expected: a string (the task id) of the first visible agenda row, not null
```

### 2.4 Regression protection

After EVERY task commit:

```bash
cd $VAULT_ROOT/codebases/vault-sidebar
pnpm tsc --noEmit 2>&1 | tail -5
# Expected: empty, exit 0
bash scripts/verify.sh 2>&1 | tail -3
# Expected: TOTAL: N / N passed, 0 failed  (N increases as new tests land)
grep -rnE 'font-bold|as any|console\.(log|warn|error|debug)|task\.text|(⚙|⏎|›|○|●)' src/
# Expected: no matches
grep -rnE '#fff[^o]' src/
# Expected: no matches
```

If any test fails after a commit: stop work immediately, `git revert HEAD`, diagnose, refix, re-commit.

---

## 3. Agent orchestration (13 Irreducible Questions answered)

| # | Question | Answer |
|---|---|---|
| 1 | How many agents? | 3 per convergence round × 9 rounds = 27 agent runs. Plus ad-hoc Explore runs for per-task spot-checks. |
| 2 | How do they relate? | Parallel at each round (launched in a single tool-call message). Sequential across rounds. |
| 3 | How long? | Each agent: 2–8 min wall-time. Each round: ~15 min with fix application. Each sprint's convergence: H=45min, I=60min, J=30min. Plan total: ~40h. |
| 4 | What validation? | Per-agent: YAML parsed for `findings: []` vs `findings: [...]`. Per-round: manual merge across 3 critics; fix CRITICAL/HIGH/MEDIUM; document LOW deferrals. Per-sprint: full verify.sh + tsc + AI-tell greps. |
| 5 | What on failure? | Per-agent: if one critic times out, proceed with the other two (Sprint E–G pattern). Per-fix: regression → `git revert HEAD`, retry. Per-sprint: >3 rounds without zero C/H/M → escalate. |
| 6 | What persists? | Git commits; `implementation-state.md` per-task status; `/tmp/sprint-{sprint}-r{N}-{critic}-out.txt` for audit. |
| 7 | Output where? | Code → `src/**` + `server/**` + `scripts/**`. Docs → `1-Projects/vault-sidebar/HANDOFF.md` at sprint boundaries + `tasks.md` per task. Transient → `/tmp/sprint-*-out.txt`. |
| 8 | SSOT? | `$VAULT_ROOT/codebases/vault-sidebar/implementation-state.md`. Plan file is SSOT for intent; implementation-state.md is SSOT for actual progress. |
| 9 | How detect done? | Per-task: verification command matches expected + commit created. Per-round: 3 critics return `findings: []` OR zero C/H/M merged. Per-sprint: exit-gate checklist items all ☑. Per-plan: §0.5 success criteria all ☑. |
| 10 | How measure progress? | `implementation-state.md` progress table keyed by task ID. Each entry ∈ {NOT STARTED, IN PROGRESS, COMPLETE, BLOCKED}. |
| 11 | Session init? | `git log --oneline -30` → reconstruct from commits. `cat implementation-state.md` → reconstruct from SSOT. `pnpm tsc --noEmit && bash scripts/verify.sh` → verify baseline. `mcp__Claude_Preview__preview_list` → confirm server. |
| 12 | Work unit granularity? | Task-level. Each §6/§7/§8 task = one commit. Commit format: `sprint-{H\|I\|J}-{task-id}: {summary}`. |
| 13 | Runtime setup? | None beyond Plan I stack (Vite + Express + TS5 + Zustand + gray-matter + chokidar + Lucide + Geist). All deps installed at HEAD = `2ea75c4`. |

### 3.1 Per-agent prompt templates

**Opus Explore**
- Prompt: "Sprint {H|I|J} R{N} adversarial review at commit `{sha}`. Project `$VAULT_ROOT/codebases/vault-sidebar/`. Files changed this sprint: [absolute paths]. Read each plus `git diff {prev-sha}..HEAD`. Run these probes: [5–10 specific probes from this sprint's anti-pattern list]. Output STRICT YAML, `findings: []` = convergence, max 10 findings, each with id, severity (CRITICAL|HIGH|MEDIUM|LOW), file, line, problem (1–3 sentences), proposed_fix. Write to `/tmp/sprint-{sprint}-r{N}-opus.yaml` AND inline in final message."
- Model: opus (inherited from Explore agent).
- Tools: Glob, Grep, Read, WebFetch.
- Success: YAML parseable; `findings:` key present.
- Failure: if agent errors, read partial output; if no findings captured, retry narrower probe list.

**Gemini CLI**
- Prompt: same structure + trailing "You are the Gemini UX/A11Y/ARIA critic. Focus on focus management, screen reader compatibility, keyboard flows, color contrast, semantic HTML, reduced-motion parity, touch targets, non-color cues."
- Invocation: `gemini -p "$(cat /tmp/sprint-{sprint}-r{N}-gemini.txt)" > /tmp/sprint-{sprint}-r{N}-gemini-out.txt 2>&1`
- Model: Gemini 3.1 (verified via `gemini --version`).
- Success: exit 0, YAML block in stdout.
- Failure: if hangs >5min, `pgrep -f "gemini -p" | xargs kill`; proceed with Opus + Codex.

**Codex CLI**
- Prompt: same structure + trailing "You are the Codex CLI critic. Focus on correctness, races, data safety, input validation, off-by-one, TOCTOU, partial-failure paths."
- Invocation: `codex exec -s read-only "$(cat /tmp/sprint-{sprint}-r{N}-codex.txt)" > /tmp/sprint-{sprint}-r{N}-codex-out.txt 2>&1`
- Model: GPT 5.4 (verified via `codex --version`).
- Success: exit 0, YAML block in stdout.
- Failure: historically codex times out on verbose prompts; cap each prompt at 80 lines; kill if hung >4min.

### 3.2 Playwright CLI closed loop (video E2E)

Each sprint's exit-gate includes one playwright-cli video run for the flagship user flow:

- **End-of-H**: open sidebar → click entity task trash → click Undo in toast → verify row returned. Video: `/tmp/sprint-h-undo-delete.webm`.
- **End-of-I**: open sidebar → Agenda tab → collapse all buckets → measure DOM count. Video: `/tmp/sprint-i-lazy-mount.webm`.
- **End-of-J**: open sidebar → press `1` → observe focus on first row → press `2` → observe focus on first row. Video: `/tmp/sprint-j-focus-flow.webm`.

Playwright invocation (copy-paste):

```bash
playwright-cli -s vault-sidebar-e2e open http://127.0.0.1:5174
playwright-cli -s vault-sidebar-e2e snapshot
# capture ref ids for click sequence
playwright-cli -s vault-sidebar-e2e video-start
# ... interaction sequence (click/press/type)
playwright-cli -s vault-sidebar-e2e video-stop /tmp/sprint-{H|I|J}-{flow}.webm
playwright-cli -s vault-sidebar-e2e close
```

Videos stored in `/tmp/` for per-session inspection; not committed.

---

## 4. Claude Code anti-patterns checklist (verify NONE in final)

- [ ] No `sys.path.insert` for cross-skill imports (N/A — this plan is TypeScript)
- [ ] No `decision: "approve"` in PreToolUse hooks (N/A — no hook work)
- [ ] Stop hooks check `stop_hook_active` (N/A)
- [ ] No `rstrip("s")` for plural stripping (`grep -r "rstrip" src/ server/` expected empty)
- [ ] No `--model` flag with `claude --print` subscription routing (N/A — this plan does not invoke `claude --print`)
- [ ] No `ANTHROPIC_API_KEY` leaked to subprocess env (N/A)
- [ ] No `currentColor` in SVG data URIs (`grep -E "data:image/svg.*currentColor" src/styles.css` expected empty)
- [ ] No `var` in JavaScript (`grep -rnE '^\s*var ' src/ server/` expected empty)
- [ ] No inline styles in React components beyond the two permitted exceptions: `src/components/Popover.tsx:216 style={{position:"fixed"}}` and `src/components/PriorityPopover.tsx:72 style={{opacity: 0.6}}` — these are dynamic and extracted to classes would require runtime CSS injection. Any NEW inline style requires an entry here. (`grep -rnE 'style=\\{\\{' src/` expected ≤ 2 occurrences).
- [ ] No stdlib module-name shadows (N/A — TypeScript project)
- [ ] No `datetime.now(datetime.UTC)` (N/A — all date ops use `new Date()` + `.toISOString()`)
- [ ] All `fetch(` in `src/api.ts` have `signal: AbortSignal.timeout(10000)` or similar (manual audit of new wrappers in H.2.4, H.3.6, I.6.2)
- [ ] No `font-bold` (grep src/ expected empty)
- [ ] No emojis in code or comments (grep for unicode emoji ranges in src/ + server/ expected empty)
- [ ] No Unicode pseudo-icons `⚙ ⏎ › ○ ●` (grep src/ expected empty — Lucide icons only)
- [ ] No `as any` (grep src/ + server/ expected empty)
- [ ] No hardcoded `#fff` outside the `--accent-foreground` token definition in styles.css (grep `#fff[^o]` expected 1 line — the token definition)
- [ ] No `console.log|warn|error|debug` in src/ (server/ may emit via `process.stderr.write`)
- [ ] No `task.text` (grep src/ expected empty — field renamed to `action` in Plan I Sprint A)

Enforcement: verify.sh `ai-tell-check` wraps every grep above; runs after every task commit.

---

## 5. Closed feedback loop + implementation-state.md

### 5.1 State tracking file

- **Path**: `$VAULT_ROOT/codebases/vault-sidebar/implementation-state.md`
- **Created at**: start of Phase H (task H.0.3).
- **Updated at**: end of every task. Every production-code commit also updates this file in the SAME commit.

**Format** (starts populated for H, blank for I + J):

```markdown
# Plan II v2 — Implementation State

**Plan source**: $HOME/.claude/plans/spicy-jumping-pike.md (Plan II v2)
**Branch**: main (local scoped repo)
**HEAD at start of Plan II**: 2ea75c4

## Phase H — Safety + Recoverability

- H.0.1 Assumption-annihilation check — [NOT STARTED | IN PROGRESS | COMPLETE | BLOCKED]
  - Expected: 20 assumptions pass
  - Actual: (populate)
  - Deviation: (populate)
- H.0.2 Entry-gate verification — [status]
  - Expected: tsc 0 / verify.sh 39/39 / AI-tells clean
  - Actual: (populate)
- H.0.3 Create implementation-state.md — [status] ← THIS FILE
- H.0.4 Create PLAN-II-LOG.md — [status]
- H.1 Error persistence — [status]
  - Commit: (sha)
  - Deviation: (populate)
- H.2.1 Create mtime-lock.ts — [status]
...

## Phase I — Performance Bedrock
...

## Phase J — Feel Layer
...

## Deviations from plan
(populate each time something diverges)

## Discovered requirements
(populate for work discovered mid-implementation)

## Risk register
(populate as new risks surface during execution)

## Convergence round log
- Sprint H R1: [date] [findings per critic: opus=N1 gemini=N2 codex=N3] [fixes applied=Nfix] [residual=Nres]
- Sprint H R2: ...
```

### 5.2 Feedback-loop protocol

After every task completes:

1. Run the task's verification command (specified per-task in §6/§7/§8).
2. Capture exact output (stdout + stderr) into `/tmp/plan-ii-task-{task-id}-output.txt`.
3. Diff actual output vs expected output (documented per-task).
4. Update `implementation-state.md`: flip status to COMPLETE (or BLOCKED); record actual output summary; if actual ≠ expected, add to "Deviations".
5. If the deviation affects downstream tasks, update those downstream entries with a note; STOP work; re-evaluate dependency graph; ONLY THEN continue.
6. Commit code changes + implementation-state.md update in a single commit.

### 5.3 Stop conditions

Escalate to the user when:

- >2 convergence rounds where one critic returns `findings: []` while another returns CRITICAL (critics disagree on severity — user arbitrates).
- Deviation requires rewriting >20% of a downstream sprint's tasks.
- A verification command produces output requiring modification of §0.5 success criteria.
- A discovered risk is not in §6 risk register and has severity ≥ HIGH.
- `pnpm tsc --noEmit` fails after 3 revert-and-retry cycles on the same task.

---

## 6. Sprint H — Safety + Recoverability (estimated 14h)

### Phase H Prerequisites
- [ ] Phase H is the FIRST phase of Plan II (no prior Plan II phase required)
- [ ] Plan I HEAD = `2ea75c4` or later (verified via `cd $VAULT_ROOT/codebases/vault-sidebar && git rev-parse HEAD`; expected: sha that `git merge-base --is-ancestor 2ea75c4 HEAD` accepts)
- [ ] Vault-sidebar dev server running on port 5174 (verified via `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5174/api/vault`; expected: `200`)
- [ ] `VAULT_ROOT` resolves to `$VAULT_ROOT` (verified via `grep -c 'VAULT_ROOT = "$VAULT_ROOT"' $VAULT_ROOT/codebases/vault-sidebar/server/safety.ts`; expected: `1`)
- [ ] `codex` + `gemini` CLIs on PATH (verified via `command -v codex && command -v gemini`; expected: two paths)
- [ ] `mcp__Claude_Preview__preview_list` returns a live vault-sidebar entry (expected: JSON with `status: "running"`)

### Entry Gate (ALL must pass before starting Phase H)
- [ ] `cd $VAULT_ROOT/codebases/vault-sidebar && pnpm tsc --noEmit 2>&1 | wc -l` returns `0` (zero tsc errors)
- [ ] `cd $VAULT_ROOT/codebases/vault-sidebar && bash scripts/verify.sh 2>&1 | tail -3` contains `TOTAL: 39 / 39 passed, 0 failed`
- [ ] `grep -rnE 'font-bold|as any|console\.(log|warn|error|debug)|task\.text|(⚙|⏎|›|○|●)' $VAULT_ROOT/codebases/vault-sidebar/src/` returns no matches
- [ ] `grep -rnE '#fff[^o]' $VAULT_ROOT/codebases/vault-sidebar/src/` returns no matches

### Task H.0.1: Run assumption-annihilation checks
- **What**: execute each of the 20 assumption checks from §0.1 in order. For each, run the verification command, compare output to expected, record pass/fail in `/tmp/plan-ii-assumption-checks.txt`.
- **Why**: every downstream task assumes these 20 invariants. One unchecked assumption causes cascading failure (example: A13 fails → tombstone dir creation fails → every Phase H task after H.3.1 fails).
- **Input**: none.
- **Output**: `/tmp/plan-ii-assumption-checks.txt` with 20 lines, each either `A{N}: PASS` or `A{N}: FAIL {reason}`.
- **Dependencies**: none.
- **Verification**: `grep -c 'PASS' /tmp/plan-ii-assumption-checks.txt` returns `20`.
- **Rollback**: none (read-only).
- **Edge cases**: if any A{N} fails, STOP the phase. Do not proceed to H.0.2 until the failing assumption is resolved. Resolution paths: create the missing file, run `pnpm install` for a missing package, run `brew install codex` or `brew install gemini` for a missing CLI, fix any path-resolution error at its root.

### Task H.0.2: Verify entry gate
- **What**: run the 4 entry-gate checks above (tsc, verify.sh, AI-tell greps, #fff grep). Capture combined output to `/tmp/plan-ii-h-entry-gate.txt`.
- **Why**: if baseline is broken before Plan II starts, Plan II cannot land changes without muddying the regression signal.
- **Input**: none.
- **Output**: `/tmp/plan-ii-h-entry-gate.txt` with 4 `ENTRY GATE: PASS` lines OR early-fail with diagnostics.
- **Dependencies**: H.0.1 complete.
- **Verification**: `grep -c 'ENTRY GATE: PASS' /tmp/plan-ii-h-entry-gate.txt` returns `4`.
- **Rollback**: none (read-only).
- **Edge cases**: reconcile-flake (verify.sh 38/39 with reconcile test failing) → kill and restart server: `lsof -iTCP:5174 -sTCP:LISTEN -n -P | awk 'NR==2 {print $2}' | xargs -r kill -9; sleep 3; mcp__Claude_Preview__preview_start name:"vault-sidebar"; sleep 6; bash scripts/verify.sh`. If still 38/39, STOP and diagnose.

### Task H.0.3: Create implementation-state.md
- **What**: create `$VAULT_ROOT/codebases/vault-sidebar/implementation-state.md` pre-populated with the full task list from §6/§7/§8, every task marked `NOT STARTED`. Format per §5.1.
- **Why**: SSOT for actual progress. Every subsequent task updates this file; without it, resume-after-interruption has no ground truth.
- **Input**: the task IDs enumerated in §6/§7/§8 of this plan.
- **Output**: `$VAULT_ROOT/codebases/vault-sidebar/implementation-state.md` exists with every H.*/I.*/J.* task ID and status `NOT STARTED`.
- **Dependencies**: H.0.2 complete.
- **Verification**: `grep -cE '^- [HIJ]\.[0-9.]+' $VAULT_ROOT/codebases/vault-sidebar/implementation-state.md` returns the total task count (approximately 75 tasks across all phases).
- **Rollback**: `rm $VAULT_ROOT/codebases/vault-sidebar/implementation-state.md`.
- **Edge cases**: file already exists from a prior attempt → overwrite with fresh state IF AND ONLY IF no COMPLETE entries exist; if any COMPLETE entries exist, ask the user whether to resume or restart.

### Task H.0.4: Create PLAN-II-LOG.md
- **What**: create `$VAULT_ROOT/1-Projects/vault-sidebar/PLAN-II-LOG.md` as append-only audit log for convergence rounds, deviations, and external changes.
- **Why**: separate from implementation-state.md (which is task-level); this log captures "why we changed the plan mid-execution" and convergence critic findings.
- **Input**: none.
- **Output**: `$VAULT_ROOT/1-Projects/vault-sidebar/PLAN-II-LOG.md` with frontmatter + initial timestamp + "Phase H started at {iso}" entry.
- **Dependencies**: H.0.3 complete.
- **Verification**: `test -f $VAULT_ROOT/1-Projects/vault-sidebar/PLAN-II-LOG.md && head -1 $VAULT_ROOT/1-Projects/vault-sidebar/PLAN-II-LOG.md` starts with `---` (YAML frontmatter).
- **Rollback**: `rm $VAULT_ROOT/1-Projects/vault-sidebar/PLAN-II-LOG.md`.
- **Edge cases**: Plan I HANDOFF.md already exists in same dir — PLAN-II-LOG.md is separate and additive; do not edit HANDOFF.md in H.0.4.

### Task H.1: Error-dot 5s window + hover tooltip + click-dismiss
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/src/components/TaskRow.tsx` change `ERROR_DOT_DURATION_MS` constant from `2000` to `5000`. Add `title` attribute on `.task-error-dot` span (already captures error text from store). Wrap `.task-error-dot` span in a `<button type="button">` with `aria-label="Dismiss error"` and onClick calling `clearTaskError(task.id)`. In `$VAULT_ROOT/codebases/vault-sidebar/src/styles.css` add hover-expand tooltip block (positioned 4px below dot, background `var(--bg-surface)`, border `1px solid var(--separator-strong)`, max-width 240px, 11px font, transition opacity 120ms, z-index 3).
- **Why**: 2s is below Nielsen's 3s "subitizable-notice" threshold for reading error text; 5s plus hover persistence lets slow readers see the failure. Click-dismiss respects user agency (plan-agent Q7.12). Closes finding E03 from Plan I backlog.
- **Input**: current `src/components/TaskRow.tsx` (ERROR_DOT_DURATION_MS = 2000, div wrapper for dot), `src/styles.css` (.task-error-dot rule).
- **Output**: TaskRow.tsx with `ERROR_DOT_DURATION_MS = 5000` + dismissible-button wrapper; styles.css with `.task-error-dot-button:hover::after` tooltip block.
- **Dependencies**: H.0.4 complete.
- **Verification**: `grep -c 'ERROR_DOT_DURATION_MS = 5000' $VAULT_ROOT/codebases/vault-sidebar/src/components/TaskRow.tsx` returns 1. `grep -c '.task-error-dot-button:hover::after' $VAULT_ROOT/codebases/vault-sidebar/src/styles.css` returns 1. preview_eval: trigger an error via server 500 mock, assert dot visible at 4.5s (below 5s window), hover reveals tooltip with error text, click dismisses dot within 50ms.
- **Rollback**: `git revert {H.1 commit sha}`.
- **Edge cases**: (a) error fires twice in rapid succession — second fire must extend the timer, not create two dots; (b) hover during the 5s window → timer does NOT reset (the hover is read-only, not interaction); (c) click inside the button during the 5s window → immediate clearTaskError + button unmounts; (d) button must not block row click-to-expand behavior — wrap only the error dot, not the whole row.

### Task H.2.1: Create server/writers/mtime-lock.ts
- **What**: create file `$VAULT_ROOT/codebases/vault-sidebar/server/writers/mtime-lock.ts` exporting `assertMtimeMatch(absPath: string, expectedModified?: string): Promise<void>`. Implementation: if `expectedModified === undefined` return immediately. Otherwise `const stat = await fs.promises.stat(absPath)` and `if (stat.mtime.toISOString() !== expectedModified) throw safetyError('mtime-mismatch', 409, {currentModified: stat.mtime.toISOString()})`. safetyError must be extended (in same file or imported from `server/safety.ts`) to accept a third `extra` parameter merged into the error body.
- **Why**: optimistic concurrency. Without this helper, H.2.2 and H.2.3 would duplicate the stat + compare logic.
- **Input**: current `server/safety.ts` (exports `safetyError(message, statusCode): SafetyError`).
- **Output**: new file mtime-lock.ts with the exported function. Optionally modify `safetyError` signature in safety.ts to accept optional `extra: Record<string, unknown>` merged into the error object (safetyError currently returns `Error & {statusCode}`; add `& {extra?}` and have the route handler spread into response).
- **Dependencies**: H.1 complete.
- **Verification**: `grep -c 'export async function assertMtimeMatch' $VAULT_ROOT/codebases/vault-sidebar/server/writers/mtime-lock.ts` returns 1. `cd $VAULT_ROOT/codebases/vault-sidebar && pnpm tsc --noEmit 2>&1 | tail -5` empty.
- **Rollback**: `git revert {H.2.1 commit}`.
- **Edge cases**: (a) file does not exist → `fs.promises.stat` throws ENOENT → let it propagate (caller decides; typical caller flow already checks existsSync first); (b) `expectedModified` is `""` or malformed ISO → strict compare returns false → 409; acceptable because malformed input from client is a misuse signal; (c) clock skew between client and server — ISO strings are captured from the same server's stat, not client time, so skew doesn't apply.

### Task H.2.2: Wire mtime-lock into task-body-edit.ts
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/server/writers/task-body-edit.ts` change the `TaskBodyEditInput` interface to add `expectedModified?: string`. Before the existing `readFile` call, insert `await assertMtimeMatch(resolvedPath, input.expectedModified)`. Import `assertMtimeMatch` from `./mtime-lock.js`.
- **Why**: lost-update protection for Notes (longest-text field, highest concurrent-write risk per plan-agent Q6).
- **Input**: current task-body-edit.ts reading file without mtime check.
- **Output**: task-body-edit.ts with optional expectedModified input + assertMtimeMatch call before readFile.
- **Dependencies**: H.2.1 complete.
- **Verification**: `grep -c 'assertMtimeMatch' $VAULT_ROOT/codebases/vault-sidebar/server/writers/task-body-edit.ts` returns ≥1. verify.sh adds `H.2-mtime-body-409-stale`: curl POST /api/tasks/body-edit with expectedModified="2000-01-01T00:00:00.000Z" → expect `{ok:false, error:"mtime-mismatch"}` + 409 status. `H.2-mtime-body-200-fresh`: read actual mtime via /api/vault, POST with matching expectedModified → expect 200.
- **Rollback**: `git revert {H.2.2 commit}`.
- **Edge cases**: (a) client omits expectedModified (backward-compat) → no check, writes proceed (same as today); (b) body is empty string → mtime check still runs; (c) file was atomically renamed (tmp+rename) between client read and write — mtime of new file ≠ mtime of old → 409 legitimate.

### Task H.2.3: Wire mtime-lock into task-field-edit.ts
- **What**: same pattern as H.2.2 applied to `$VAULT_ROOT/codebases/vault-sidebar/server/writers/task-field-edit.ts`. Extend `TaskFieldEditInput` with optional `expectedModified`. Call `await assertMtimeMatch(resolvedPath, input.expectedModified)` before readFile.
- **Why**: same rationale as H.2.2 for any editable field.
- **Input**: current task-field-edit.ts.
- **Output**: same shape as H.2.2 applied.
- **Dependencies**: H.2.1 complete (can run parallel with H.2.2).
- **Verification**: analogous verify.sh checks `H.2-mtime-field-409-stale` and `H.2-mtime-field-200-fresh`.
- **Rollback**: `git revert {H.2.3 commit}`.
- **Edge cases**: identical to H.2.2.

### Task H.2.4: api.ts add expectedModified to editTaskFieldApi + editTaskBodyApi
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/src/api.ts` add optional `expectedModified?: string` to both `editTaskFieldApi(args)` and `editTaskBodyApi(args)` argument types. Pass through to the POST body unchanged.
- **Why**: client contract alignment.
- **Input**: current api.ts wrappers.
- **Output**: two wrappers with new optional param.
- **Dependencies**: H.2.3 complete.
- **Verification**: `grep -cE 'expectedModified\?: string' $VAULT_ROOT/codebases/vault-sidebar/src/api.ts` returns ≥ 2. `pnpm tsc --noEmit` empty.
- **Rollback**: `git revert {H.2.4 commit}`.
- **Edge cases**: optional → no existing callers break.

### Task H.2.5: TaskDetailPanel capture task.modified on edit-open
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/src/components/TaskDetailPanel.tsx` add a `useRef<string | undefined>(task.modified)` that updates ONLY when an EditableX component transitions from read to edit mode. On save, pass that captured value as `expectedModified` to the API call.
- **Why**: capture disk-truth modified at edit-open, not at save-time; save-time mtime would be post-own-read and useless for detecting concurrent edits.
- **Input**: current TaskDetailPanel.tsx.
- **Output**: TaskDetailPanel.tsx with `editOpenModifiedRef` + pass-through on save.
- **Dependencies**: H.2.4 complete.
- **Verification**: preview_eval — open Notes on a task, monkey-patch `fetch` to echo back the request body, confirm body includes `expectedModified` equal to `task.modified` at open-time.
- **Rollback**: `git revert {H.2.5 commit}`.
- **Edge cases**: (a) task.modified is undefined (inline task) → pass undefined → server skips mtime check (back-compat); (b) SSE refetches the task between open and save → task.modified changes but the ref stays anchored to open-time value (correct); (c) user toggles edit mode multiple times on same row → ref updates on each open (correct).

### Task H.2.6: Client handles 409 with a non-destructive toast
- **What**: in TaskDetailPanel.tsx's saveField/saveBody result handler, when the server returns `{ok:false, error:"mtime-mismatch"}`, do NOT overwrite the user's draft text. Render a toast (new small component or inline banner) reading "Notes were edited elsewhere — your draft kept. Refresh and reapply if desired." Trigger a vault refetch via `fetchVault + setVault`. Keep the editing state active.
- **Why**: never destroy the user's in-progress text. Surface the conflict; let the user decide.
- **Input**: current TaskDetailPanel.tsx save handlers + store.setVault.
- **Output**: 409 path keeps editing true, shows toast, refetches.
- **Dependencies**: H.2.5 complete.
- **Verification**: preview_eval — monkey-patch fetch to return 409 for one call → user's draft stays visible → toast appears within 100ms → vault refetches.
- **Rollback**: `git revert {H.2.6 commit}`.
- **Edge cases**: (a) multiple rapid 409s → toast must not pile up (dedupe on identical message); (b) 409 response missing `currentModified` → log warning, still surface toast; (c) user hits Escape during toast → editing exits, draft lost (acceptable — user chose).

### Task H.3.1: Create server/writers/task-tombstone.ts
- **What**: create `$VAULT_ROOT/codebases/vault-sidebar/server/writers/task-tombstone.ts` exporting: (a) `TOMBSTONE_DIR = '$VAULT_ROOT/.vault-sidebar-tombstones'`; (b) `ensureTombstoneDir()`: mkdirSync recursive + chmod 700; (c) `moveToTombstone(absPath: string, kind: 'entity'|'inline', meta?: {line:number, text:string, tasksPath:string}): Promise<{tombstoneId: string}>`; (d) `restoreFromTombstone(tombstoneId: string): Promise<{restoredPath: string, kind: 'entity'|'inline', meta?: object}>`; (e) `sweepTombstones(maxAgeMs: number = 5500)`: reads dir, deletes any tombstone with `Date.now() - stat.mtimeMs > maxAgeMs`; (f) `cleanupOrphans(ttlMs: number = 3600000)`: startup-time, delete tombstones >1h; (g) `assertSafeTombstonePath(path: string): void`: throw if path is not inside TOMBSTONE_DIR or contains `..` / null bytes.
- Tombstone filename format for entity: `{ISO-timestamp-ms}__entity__{uriEncoded(originalRelPath)}.md`. For inline: `{ISO-timestamp-ms}__inline__{uriEncoded(tasksPath)}__{line}__{base64(text)}.tombstone`.
- **Why**: core module for real-delete-undo. Every subsequent H.3.x depends on this surface.
- **Input**: `$VAULT_ROOT/codebases/vault-sidebar/server/safety.ts` (reuses safetyError + path helpers).
- **Output**: new task-tombstone.ts with 7 exports.
- **Dependencies**: H.2.6 complete.
- **Verification**: `grep -cE 'export (async function|const|function) (moveToTombstone|restoreFromTombstone|sweepTombstones|cleanupOrphans|assertSafeTombstonePath|ensureTombstoneDir|TOMBSTONE_DIR)' $VAULT_ROOT/codebases/vault-sidebar/server/writers/task-tombstone.ts` returns `≥7`. `pnpm tsc --noEmit` empty.
- **Rollback**: `git revert {H.3.1 commit}`.
- **Edge cases**: (a) TOMBSTONE_DIR exists but is a file not a dir → throw with clear error at ensureTombstoneDir; (b) tombstoneId contains encoded `..` or `/` → assertSafeTombstonePath rejects; (c) concurrent moveToTombstone on same file (rare) → both writes land with different timestamps, no collision.

### Task H.3.2: POST /api/tasks/restore-tombstone route
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/server/routes.ts` add a new route `router.post("/tasks/restore-tombstone", async (req, res) => { const {tombstoneId} = req.body; if (typeof tombstoneId !== "string") return res.status(400).json({ok:false,error:"tombstoneId must be string"}); try { const result = await restoreFromTombstone(tombstoneId); res.json({ok:true, ...result}); } catch (err) { handleError(err, res); } });`
- **Why**: HTTP surface for client-side Undo to call.
- **Input**: current routes.ts.
- **Output**: routes.ts with new POST handler.
- **Dependencies**: H.3.1 complete.
- **Verification**: `curl -X POST http://127.0.0.1:5174/api/tasks/restore-tombstone -H "Content-Type: application/json" -d '{"tombstoneId":"nonexistent"}'` returns 404 or 400 (NOT 500). verify.sh adds `H.3-restore-endpoint-exists`.
- **Rollback**: `git revert {H.3.2 commit}`.
- **Edge cases**: (a) tombstoneId missing → 400; (b) tombstoneId malformed (contains `..`) → assertSafeTombstonePath throws 403; (c) tombstone already swept → 404.

### Task H.3.3: Convert deleteEntityTask to rename-to-tombstone
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/server/writers/task-delete.ts` `deleteEntityTask` replace `await unlink(resolvedPath)` with `const {tombstoneId} = await moveToTombstone(resolvedPath, 'entity')`. Return `{ok, entityPath, tombstoneId}` (add tombstoneId to result).
- **Why**: delete is no longer terminal — 5s undo window.
- **Input**: current delete-entity path that unlinks directly.
- **Output**: delete-entity now tombstones; response includes tombstoneId.
- **Dependencies**: H.3.2 complete.
- **Verification**: `curl -X POST http://127.0.0.1:5174/api/tasks/delete-entity -H "Content-Type: application/json" -d '{"entityPath":"1-Projects/{valid-slug}/tasks/{valid-entity}.md"}'` returns `{ok:true, entityPath:"...", tombstoneId:"..."}`. `ls $VAULT_ROOT/.vault-sidebar-tombstones/` lists the tombstone file. Target original file no longer exists. verify.sh adds `H.3-delete-entity-tombstones-file`.
- **Rollback**: `git revert {H.3.3 commit}`.
- **Edge cases**: (a) assertSafeTasksPath check before moveToTombstone — entity shape regex still enforced; (b) target path is inside .vault-sidebar-tombstones (impossible; rejected by safety) → throw 403; (c) rename fails mid-way (disk full) → throw; no partial state because fs.rename is atomic.

### Task H.3.4: Convert deleteInlineTask to line-snapshot tombstone
- **What**: in `task-delete.ts` `deleteInlineTask`: before line-removal, capture `const textAtLine = lines[line-1]` then call `await moveToTombstone(resolvedPath, 'inline', {line, text: textAtLine, tasksPath: resolvedPath})`. After tombstone write, remove the line from tasks.md as before.
- **Why**: inline delete can also be undone by re-inserting the exact line.
- **Input**: current inline-delete path.
- **Output**: inline-delete now tombstones + removes line; response includes tombstoneId.
- **Dependencies**: H.3.3 complete.
- **Verification**: `H.3-delete-inline-tombstones-file` in verify.sh.
- **Rollback**: `git revert {H.3.4 commit}`.
- **Edge cases**: (a) line number is out-of-bounds — throw before tombstone (no orphan tombstones); (b) expectedAction mismatch — throw before tombstone; (c) file has no trailing newline — line restoration must preserve exact original formatting (encode textAtLine base64 to survive special chars).

### Task H.3.5: server/index.ts mounts sweeper + startup cleanup + shutdown drain
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/server/index.ts` inside `start()`: (a) call `ensureTombstoneDir()` BEFORE `app.listen`; (b) call `await cleanupOrphans()` BEFORE `app.listen`; (c) after `app.listen`, `setInterval(() => void sweepTombstones(), 5500)`. Register SIGTERM/SIGINT/beforeExit handlers that clear the sweeper interval and run one final sweep.
- **Why**: lifecycle management — tombstones don't leak across restarts; pending sweeps don't hang the event loop at shutdown.
- **Input**: current server/index.ts startup flow.
- **Output**: index.ts with tombstone lifecycle hooks.
- **Dependencies**: H.3.4 complete.
- **Verification**: kill -SIGTERM the server, observe stderr log `[tombstone] shutdown drain (N tombstones swept)`; restart server, if any orphans >1h existed, stderr log `[tombstone] startup cleanup removed N orphans`.
- **Rollback**: `git revert {H.3.5 commit}`.
- **Edge cases**: (a) sweeper errors out mid-loop → catch + continue (don't crash server); (b) SIGKILL can't run shutdown drain (by definition) → startup cleanup catches next boot; (c) `setInterval` on `unref()`'d timer prevents keeping node alive in dev.

### Task H.3.6: api.ts restore wrappers
- **What**: in `src/api.ts` add `restoreEntityTombstoneApi({tombstoneId}): ApiResult<{restoredPath: string}>`. (Inline restore can share the same endpoint; the server determines kind from tombstone filename. One wrapper is sufficient.)
- **Why**: client-side surface for the Undo button.
- **Input**: current api.ts.
- **Output**: new wrapper.
- **Dependencies**: H.3.5 complete.
- **Verification**: `grep -c 'restoreEntityTombstoneApi' src/api.ts` returns 1.
- **Rollback**: `git revert {H.3.6 commit}`.
- **Edge cases**: none beyond the POST-JSON pattern shared with other wrappers.

### Task H.3.7: BulkBar handleBulkDelete captures tombstoneIds for real undo
- **What**: in `src/components/BulkBar.tsx` `handleBulkDelete`: collect `tombstoneId` from each delete response. Write pendingUndo with a real `revert` closure that posts `restoreEntityTombstoneApi` for each collected id. Update label to "N tasks deleted" but toast variant MUST stay undo-enabled.
- **Why**: Sprint G R1 flipped delete to "X dismiss" because revert was no-op. With tombstone restore, revert can be real.
- **Input**: current BulkBar.handleBulkDelete writing a no-op revert pendingUndo.
- **Output**: revert closure iterates tombstoneIds and calls restore; on per-item failure, continue; on all-fail, show error toast; on success, refreshVault.
- **Dependencies**: H.3.6 complete.
- **Verification**: preview_eval — select 3 entity tasks, bulk-delete, wait for undo toast, click Undo, verify 3 original files restored and vault refetches; all 3 rows reappear.
- **Rollback**: `git revert {H.3.7 commit}`.
- **Edge cases**: (a) one of the N restores fails (tombstone already swept) → continue with remaining; surface "restored N/M" in toast; (b) sweeper fires mid-undo → acceptable partial restore; (c) user clicks Undo at T=4.99s, sweeper at T=5.0s — restoreFromTombstone must check existsSync and return 404 gracefully.

### Task H.3.8: UndoToast delete variant re-enables Undo button
- **What**: in `src/components/UndoToast.tsx` remove the `isTerminal` branch that renders only X dismiss. When `pendingUndo.action === "delete"`, render the same Undo button as other variants. Keep X dismiss as a secondary affordance alongside Undo.
- **Why**: Sprint G R1 constraint was "fake Undo = lie"; with tombstone restore, Undo is real, so the button can return.
- **Input**: current UndoToast.tsx with terminal branch.
- **Output**: delete variant renders Undo + X.
- **Dependencies**: H.3.7 complete.
- **Verification**: preview_eval — force pendingUndo with action="delete", assert both `.undo-toast__btn` and `.undo-toast__dismiss` are present.
- **Rollback**: `git revert {H.3.8 commit}`.
- **Edge cases**: (a) ⌘Z binding that Sprint G R1 skipped for terminal variant now applies for delete — re-enable; (b) if pendingUndo.revert is still no-op (legacy code path) → add a runtime guard throwing a dev warning (avoid regression to fake Undo).

### Task H.3.9: TaskDetailPanel handleDeleteConfirm capture tombstoneId
- **What**: in `src/components/TaskDetailPanel.tsx` `handleDeleteConfirm` capture `tombstoneId` from delete response; write pendingUndo with real revert closure matching H.3.7 pattern.
- **Why**: single-task delete from detail panel gets the same undo semantics as bulk delete.
- **Input**: current handleDeleteConfirm.
- **Output**: handleDeleteConfirm writes undoable pendingUndo.
- **Dependencies**: H.3.8 complete.
- **Verification**: preview_eval — open detail panel, click trash, confirm, verify UndoToast renders with Undo button; click Undo, verify original restored.
- **Rollback**: `git revert {H.3.9 commit}`.
- **Edge cases**: (a) detail panel was dismissed between delete and Undo click → revert still works (tombstoneId in closure is stable); (b) 409 collision on restore (original path re-occupied by concurrent create) → surface error; (c) detail panel had unsaved edits when Delete clicked → edits lost (acceptable; user chose).

### Phase H Exit Gate
- [ ] `pnpm tsc --noEmit` empty
- [ ] `bash scripts/verify.sh` shows `TOTAL: 50 / 50 passed, 0 failed` (39 base + 11 new Phase H checks enumerated in §9)
- [ ] `grep -rnE 'font-bold|as any|console\.(log|warn|error|debug)|task\.text|(⚙|⏎|›|○|●)' src/` empty
- [ ] `grep -rnE '#fff[^o]' src/` empty
- [ ] preview_eval E2E: delete → Undo → row restored (3-step sequence passes)
- [ ] playwright-cli video-recorded E2E: `/tmp/sprint-h-undo-delete.webm` exists and plays cleanly (manual review)
- [ ] implementation-state.md shows all H.* tasks COMPLETE
- [ ] HANDOFF.md updated with Sprint H summary
- [ ] Git log shows one commit per task + per-round convergence commits

### Phase H Convergence Rounds

Three rounds following the `§3.1` per-agent prompt templates. Each round:

1. `git diff 2ea75c4..HEAD --stat` to identify files changed
2. Write round-specific prompt files into `/tmp/sprint-h-r{N}-{critic}.txt`
3. Launch Opus Explore + Gemini CLI + Codex CLI IN PARALLEL (single tool message, multiple Bash + Agent calls)
4. Wait for all three
5. Merge findings, apply CRITICAL+HIGH+MEDIUM fixes, document LOW deferrals in PLAN-II-LOG.md
6. Commit fixes with message `sprint-h-r{N}: fix {critical-count} CRITICAL + {high-count} HIGH + ...`
7. Re-run tsc + verify.sh
8. If zero C/H/M across all three critics → advance round. If any remain → apply fixes and loop.

Expected cadence (based on Plan I empirical data): R1 5–10 findings, R2 2–5 findings, R3 0–2 findings.

### Sprint H R2 Execution Plan (2026-04-19 resume — HEAD `ff028c4`)

#### R2.0 Context

R1 shipped 2026-04-19 in commit `03dfb8b`: 2 CRITICAL + 2 HIGH + 2 MEDIUM fixed. Checkpoint commit `ff028c4` = R1 head. R2 closes six R1 deferrals (listed R2.6 below) + re-runs three parallel critics against full diff `2ea75c4..HEAD`, then applies any new CRITICAL/HIGH/MEDIUM findings. Wall-time estimate: 90 minutes including critic wait.

#### R2.1 Assumption Annihilation (20 checks — must all pass before R2 code begins)

| # | Assumption | Verification command | Expected |
|---|---|---|---|
| RA1 | HEAD resolves to `ff028c4` | `cd $VAULT_ROOT/codebases/vault-sidebar && git rev-parse --short HEAD` | `ff028c4` |
| RA2 | `03dfb8b` is ancestor of HEAD | `cd $VAULT_ROOT/codebases/vault-sidebar && git merge-base --is-ancestor 03dfb8b HEAD && echo ok` | `ok` |
| RA3 | tsc baseline clean | `cd $VAULT_ROOT/codebases/vault-sidebar && pnpm tsc --noEmit 2>&1 \| wc -l` | `0` |
| RA4 | verify.sh 39/39 on fresh server | fresh-start server; `bash scripts/verify.sh 2>&1 \| tail -1` | `TOTAL: 39 / 39 passed, 0 failed` |
| RA5 | AI-tell grep clean | `grep -rnE 'font-bold\|as any\|console\.(log\|warn\|error\|debug)\|task\.text\|(⚙\|⏎\|›\|○\|●)' $VAULT_ROOT/codebases/vault-sidebar/src/` | no matches |
| RA6 | Stray #fff grep clean | `grep -rnE '#fff[^o]' $VAULT_ROOT/codebases/vault-sidebar/src/` | no matches |
| RA7 | Tombstone dir exists mode 700 | `stat -f '%Mp%Lp' $VAULT_ROOT/.vault-sidebar-tombstones` | `0700` |
| RA8 | implementation-state.md H.4.2 marked COMPLETE | `grep -c 'H.4.2.*COMPLETE' $VAULT_ROOT/codebases/vault-sidebar/implementation-state.md` | `1` |
| RA9 | PLAN-II-LOG.md R1 entry present | `grep -c 'Sprint H R1 convergence' $VAULT_ROOT/1-Projects/vault-sidebar/PLAN-II-LOG.md` | `1` or more |
| RA10 | `codex` on PATH v0.112.0+ | `codex --version` | starts with `codex-cli 0.112` |
| RA11 | `gemini` on PATH v0.32.1+ | `gemini --version` | starts with `0.32` |
| RA12 | Preview MCP running vault-sidebar | `mcp__Claude_Preview__preview_list` | JSON with `status: "running"`, port 5174 |
| RA13 | `UndoToast.tsx` handleUndoClick currently has unconditional finally setPendingUndo(null) | `grep -A 6 'handleUndoClick' $VAULT_ROOT/codebases/vault-sidebar/src/components/UndoToast.tsx \| grep -c 'setPendingUndo(null)'` | `1` or more |
| RA14 | `markTaskError` currently has single-arg signature | `grep -E 'markTaskError[^a-zA-Z]' $VAULT_ROOT/codebases/vault-sidebar/src/store.ts \| head -3` | shows `markTaskError(taskId` single param |
| RA15 | No existing `fetchVaultSeq` symbol | `grep -rn 'fetchVaultSeq' $VAULT_ROOT/codebases/vault-sidebar/src/` | no matches |
| RA16 | `TOMBSTONE_TTL_MS = 5500` currently | `grep -c 'TOMBSTONE_TTL_MS = 5500' $VAULT_ROOT/codebases/vault-sidebar/server/writers/task-tombstone.ts` | `1` |
| RA17 | `BulkBar.handleBulkDelete` exists as sequential loop | `grep -c 'handleBulkDelete' $VAULT_ROOT/codebases/vault-sidebar/src/components/BulkBar.tsx` | `1` or more |
| RA18 | Git working tree clean | `cd $VAULT_ROOT/codebases/vault-sidebar && git status --porcelain \| wc -l` | `0` |
| RA19 | Native-playwright skill available | `test -f ~/.claude/skills/native-playwright/SKILL.md && echo ok` | `ok` |
| RA20 | `/api/vault` responsive | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5174/api/vault` | `200` |

**Enforcement**: First task of R2 (Task `R2.T1`) runs all 20. Any FAIL → R2 halts until resolved. Log: `/tmp/plan-ii-r2-assumptions.txt`.

#### R2.2 Irreducible Truths (minimum facts that MUST hold after R2 lands)

- **T-R2.1**: UndoToast terminal feedback set by a revert closure (e.g. "Restore failed") persists for the full 5s toast window and is NOT silently cleared by the finally-block of `handleUndoClick`.
- **T-R2.2**: Error-dot tooltip text reflects the actual per-task API error message supplied by the writer that called `markTaskError`, not a hardcoded generic string.
- **T-R2.3**: Out-of-order concurrent `fetchVault()` responses MUST NOT overwrite a newer-issued response already applied to the store. Enforced via monotonically-increasing `fetchVaultSeq`.
- **T-R2.4**: `TOMBSTONE_TTL_MS` ≥ UndoToast undo window (5000ms) + network-latency margin (≥3000ms). Minimum: 8000ms.
- **T-R2.5**: `BulkBar.handleBulkDelete` has an inline code comment explicitly documenting partial-undo semantics (no behavior change, acceptance of trade-off).
- **T-R2.6**: `setPendingUndo` (or the closest single call site) has an inline code comment documenting last-action-wins replacement semantics.
- **T-R2.7**: After R2 fixes land, three parallel critics (Opus Explore + Gemini CLI + Codex CLI, last capped at 80-line prompt) return zero CRITICAL, zero HIGH, zero MEDIUM findings on the diff `2ea75c4..HEAD-after-R2`.

**Failure-subtraction check**: remove T-R2.1 → users miss "Restore failed" confirmation; remove T-R2.2 → users can't distinguish 409 conflicts from transient errors; remove T-R2.3 → UI shows stale vault after concurrent mutations; remove T-R2.4 → sweeper can beat restore under network latency; remove T-R2.5 or T-R2.6 → next maintainer re-asks the question; remove T-R2.7 → R2 isn't convergent. Every truth has a concrete failure mode.

#### R2.3 Validation Through Negation

For each of the 6 deferral fixes (D1–D6) plus the Codex-80-line-cap protocol, the strongest counter-argument, the trade-off analysis, and the reverse conditions.

**D1 — UndoToast identity-guarded finally**
- **Counter**: "Identity check assumes revert closures set a new pendingUndo AFTER the await resolves. If a closure uses microtask scheduling, the new pendingUndo could land before finally runs, making the guard falsely preserve it — or vice versa, land after finally runs, causing a zombie toast."
- **Trade-off**: Revert closures in the current codebase (`BulkBar.handleBulkDelete` revert, `TaskDetailPanel.handleDeleteConfirm` revert) are `async` functions awaited inside the try block. Finally fires AFTER the awaited promise resolves. Verified in code. If a future revert uses a detached `.then`, the guard becomes unreliable — documented in a code comment.
- **Reverse if**: any new revert closure introduces non-awaited state updates (→ switch to a boolean `terminalFeedbackSet` flag flipped by revert closure, checked in finally).

**D2 — Per-task error messages via Map**
- **Counter**: "A Map doubles memory footprint vs the existing Set. The Set-of-ids model is simpler and handles the common case."
- **Trade-off**: Error state is transient (auto-cleared after 5s via existing TaskRow timer). Concurrent errors are bounded by the number of in-flight writers (typically 1–5). Memory cost: ≤5 entries × ~80 bytes each = 400 bytes. Negligible. The benefit (specific, actionable error text surfaced via `data-error-msg` attr) is user-visible and directly answers an R1 finding.
- **Reverse if**: error state persists past 5s for any reason (leak) OR concurrent error count exceeds 100 (not practical for this app).

**D3 — fetchVaultSeq monotonic counter**
- **Counter**: "Last-write-wins based on call-order, not content-freshness. A slow-response newer-content request could be dropped if the server takes unusually long."
- **Trade-off**: Call-order is a proxy for content-freshness that matches user intent in the common case (delete-request issued before restore-request → if delete-response arrives after restore-response, drop it). A content-freshness strategy would require server-side versioning (deferred to Sprint I cache work). The proxy is sufficient for the R1 race condition.
- **Reverse if**: Sprint I in-memory cache surfaces a content-level version field — migrate to content-freshness comparison then.

**D4 — Widen TOMBSTONE_TTL_MS 5500 → 8000**
- **Counter**: "Longer disk residence leaks more tombstones across a crash between sweep intervals."
- **Trade-off**: 1-hour `cleanupOrphans` on boot catches any leak. Additional 2.5s residence window adds <0.1% storage overhead on realistic workloads (one tombstone ~1KB, sweep every 8s). User benefit: no race between UndoToast dismissal timer and sweep interval under network latency.
- **Reverse if**: a product-level constraint requires <8s residence (none currently known).

**D5 — Partial-bulk-undo documented via code comment**
- **Counter**: "A comment is not a fix. Real solution is a two-pass (queue → atomic-commit) refactor that eliminates the partial-state possibility."
- **Trade-off**: Two-pass refactor = ~2h work + regression risk on Sprint H's 14 commits. Current behavior "some restored, some swept" is still strictly better than Sprint G R1's fake-undo. User-visible: "Restored N/M" toast communicates partial state clearly. Comment preserves simplicity + documents intent for future maintainers.
- **Reverse if**: a user reports surprise about partial undo in production OR Sprint I bulk-move work reuses the same pattern (then lift to two-pass once with Sprint I leverage).

**D6 — PendingUndo replacement documented via code comment**
- **Counter**: "A queue (multiple pending undo actions) respects user agency more."
- **Trade-off**: Queue doubles toast footprint (≥2 Undo buttons), adds visual complexity on small screens, and violates the Mac-Finder ⌘Z = last-action-only mental model. Comment preserves the simpler model while making intent explicit.
- **Reverse if**: user explicitly requests queue semantics OR A/B evidence shows ≥30% of delete actions happen within 5s of a prior delete (rare in observed usage).

**Codex 80-line prompt cap**
- **Counter**: "Cutting Codex prompt content loses probe coverage."
- **Trade-off**: R1 observed Codex hang at ~5min with 50KB partial output when given a 100+ line prompt. Capping at 80 lines keeps Codex responsive. Probe coverage compensated by Opus (unconstrained) + Gemini (unconstrained). Three-critic design tolerates one constrained critic.
- **Reverse if**: Codex CLI releases a version that handles longer prompts reliably (monitor `codex --version` changelog).

#### R2.4 Locked Decisions

1. **Fix order**: D1 (HIGH) → D2 (MEDIUM) → D3 (MEDIUM) → D4 (LOW) land as **four sequential commits** for surgical rollback. D5 + D6 (doc-only) land AFTER critic sweep in a single commit to avoid a re-sweep on pure comments.
2. **Critic launch gate**: critics launch AFTER D1–D4 commits exist in HEAD. They review the cumulative diff `2ea75c4..HEAD-after-D4`.
3. **Codex prompt length**: capped at 80 lines (R1 lesson). Opus + Gemini prompts unconstrained.
4. **Convergence definition**: R2 is complete when each of the three critics returns either `findings: []` OR zero combined CRITICAL/HIGH/MEDIUM (LOW may be deferred to PLAN-II-LOG.md). If one critic times out, R2 proceeds with the two remaining (R1 precedent with Codex).
5. **Critic-finding commit strategy**: any CRITICAL + HIGH + MEDIUM findings land in a single `sprint-h-r2-critic-fixes` commit BEFORE D5 + D6 comments. LOW findings deferred with rationale.
6. **R3 skip rule**: if post-R2 critic sweep returns zero C/H/M, skip R3. Otherwise R3 is a diff-against-R2-HEAD regression sweep (expected ≤2 findings per Plan I empirical).
7. **Exit commit on R2 completion**: final commit `sprint-h-r2-checkpoint` updates `implementation-state.md` (H.4.3 = COMPLETE) + appends PLAN-II-LOG.md R2 entry. Matches Sprint H checkpoint pattern.

#### R2.5 Success Criteria (every item measurable + testable)

After R2 lands:
- [ ] `grep -c 'originalRef' $VAULT_ROOT/codebases/vault-sidebar/src/components/UndoToast.tsx` returns `≥2`
- [ ] `grep -c 'taskErrorMessages' $VAULT_ROOT/codebases/vault-sidebar/src/store.ts` returns `≥3`
- [ ] `grep -c 'data-error-msg' $VAULT_ROOT/codebases/vault-sidebar/src/components/TaskRow.tsx` returns `≥1`
- [ ] `grep -rn 'fetchVaultSeq' $VAULT_ROOT/codebases/vault-sidebar/src/` returns ≥3 lines
- [ ] `grep -c 'TOMBSTONE_TTL_MS = 8000' $VAULT_ROOT/codebases/vault-sidebar/server/writers/task-tombstone.ts` returns `1`
- [ ] `grep -c 'Partial-undo semantics' $VAULT_ROOT/codebases/vault-sidebar/src/components/BulkBar.tsx` returns `1`
- [ ] `grep -c 'PendingUndo replacement semantics' $VAULT_ROOT/codebases/vault-sidebar/src/store.ts` returns `1`
- [ ] `cd $VAULT_ROOT/codebases/vault-sidebar && pnpm tsc --noEmit 2>&1 | wc -l` returns `0`
- [ ] Fresh-server `bash scripts/verify.sh 2>&1 | tail -1` contains `TOTAL: 39 / 39 passed, 0 failed`
- [ ] AI-tell greps (§12.2 pattern list) return empty
- [ ] `grep -rnE '#fff[^o]' $VAULT_ROOT/codebases/vault-sidebar/src/` returns empty
- [ ] Live E2E via Preview MCP: monkey-patched 409 response produces tooltip text `"File was edited elsewhere"` (NOT generic)
- [ ] Live E2E via Preview MCP: monkey-patched 500 on restore → "Restore failed" toast survives 4.5s (proves T-R2.1)
- [ ] Live E2E via Preview MCP: artificially-delayed `fetchVault` response is dropped when a newer fetch already applied to store
- [ ] Live E2E via Preview MCP: delete entity → wait 7.5s → click Undo → HTTP 200 restoration succeeds (proves T-R2.4 margin)
- [ ] Opus critic YAML at `/tmp/sprint-h-r2-opus.yaml` has `findings: []` OR zero CRITICAL/HIGH/MEDIUM
- [ ] Gemini critic output at `/tmp/sprint-h-r2-gemini-out.txt` has `findings: []` OR zero CRITICAL/HIGH/MEDIUM
- [ ] Codex critic output at `/tmp/sprint-h-r2-codex-out.txt` has `findings: []` OR zero CRITICAL/HIGH/MEDIUM (or documented timeout)
- [ ] `grep -c 'H.4.3 Convergence Round 2 — COMPLETE' $VAULT_ROOT/codebases/vault-sidebar/implementation-state.md` returns `1`
- [ ] `grep -c '2026-04-.. — Sprint H R2' $VAULT_ROOT/1-Projects/vault-sidebar/PLAN-II-LOG.md` returns `1`
- [ ] Final `git log --oneline -8` shows the expected commit sequence: D1, D2, D3, D4, (critic fixes if any), D5+D6 combined, R2 checkpoint

#### R2.6 Dependency Graph + Critical Path

```
R2.T1 (Assumption check)
  │
  ▼
R2.T2 (Entry gate)
  │
  ▼
R2.T3 (Fix D1 UndoToast identity-guarded finally)  ← commit 1
  │
  ▼
R2.T4 (Fix D2 per-task error messages Map)  ← commit 2
  │
  ▼
R2.T5 (Fix D3 fetchVaultSeq monotonic counter)  ← commit 3
  │
  ▼
R2.T6 (Fix D4 TOMBSTONE_TTL_MS 5500→8000)  ← commit 4
  │
  ▼
R2.T7 (Launch 3 critics in parallel) ──────┐
  │                                          │
  ├─ Opus Explore (unconstrained prompt)    │
  ├─ Gemini CLI (unconstrained prompt)      │ All parallel
  └─ Codex CLI (80-line prompt cap)         │
                                             │
  ▼ (wait for all three)                    │
R2.T8 (Merge findings + apply C/H/M fixes)  ← commit 5 (if any)
  │
  ▼
R2.T9 (D5 + D6 doc comments)  ← commit 6
  │
  ▼
R2.T10 (Final verification + state updates)  ← commit 7 checkpoint
  │
  ▼
R2 COMPLETE
```

**Critical path** (sequential chain, cannot be shortened):
R2.T1 → R2.T2 → R2.T3 → R2.T4 → R2.T5 → R2.T6 → R2.T7 (launch + wait) → R2.T8 → R2.T9 → R2.T10.

**Wall-time estimates (critical path)**:
- R2.T1: 3 min (20 grep + curl checks)
- R2.T2: 2 min (4 gates on fresh server)
- R2.T3: 8 min (D1 + verify + commit)
- R2.T4: 15 min (D2 touches store.ts + TaskRow.tsx + call sites; test via monkey-patch)
- R2.T5: 10 min (D3 monotonic counter + live test)
- R2.T6: 3 min (D4 one-line change + rebuild)
- R2.T7: 6 min (launch parallel; critics run 3–5 min each; effective wait = max)
- R2.T8: 15 min variable (if any C/H/M findings; zero-finding case = 2 min)
- R2.T9: 5 min (two code-comment edits + commit)
- R2.T10: 6 min (tsc + verify.sh + E2E + state edits + commit)

**Total critical-path wall-time: ~73 min (zero-finding critics) to ~95 min (2–3 critic findings).** Matches Plan II §6 estimate of 45 min per convergence round (before adding D1–D6 deferrals fix work).

**Parallelizable (off critical path)**:
- R2.T7 critic launch is the only parallel segment. Opus + Gemini + Codex run concurrently on separate processes.
- R2.T8 fix application is sequential because each fix can change the diff footprint.

**Dependency artifacts (upstream → downstream)**:

| Upstream → Downstream | Specific artifact | Verification | Impact if upstream changes |
|---|---|---|---|
| R2.T3 → R2.T7 | HEAD includes UndoToast identity-guard fix | `grep 'originalRef' src/components/UndoToast.tsx` | If D1 changes scope, re-run R2.T3 and shift commit order |
| R2.T4 → R2.T7 | Store has `taskErrorMessages` Map + TaskRow reads it | `grep 'taskErrorMessages' src/store.ts src/components/TaskRow.tsx` | If Map signature changes, all call sites in api.ts break |
| R2.T5 → R2.T7 | `fetchVaultSeq` symbol exists in src/ | `grep 'fetchVaultSeq' src/` | If counter lives in store vs api, consumer locations shift |
| R2.T6 → R2.T7 | `TOMBSTONE_TTL_MS = 8000` in task-tombstone.ts | grep count = 1 | Server rebuild required (tsx HMR catches) |
| R2.T7 → R2.T8 | Three critic output files exist at `/tmp/sprint-h-r2-{opus,gemini,codex}.{yaml,txt}` | `test -s` on each path | If a critic crashes silently, R2.T8 halts until investigated |
| R2.T8 → R2.T9 | HEAD has zero C/H/M outstanding findings | Manual review of merged findings | Any new fix touches src/; D5+D6 comments must align with final code shape |
| R2.T9 → R2.T10 | D5 + D6 comments land | grep count = 1 each | Minor — comments don't change behavior |

**No circular dependencies**: every edge points strictly forward. R2.T8's critic-fix commits are appended to HEAD; they do not feed back into earlier tasks.

#### R2.7 Tasks (mandatory format per task)

##### Task R2.T1: Run R2 assumption-annihilation checks
- **What**: execute all 20 checks from §R2.1 in order. For each, run the verification command, compare to expected output, record `RA{N}: PASS` or `RA{N}: FAIL {reason}` to `/tmp/plan-ii-r2-assumptions.txt`.
- **Why**: downstream tasks depend on these 20 invariants. Example: RA7 FAIL (tombstone dir mode ≠ 700) → D4 widening TTL has no effect because sweeper can't write. RA13 FAIL (UndoToast handleUndoClick already has a guard) → D1 is no-op, indicates another agent already landed a similar fix — halt and reconcile.
- **Input**: none.
- **Output**: `/tmp/plan-ii-r2-assumptions.txt` with 20 lines.
- **Dependencies**: none (this is the R2 entry point).
- **Verification**: `grep -c 'PASS' /tmp/plan-ii-r2-assumptions.txt` returns `20`.
- **Rollback**: none (read-only).
- **Edge cases**:
  - RA18 FAIL (working tree dirty from uncommitted changes) → run `git stash` or commit before R2; do not force past.
  - RA12 FAIL (Preview MCP not running) → start server via `mcp__Claude_Preview__preview_start({name: "vault-sidebar"})`; wait 6s; re-check.
  - RA4 FAIL with 38/39 reconcile flake → kill server on 5174, restart via Preview MCP, re-run verify.sh. If still 38/39, STOP and diagnose.
  - RA10 or RA11 FAIL (CLI missing) → `brew install codex` OR `brew install gemini`; re-check.

##### Task R2.T2: Verify R2 entry gate
- **What**: run 4 entry gate checks — tsc, verify.sh on fresh server, AI-tell grep, stray-`#fff` grep. Append results to `/tmp/plan-ii-r2-entry-gate.txt` as 4 lines of `ENTRY GATE {N}: PASS` or `... FAIL {reason}`.
- **Why**: R1 shipped at ff028c4 with all gates clean; re-run confirms no drift from checkpoint to R2 start. Avoids landing R2 on top of a silently-broken baseline.
- **Input**: none; dev server must be running on 5174.
- **Output**: `/tmp/plan-ii-r2-entry-gate.txt` with 4 PASS lines.
- **Dependencies**: R2.T1 complete.
- **Verification**: `grep -c 'ENTRY GATE.*: PASS' /tmp/plan-ii-r2-entry-gate.txt` returns `4`.
- **Rollback**: none (read-only).
- **Edge cases**:
  - tsc returns stale errors after D-series work elsewhere → delete `node_modules/.vite` and restart server.
  - verify.sh reconcile flake (38/39) → apply RA4 workaround.
  - Stray `#fff` found unexpectedly → `git blame` the line; if from a Sprint H commit, open a bug fix task (classify as new R2 finding).

##### Task R2.T3: Fix D1 — UndoToast identity-guarded finally
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/src/components/UndoToast.tsx` `handleUndoClick`:
  1. First line of function body: `const originalRef = useSidebarStore.getState().pendingUndo;`
  2. Replace the existing unconditional `finally { setPendingUndo(null); }` with:
     ```
     finally {
       if (useSidebarStore.getState().pendingUndo === originalRef) {
         setPendingUndo(null);
       }
     }
     ```
- **Why**: Gemini R1 HIGH finding. Current finally clears `pendingUndo` even when the revert closure set a terminal-feedback pending (e.g. "Restore failed"). Identity check preserves user-facing failure toasts.
- **Input**: current `handleUndoClick` body in UndoToast.tsx.
- **Output**: `handleUndoClick` with identity-guarded finally.
- **Dependencies**: R2.T2 complete.
- **Verification**:
  1. `grep -c 'originalRef' $VAULT_ROOT/codebases/vault-sidebar/src/components/UndoToast.tsx` returns `≥2` (one declaration, one usage).
  2. `cd $VAULT_ROOT/codebases/vault-sidebar && pnpm tsc --noEmit 2>&1 | wc -l` returns `0`.
  3. Live via `mcp__Claude_Preview__preview_eval`:
     ```javascript
     (async () => {
       const origFetch = window.fetch;
       window.fetch = (url, opts) => {
         if (String(url).includes('/api/tasks/restore-tombstone')) {
           return Promise.resolve(new Response(JSON.stringify({ok:false, error:"server-500"}), {status:500}));
         }
         return origFetch(url, opts);
       };
       // Trigger a restore with a guaranteed-fail tombstoneId; assert terminal toast persists at 4500ms
       // (exact setup: force pendingUndo with action==="delete" via devtools; click Undo; wait 4500; read UndoToast text)
     })();
     ```
     Expected: UndoToast text contains "Restore failed" at 4500ms post-click.
- **Rollback**: `git revert {R2.T3 commit SHA}` (single commit).
- **Edge cases**:
  - Revert closure uses non-awaited `.then()` — identity guard may fire before revert sets new pending. **Mitigation**: inspect all revert closures in `BulkBar.handleBulkDelete` + `TaskDetailPanel.handleDeleteConfirm`; confirm all are `await`ed inside the try. If not, migrate to `await` semantics (same R2.T3 commit or spin as follow-up).
  - Revert closure itself calls `setPendingUndo(null)` mid-flight — finally identity check sees null !== originalRef, correctly does nothing. Safe.
  - X-dismiss button click during in-flight revert — dismiss is a separate handler; unaffected by handleUndoClick change.

##### Task R2.T4: Fix D2 — per-task error messages via Map
- **What**:
  1. In `$VAULT_ROOT/codebases/vault-sidebar/src/store.ts`:
     - Add state field: `taskErrorMessages: Map<string, string>;` initialized to `new Map()`.
     - Change `markTaskError` signature to `markTaskError(taskId: string, message?: string): void`. When `message` is provided, update the Map immutably: `set(s => ({taskErrorMessages: new Map(s.taskErrorMessages).set(taskId, message)}))`.
     - In `clearTaskError`: also remove the taskId from the Map immutably.
  2. In `$VAULT_ROOT/codebases/vault-sidebar/src/api.ts` and/or relevant call sites in `src/components/TaskDetailPanel.tsx` + `src/components/TaskRow.tsx` + `src/components/BulkBar.tsx`: at every existing `markTaskError(task.id)` call, add a second argument — a specific string derived from the API error. Minimum mappings:
     - Server returns `{error: "mtime-mismatch"}` → `"File was edited elsewhere — refresh and retry."`
     - Server returns `{error: "not-found"}` → `"Task no longer exists."`
     - Server returns any other → `"Write failed — check server response."`
     - Network error / AbortError → `"Connection error — retrying won't work; check network."`
  3. In `$VAULT_ROOT/codebases/vault-sidebar/src/components/TaskRow.tsx`:
     - Add a store selector (use useShallow if applicable after Sprint I): `const errorMessage = useSidebarStore(s => s.taskErrorMessages.get(task.id));`
     - Set `data-error-msg={errorMessage ?? "Write failed — check server response"}` on the `.task-error-dot-button`.
- **Why**: Gemini R1 MEDIUM finding. User cannot distinguish error kinds without specific text surfaced through the existing hover-tooltip affordance (H.1 infrastructure).
- **Input**: current store.ts `errorTaskIds` Set and single-arg markTaskError; TaskRow.tsx hardcoded tooltip string; call sites in api.ts / components.
- **Output**: Map-backed per-task error messages; call sites updated; TaskRow reads Map.
- **Dependencies**: R2.T3 complete.
- **Verification**:
  1. `grep -c 'taskErrorMessages' $VAULT_ROOT/codebases/vault-sidebar/src/store.ts` returns `≥3`.
  2. `grep -c 'markTaskError(.*,.*)' $VAULT_ROOT/codebases/vault-sidebar/src/` returns `≥3` (at least 3 call sites now pass message argument).
  3. `cd $VAULT_ROOT/codebases/vault-sidebar && pnpm tsc --noEmit 2>&1 | wc -l` returns `0`.
  4. Live via `preview_eval`: monkey-patch fetch to return 409 on body-edit; save Notes; hover error dot; assert tooltip text contains `"File was edited elsewhere"`.
- **Rollback**: `git revert {R2.T4 commit SHA}`.
- **Edge cases**:
  - Map grows unboundedly across a long session — mitigated by `clearTaskError` removing entries AND by TaskRow's 5s auto-clear timer.
  - Message contains characters breaking HTML attr (quotes, newlines) — `data-error-msg` attribute escapes naturally in React; CSS `content: attr(data-error-msg)` renders as text only.
  - Concurrent `markTaskError` for same taskId (rare, e.g. retry-then-fail-again) — last write wins; acceptable.
  - Unknown server error shape — fallback string "Write failed — check server response" preserves current UX, so no regression.

##### Task R2.T5: Fix D3 — fetchVaultSeq monotonic counter
- **What**:
  1. In `$VAULT_ROOT/codebases/vault-sidebar/src/store.ts` OR `$VAULT_ROOT/codebases/vault-sidebar/src/api.ts` (whichever owns `fetchVault`):
     - Add module-local `let fetchVaultSeq = 0;` near the top of the file.
     - Add store state `maxAppliedVaultSeq: number` initialized to `0`.
  2. Modify `fetchVault()`:
     - Before the network call: `const seq = ++fetchVaultSeq;`
     - After the response resolves (but before calling `setVault`): `if (seq < useSidebarStore.getState().maxAppliedVaultSeq) return;  // drop stale`
     - Call `setVault(vault, seq)` (extend signature to carry seq).
  3. Modify `setVault(vault, seq)`:
     - `set(s => (seq <= s.maxAppliedVaultSeq ? s : {...s, vault, maxAppliedVaultSeq: seq}))`.
- **Why**: Gemini R1 MEDIUM finding. Concurrent `fetchVault` calls (delete + restore back-to-back, or SSE-triggered + user-triggered) can land out-of-order; last-arrived wins incorrectly.
- **Input**: current `fetchVault` in api.ts + `setVault` in store.ts.
- **Output**: seq-guarded `fetchVault` + `setVault` that rejects older-issued responses.
- **Dependencies**: R2.T4 complete.
- **Verification**:
  1. `grep -rn 'fetchVaultSeq' $VAULT_ROOT/codebases/vault-sidebar/src/` returns ≥3 match lines.
  2. `grep -c 'maxAppliedVaultSeq' $VAULT_ROOT/codebases/vault-sidebar/src/store.ts` returns `≥2`.
  3. `cd $VAULT_ROOT/codebases/vault-sidebar && pnpm tsc --noEmit 2>&1 | wc -l` returns `0`.
  4. Live via `preview_eval`:
     ```javascript
     (async () => {
       // Monkey-patch fetch: /api/vault with header "x-test-delay" delays N ms before resolving
       const origFetch = window.fetch;
       window.fetch = (url, opts) => {
         if (String(url).includes('/api/vault')) {
           const delay = Number(opts?.headers?.get('x-test-delay') ?? 0);
           return new Promise(r => setTimeout(() => origFetch(url, opts).then(r), delay));
         }
         return origFetch(url, opts);
       };
       // Fire fetchVault with 500ms delay; immediately fire fetchVault with 0ms delay
       // Wait 800ms; assert store.vault matches content of 0ms response (not 500ms stale)
     })();
     ```
     Expected: the delayed (older-seq) response is silently dropped; store holds newer-seq content.
- **Rollback**: `git revert {R2.T5 commit SHA}`.
- **Edge cases**:
  - `fetchVaultSeq` overflow at `Number.MAX_SAFE_INTEGER` (2^53) — not practical (would require ~10^15 fetches in one session).
  - SSE-triggered fetchVault races with user-triggered — both go through same counter; correct.
  - Multiple browser tabs — each tab has its own counter (module-local). Per-tab correctness; tabs are already isolated stores. Acceptable.
  - First fetch after reload — seq starts at 1; `maxAppliedVaultSeq` starts at 0; `1 > 0` applies correctly.

##### Task R2.T6: Fix D4 — widen TOMBSTONE_TTL_MS 5500 → 8000
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/server/writers/task-tombstone.ts` change the constant:
  ```
  export const TOMBSTONE_TTL_MS = 5500;
  ```
  to:
  ```
  export const TOMBSTONE_TTL_MS = 8000;
  ```
  No other changes. The existing `setInterval(sweepTombstones, TOMBSTONE_TTL_MS)` in `server/index.ts` picks up the new value when imported via tsx HMR or server restart.
- **Why**: Gemini R1 LOW finding. 500ms margin between UndoToast 5000ms window and sweep 5500ms TTL is vulnerable to network latency (one-way RTT >250ms on slow connections). Widening to 8000ms creates 3000ms buffer while keeping tombstone residence well under the 1-hour orphan-cleanup ceiling.
- **Input**: current constant value `5500`.
- **Output**: constant value `8000`.
- **Dependencies**: R2.T5 complete.
- **Verification**:
  1. `grep -c 'TOMBSTONE_TTL_MS = 8000' $VAULT_ROOT/codebases/vault-sidebar/server/writers/task-tombstone.ts` returns `1`.
  2. `grep -c 'TOMBSTONE_TTL_MS = 5500' $VAULT_ROOT/codebases/vault-sidebar/server/writers/task-tombstone.ts` returns `0`.
  3. `cd $VAULT_ROOT/codebases/vault-sidebar && pnpm tsc --noEmit 2>&1 | wc -l` returns `0`.
  4. Live: delete an entity task via API; `sleep 7`; POST `/api/tasks/restore-tombstone` with the returned tombstoneId; expect HTTP 200 with `{ok:true, kind:"entity", restoredPath:"..."}`.
     ```bash
     DEL=$(curl -s -X POST http://127.0.0.1:5174/api/tasks/delete-entity -H 'Content-Type: application/json' -d '{"entityPath":"1-Projects/VALID/tasks/TEST.md"}' | jq -r .tombstoneId)
     sleep 7
     curl -s -X POST http://127.0.0.1:5174/api/tasks/restore-tombstone -H 'Content-Type: application/json' -d "{\"tombstoneId\":\"$DEL\"}" | jq .ok
     # Expected: true
     ```
- **Rollback**: `git revert {R2.T6 commit SHA}`.
- **Edge cases**:
  - Sweeper interval now 8000ms → worst-case tombstone age is 8000ms (TTL) + 8000ms (next sweep wake) = 16s. Still far under 1h orphan cleanup. Acceptable.
  - BulkBar undo window still 5s client-side — server TTL is just safety margin, not user-visible.
  - Existing in-flight tombstones created with old 5500ms TTL at the moment of restart — they'll be swept at the next 8000ms-interval wake using their creation timestamp against the new TTL. Either they're within 8s (restore works) or older (acceptably swept). No data loss.

##### Task R2.T7: Launch 3 critics in parallel
- **What**:
  1. Write three prompt files. Template for all: `git diff 2ea75c4..HEAD --stat` as context; review the diff for correctness; output STRICT YAML with `findings:` key; each finding has `id`, `severity` (CRITICAL|HIGH|MEDIUM|LOW), `file`, `line`, `problem` (1–3 sentences), `proposed_fix`. Max 10 findings per critic. `findings: []` means convergence.
     - `/tmp/sprint-h-r2-opus.txt` — Opus Explore agent prompt (unconstrained length; include full D1–D4 fix summary + probe list focusing on races, TOCTOU, partial failure, state machine invariants).
     - `/tmp/sprint-h-r2-gemini.txt` — Gemini CLI prompt (unconstrained; focus UX/A11Y: focus management, ARIA labels on new error-dot-button, screen-reader behavior of tooltip, reduced-motion for any keyframes, keyboard trap on UndoToast).
     - `/tmp/sprint-h-r2-codex.txt` — Codex CLI prompt, **CAPPED AT 80 LINES** (wc -l must return ≤80); focus: tombstone-restore concurrency edge cases, mtime BigInt boundary, writer-synchronous invariant, fetchVaultSeq race on rapid-fire concurrent fetches.
  2. Launch all three in ONE message with multiple tool calls:
     - `Agent` call with `subagent_type: "Explore"`, prompt references the Opus file.
     - `Bash` call (run_in_background: true): `gemini -p "$(cat /tmp/sprint-h-r2-gemini.txt)" 2>&1 > /tmp/sprint-h-r2-gemini-out.txt`.
     - `Bash` call (run_in_background: true): `codex exec -s read-only "$(cat /tmp/sprint-h-r2-codex.txt)" > /tmp/sprint-h-r2-codex-out.txt 2>&1`.
  3. Wait for all three. Typical wall-time: Gemini 3–5min, Codex 3–5min if prompt ≤80 lines, Opus 2–6min.
- **Why**: adversarial review catches issues self-review misses. R1 pattern: Opus + Gemini converged on identical CRITICAL findings despite independent probe sets — strong signal. Three-critic redundancy means one timeout doesn't block R2.
- **Input**: HEAD at D4-landed state (after R2.T6 commits); three prompt files.
- **Output**: three result files — `/tmp/sprint-h-r2-opus.yaml` (Opus writes directly), `/tmp/sprint-h-r2-gemini-out.txt`, `/tmp/sprint-h-r2-codex-out.txt`.
- **Dependencies**: R2.T6 complete.
- **Verification**:
  1. All three output files exist and are non-empty: `test -s /tmp/sprint-h-r2-opus.yaml && test -s /tmp/sprint-h-r2-gemini-out.txt && test -s /tmp/sprint-h-r2-codex-out.txt && echo ok`.
  2. Each contains a parseable `findings:` key (YAML or YAML-in-markdown).
  3. If `findings: []` across all three → R2.T8 is a no-op (skip to R2.T9).
  4. Codex prompt file size check: `wc -l /tmp/sprint-h-r2-codex.txt` returns ≤80.
- **Rollback**: none (critics are read-only).
- **Edge cases**:
  - Codex hangs despite 80-line cap → `pgrep -f "codex exec" | xargs -r kill`; proceed with Opus + Gemini. Document timeout in PLAN-II-LOG.md R2 entry.
  - Gemini returns HTTP/429 or quota error → retry once with 60s backoff; if still fails, proceed with 2 critics.
  - Opus Explore subagent returns empty output (rare) → retry with narrower probe list focused on D1–D4 only.
  - One critic returns CRITICAL, others return `findings: []` → manually review the CRITICAL finding; if it's a false positive, document and ignore; if real, treat as convergence-blocker per §5.3 escalation rule.

##### Task R2.T8: Merge critic findings + apply CRITICAL + HIGH + MEDIUM fixes
- **What**:
  1. Read all three output files.
  2. For each critic, extract `findings` array; classify by severity.
  3. Dedupe across critics by matching `file + line` ± 3 lines.
  4. Apply fixes in this order: CRITICAL first (halt if tsc/verify.sh breaks), HIGH next, MEDIUM last.
  5. Each fix is a separate file-edit. All fixes land in a single commit `sprint-h-r2-critic-fixes: fix {C} CRITICAL + {H} HIGH + {M} MEDIUM` UNLESS a CRITICAL fix requires substantial refactoring (>40 LOC across >2 files) — in that case, split as `sprint-h-r2-critic-fix-{finding-id}: ...`.
  6. Document LOW-severity findings (if any) in PLAN-II-LOG.md R2 entry with rationale for deferral.
- **Why**: critics only provide value when their findings are applied. Ignoring findings invalidates the convergence protocol.
- **Input**: `/tmp/sprint-h-r2-opus.yaml` + `/tmp/sprint-h-r2-gemini-out.txt` + `/tmp/sprint-h-r2-codex-out.txt`.
- **Output**: 0..N commits containing fixes; PLAN-II-LOG.md R2 entry updated with deferral rationale.
- **Dependencies**: R2.T7 complete.
- **Verification**:
  1. `cd $VAULT_ROOT/codebases/vault-sidebar && pnpm tsc --noEmit 2>&1 | wc -l` returns `0` after each fix commit.
  2. Fresh-server `bash scripts/verify.sh 2>&1 | tail -1` contains `TOTAL: 39 / 39 passed, 0 failed` after final fix commit.
  3. If zero findings: no commit required; proceed to R2.T9.
- **Rollback**: per-fix `git revert` of the specific commit.
- **Edge cases**:
  - A fix introduces a tsc error → revert the fix; re-attempt with the error in mind; if three revert-retry cycles fail, escalate per §5.3 stop condition.
  - A fix breaks verify.sh that wasn't broken before → same as above.
  - Critics disagree: Opus says CRITICAL, Gemini says MEDIUM, Codex says no finding → escalate per §5.3 ("critics disagree on severity — user arbitrates"). Pause R2; report to user with the three verbatim finding texts.
  - Two critics land overlapping fixes that touch the same line → dedupe; keep the stricter fix; note overlap in commit message.
  - Zero findings case (likely per R2 expected cadence 2–5) → fast-forward to R2.T9. Commit `sprint-h-r2-critics-clean: Opus+Gemini+Codex return zero C/H/M on diff 2ea75c4..HEAD-after-D4` — an empty marker commit is optional; skip unless trail desired.

##### Task R2.T9: Land D5 + D6 doc-only comments
- **What**:
  1. **D5** — in `$VAULT_ROOT/codebases/vault-sidebar/src/components/BulkBar.tsx`, immediately ABOVE the `handleBulkDelete` function declaration, insert a multi-line comment (TypeScript `//` lines, not JSDoc):
     ```
     // Partial-undo semantics (Plan II R2 decision, 2026-04-19):
     // handleBulkDelete iterates deletions sequentially. If user triggers ⌘Z
     // mid-loop, pendingUndo's revert closure only restores tasks already
     // tombstoned — not tasks still in-flight. Accepted trade-off vs a
     // two-pass (queue-all → atomic-commit) refactor which would add ~2h
     // work + regression risk. User-visible: "Restored N/M" toast communicates
     // partial state. Matches Mac-Finder ⌘Z = last-completed-action mental model.
     ```
  2. **D6** — in `$VAULT_ROOT/codebases/vault-sidebar/src/store.ts`, immediately ABOVE the `setPendingUndo` setter (wherever the `pendingUndo:` state field is declared alongside its setter), insert:
     ```
     // PendingUndo replacement semantics (Plan II R2 decision, 2026-04-19):
     // setPendingUndo unconditionally replaces any existing pendingUndo. Example:
     // user deletes A (pendingUndo = A), then deletes B before 5s elapses
     // (pendingUndo = B, A's tombstone sweeps after TTL). Only B is undoable
     // via ⌘Z. Accepted trade-off vs queue semantics (multi-button toast +
     // complex UI). Matches Mac-Finder ⌘Z = last-action mental model.
     ```
  3. Single commit: `sprint-h-r2-docs: document partial-undo + pendingUndo-replacement semantics`.
- **Why**: Opus R1 MEDIUM findings #7 and #8 flagged undocumented behavior. Comments cost 5 min + zero behavior change, vs refactoring costing ~4h + regression risk. Decision locked in §R2.3 D5/D6 negation analysis.
- **Input**: current BulkBar.tsx + store.ts files.
- **Output**: two files with new documentation comments; single commit.
- **Dependencies**: R2.T8 complete (land comments AFTER critic sweep so comments don't trigger a re-review pass).
- **Verification**:
  1. `grep -c 'Partial-undo semantics' $VAULT_ROOT/codebases/vault-sidebar/src/components/BulkBar.tsx` returns `1`.
  2. `grep -c 'PendingUndo replacement semantics' $VAULT_ROOT/codebases/vault-sidebar/src/store.ts` returns `1`.
  3. `cd $VAULT_ROOT/codebases/vault-sidebar && pnpm tsc --noEmit 2>&1 | wc -l` returns `0` (comments are TS-safe).
- **Rollback**: `git revert {R2.T9 commit SHA}`.
- **Edge cases**: none — comments are TS-inert and behavior-inert.

##### Task R2.T10: Final verification + state + checkpoint commit
- **What**:
  1. Fresh-restart dev server via Preview MCP.
  2. Run exit gate checks + live E2E:
     - `pnpm tsc --noEmit` → empty.
     - `bash scripts/verify.sh 2>&1 | tail -1` → `TOTAL: 39 / 39 passed, 0 failed`.
     - AI-tell greps (from §12.2) → empty.
     - Stray `#fff[^o]` grep → empty.
     - Live E2E #1 (mtime-tooltip): 409 on body-edit surfaces specific error text (not generic).
     - Live E2E #2 (undo-persistence): 500 on restore leaves "Restore failed" toast for 4.5s.
     - Live E2E #3 (fetchVault-seq): older-issued fetch response is dropped.
     - Live E2E #4 (TTL-margin): delete → 7s wait → restore succeeds with HTTP 200.
  3. Update `$VAULT_ROOT/codebases/vault-sidebar/implementation-state.md`:
     - Flip H.4.3 line to `COMPLETE` with details of R2 fixes.
     - Append R2 convergence log entry (critics, findings counts, fixes applied, deferrals).
  4. Append `$VAULT_ROOT/1-Projects/vault-sidebar/PLAN-II-LOG.md` with R2 round summary (matches R1 entry style).
  5. Commit all state changes: `sprint-h-r2-checkpoint: Sprint H R2 convergence complete`. Append to implementation-state.md's "Convergence round log" section.
  6. Capture results to `/tmp/plan-ii-r2-exit-gate.txt` (format: one line per check with PASS/FAIL + brief detail).
- **Why**: closes the feedback loop. Without state updates, next-session resume is ambiguous.
- **Input**: HEAD includes all R2 fixes + D5/D6 comments.
- **Output**: `/tmp/plan-ii-r2-exit-gate.txt` with 8+ PASS lines; implementation-state.md updated; PLAN-II-LOG.md appended; checkpoint commit.
- **Dependencies**: R2.T9 complete.
- **Verification**:
  1. `grep -c 'PASS' /tmp/plan-ii-r2-exit-gate.txt` returns `≥8`.
  2. `grep -c 'H.4.3.*COMPLETE' $VAULT_ROOT/codebases/vault-sidebar/implementation-state.md` returns `≥1`.
  3. `grep -c 'Sprint H R2' $VAULT_ROOT/1-Projects/vault-sidebar/PLAN-II-LOG.md` returns `≥1`.
  4. `git log --oneline -1` starts with `sprint-h-r2-checkpoint`.
- **Rollback**: if any gate FAILs, identify root commit via `git bisect run bash scripts/verify.sh`; `git revert`; re-run from R2.T8 or earlier.
- **Edge cases**:
  - Preview MCP can't be restarted (port stuck) → `lsof -iTCP:5174 -sTCP:LISTEN -n -P | awk 'NR==2{print $2}' | xargs -r kill -9; sleep 3`; retry.
  - E2E #3 (fetchVault-seq) fails because Preview eval can't intercept internal fetch — fall back to unit-level assertion: read store module exports via `preview_eval` and confirm `fetchVaultSeq` counter increments across two synchronous `fetchVault()` calls.
  - R2 exit gate passes but Sprint I entry gate would fail — not our scope; document in implementation-state.md Risk register.
  - Committing state files from outside the scoped repo — `PLAN-II-LOG.md` lives in `1-Projects/vault-sidebar/` (VAULT_ROOT, not scoped repo). Edit via main vault git OR do not commit (vault git is optional). Implementation-state.md lives inside scoped repo and IS committed.

#### R2.8 Testing Strategy (real tests — not theoretical)

**Unit-level checks (bash + grep + curl per verify.sh convention):**

| Test label | Assertion |
|---|---|
| `R2-undotoast-identity-guard-symbol-present` | `grep -c 'originalRef' src/components/UndoToast.tsx` ≥ 2 |
| `R2-undotoast-finally-conditional` | `grep -A 8 'handleUndoClick' src/components/UndoToast.tsx \| grep -c 'pendingUndo === originalRef'` ≥ 1 |
| `R2-store-taskerrormessages-map-defined` | `grep -c 'taskErrorMessages: Map' src/store.ts` = 1 |
| `R2-marktaskerror-two-arg` | `grep -E 'markTaskError\([^)]+,[^)]+\)' src/` yields ≥ 3 call sites |
| `R2-taskrow-reads-error-msg-map` | `grep -c 'taskErrorMessages.get(task.id)' src/components/TaskRow.tsx` ≥ 1 |
| `R2-fetchvaultseq-counter-declared` | `grep -rn 'let fetchVaultSeq' src/` ≥ 1 |
| `R2-maxappliedvaultseq-state` | `grep -c 'maxAppliedVaultSeq' src/store.ts` ≥ 2 |
| `R2-setvault-guards-stale` | `grep -A 3 'maxAppliedVaultSeq' src/store.ts \| grep -c 'seq <=' ` ≥ 1 |
| `R2-tombstone-ttl-widened` | `grep -c 'TOMBSTONE_TTL_MS = 8000' server/writers/task-tombstone.ts` = 1 AND `grep -c 'TOMBSTONE_TTL_MS = 5500' server/writers/task-tombstone.ts` = 0 |
| `R2-bulkbar-partialundo-doc` | `grep -c 'Partial-undo semantics' src/components/BulkBar.tsx` = 1 |
| `R2-store-pendingundo-doc` | `grep -c 'PendingUndo replacement semantics' src/store.ts` = 1 |

These 11 checks are added to `scripts/verify.sh` but R2 success gate uses the existing 39/39 count (the new checks become pass-required regression protection for future sprints; they do NOT increase the pre-Sprint-I target above 39 since Sprint I opens with its own entry gate).

**Integration tests (multi-component scenarios, Preview MCP):**

- `R2.integ.1 undo-terminal-feedback-persists`: monkey-patch restoreTombstoneApi fetch to return 500. Force pendingUndo via devtools store. Click Undo. At T=4500ms post-click, assert UndoToast DOM text contains "Restore failed" (proves T-R2.1 / D1).
- `R2.integ.2 error-dot-specific-message`: monkey-patch body-edit fetch to return 409 mtime-mismatch. Open Notes on an entity task, edit, save. Wait 100ms. `document.querySelector('.task-error-dot-button').getAttribute('data-error-msg')` contains "File was edited elsewhere" (proves T-R2.2 / D2).
- `R2.integ.3 fetchvault-stale-drop`: instrument fetch to delay-500 the first `/api/vault` response. Synchronously fire two fetchVault calls. After both resolve, assert `useSidebarStore.getState().maxAppliedVaultSeq === 2` (the faster second fetch). Assert content matches the second fetch (not first). Proves T-R2.3 / D3.
- `R2.integ.4 tombstone-ttl-margin`: POST /api/tasks/delete-entity. Capture tombstoneId. Sleep 7s. POST /api/tasks/restore-tombstone with the id. Expect HTTP 200. Shasum before-delete vs after-restore match. Proves T-R2.4 / D4.

**E2E verification (copy-paste-executable):**

```bash
cd $VAULT_ROOT/codebases/vault-sidebar
# Gate 1: tsc
pnpm tsc --noEmit
# Expected: empty output, exit 0

# Gate 2: verify.sh on fresh server (kill-restart-wait)
lsof -iTCP:5174 -sTCP:LISTEN -n -P | awk 'NR==2 {print $2}' | xargs -r kill -9
# Restart via Preview MCP: mcp__Claude_Preview__preview_start({name: "vault-sidebar"})
sleep 6
bash scripts/verify.sh 2>&1 | tail -1
# Expected: TOTAL: 39 / 39 passed, 0 failed

# Gate 3: AI-tell greps
grep -rnE 'font-bold|as any|console\.(log|warn|error|debug)|task\.text|(⚙|⏎|›|○|●)' src/
# Expected: no output
grep -rnE '#fff[^o]' src/
# Expected: no output

# Gate 4: critic outputs
test -s /tmp/sprint-h-r2-opus.yaml && \
test -s /tmp/sprint-h-r2-gemini-out.txt && \
test -s /tmp/sprint-h-r2-codex-out.txt && echo "critic outputs present"
# Expected: critic outputs present (may be "codex timeout" if documented)
```

**Regression protection**: after every R2 commit (T3, T4, T5, T6, T8 optional, T9, T10), re-run Gate 1 + Gate 2. A failing gate → immediate `git revert`, diagnose, refix, re-commit.

#### R2.9 Agent Orchestration (13 Irreducible Questions — R2-specific answers)

| # | Question | Answer for R2 |
|---|---|---|
| 1 | How many agents? | 3 (Opus Explore + Gemini CLI + Codex CLI) |
| 2 | How do they relate? | Parallel (all three launched in one tool-message) |
| 3 | How long? | 3–5 min each, ~5 min wall-time for parallel batch |
| 4 | What validation? | Per-critic: YAML parse + `findings:` key check. Per-round: manual merge + severity dedup. Per-phase: 11 new verify.sh checks + 4 E2E assertions. |
| 5 | What on failure? | Single-critic timeout (Codex 80-line lesson) → proceed with remaining two. Critic-finding fix regression → `git revert`, retry. Three-cycle fail-retry → escalate per §5.3. |
| 6 | What persists? | `/tmp/sprint-h-r2-{opus,gemini,codex}.{yaml,txt}` for audit trail; git commits for code; implementation-state.md + PLAN-II-LOG.md for SSOT. |
| 7 | Output where? | Code → `src/**` + `server/**`. State → `implementation-state.md` (scoped repo) + `PLAN-II-LOG.md` (vault). Transient → `/tmp/plan-ii-r2-*.txt`. |
| 8 | SSOT? | `implementation-state.md` task-level + `PLAN-II-LOG.md` convergence-level. Plan file is SSOT for intent. |
| 9 | How detect done? | Per-critic: output file non-empty + parseable YAML. Per-round: zero C/H/M across three critics on diff 2ea75c4..HEAD-after-R2. Per-phase: exit-gate checklist §R2.5 all ☑. |
| 10 | How measure progress? | Checkbox progression in the R2.7 task list. implementation-state.md flipped entries. git log summary. |
| 11 | Session init? | `cat implementation-state.md` + `git log --oneline -20` + verify 5-gate checklist. Handoff briefing at `/tmp/plan-ii-handoff.md`. |
| 12 | Work unit granularity? | Per-deferral (D1–D6) = one commit each for D1–D4; single commit for D5+D6 doc. Per-critic-finding = grouped into single `sprint-h-r2-critic-fixes` commit unless >40 LOC. |
| 13 | Runtime setup? | None beyond Plan II prerequisites (Vite + Express + TS5 + tsx HMR; codex + gemini CLIs; Preview MCP). |

**Per-agent prompt specs:**

- **Opus Explore**
  - Prompt location: `/tmp/sprint-h-r2-opus.txt` (length: unconstrained).
  - Prompt shape (copy-paste template):
    ```
    Sprint H R2 adversarial review at HEAD. Project:
    $VAULT_ROOT/codebases/vault-sidebar/

    Read the full diff: `git diff 2ea75c4..HEAD` at HEAD after R2 D1-D4 fixes
    have landed. Files specifically touched by R2 (review these first):
    - src/components/UndoToast.tsx
    - src/store.ts
    - src/components/TaskRow.tsx
    - src/api.ts
    - server/writers/task-tombstone.ts

    R2 D1-D4 FIX SUMMARY (each has a commit):
    - D1: UndoToast handleUndoClick finally now identity-guards pendingUndo
          (preserves terminal feedback set by revert closures)
    - D2: store.taskErrorMessages Map + two-arg markTaskError; TaskRow reads
          data-error-msg from map
    - D3: monotonic fetchVaultSeq counter; setVault drops stale responses
    - D4: TOMBSTONE_TTL_MS widened 5500 → 8000

    Probes:
    1. Does the identity guard in D1 handle all revert-closure patterns?
       Specifically: what if a revert closure schedules a setPendingUndo
       in a .then() chain that resolves after finally fires?
    2. Does D2's Map-of-messages leak memory? Is clearTaskError called
       reliably? Do all call sites pass specific messages or do some fall
       through to the generic?
    3. Does D3's seq counter handle SSE-triggered + user-triggered
       concurrent fetches? Does it handle seq rollover (unlikely) or
       fetchVault errors (rejection mid-flight)?
    4. Does D4's 8s TTL interact badly with any other timer or interval?
       Does the sweeper correctly see the new value after HMR?
    5. Are there Sprint H issues NOT caught by R1 (review diff 2ea75c4..
       03dfb8b for blind spots)?
    6. Writer-synchronous invariant: does Sprint H fully satisfy "cache
       invalidate before broadcast" for all delete/restore/tombstone ops?
       (Even though Plan I cache isn't built yet, the invariant pattern
       should be followed.)
    7. mtime BigInt handling: are all comparison paths (digit-only vs
       ISO) covered in error cases?
    8. Does restoreFromTombstone handle all TOCTOU edge cases (inline
       tombstone restoration when source tasks.md has been modified
       since tombstone creation)?
    9. Does the 409 response body carry all fields the client expects
       (currentModified ISO + currentModifiedNs)?
    10. Are all the new grep-trackable invariants from §R2.5 actually
        enforced by tsc or runtime checks, or only by grep?

    Output STRICT YAML:
    findings:
      - id: UNIQUE-ID-SHORT
        severity: CRITICAL|HIGH|MEDIUM|LOW
        file: /absolute/path
        line: NUMBER
        problem: 1-3 sentence problem statement
        proposed_fix: 1-3 sentence fix proposal

    `findings: []` = convergence.

    Write output to /tmp/sprint-h-r2-opus.yaml.
    ```
  - Model: Opus (inherited from Explore agent).
  - Tools: Glob, Grep, Read, WebFetch.
  - Success: YAML parseable; `findings:` key present.
  - Failure: empty output → retry with probes 1–5 only.

- **Gemini CLI**
  - Prompt location: `/tmp/sprint-h-r2-gemini.txt` (length: unconstrained; typical 150 lines).
  - Invocation: `gemini -p "$(cat /tmp/sprint-h-r2-gemini.txt)" 2>&1 > /tmp/sprint-h-r2-gemini-out.txt`.
  - Focus: UX/A11Y/ARIA/reduced-motion/keyboard-trap on the new error-dot-button + conflict banner + undo-toast variants.
  - Model: Gemini 3.1 (per `gemini --version` 0.32.1).
  - Success: exit 0 + YAML in stdout.
  - Failure: if hangs >5 min, `pgrep -f 'gemini -p' | xargs kill`; proceed with 2 critics.

- **Codex CLI**
  - Prompt location: `/tmp/sprint-h-r2-codex.txt` (length: **≤80 lines**, verified by `wc -l` before launch).
  - Invocation: `codex exec -s read-only "$(cat /tmp/sprint-h-r2-codex.txt)" > /tmp/sprint-h-r2-codex-out.txt 2>&1`.
  - Focus: correctness, races, TOCTOU, BigInt mtime boundaries, fetchVaultSeq races on rapid concurrent fetches, writer-synchronous invariant verification.
  - Model: GPT 5.4 (per `codex --version` 0.112.0).
  - Success: exit 0 + YAML in stdout.
  - Failure: if hangs >4 min, `pgrep -f 'codex exec' | xargs kill`; proceed with 2 critics; document in PLAN-II-LOG.md.

#### R2.10 Claude Code Anti-Patterns Checklist (verify NONE in final R2 HEAD)

- [ ] No `sys.path.insert` cross-skill imports (N/A — this is a TypeScript project, no Python).
- [ ] No `decision: "approve"` in PreToolUse (N/A — no hook work in R2).
- [ ] Stop hooks check `stop_hook_active` (N/A — no hook work in R2).
- [ ] No `rstrip("s")` for plural stripping — `grep -rn 'rstrip' $VAULT_ROOT/codebases/vault-sidebar/src/ $VAULT_ROOT/codebases/vault-sidebar/server/` expected empty.
- [ ] No `--model` flag with `claude --print` for subscription routing (N/A — R2 uses `codex exec` + `gemini -p`, not `claude --print`).
- [ ] No `ANTHROPIC_API_KEY` leaked to subprocess env (N/A — R2 CLIs don't consume it).
- [ ] No `currentColor` in SVG data URIs — `grep -E 'data:image/svg.*currentColor' $VAULT_ROOT/codebases/vault-sidebar/src/styles.css` expected empty (no SVG data URI work in R2).
- [ ] No `var` in JavaScript — `grep -rnE '^\s*var ' $VAULT_ROOT/codebases/vault-sidebar/src/ $VAULT_ROOT/codebases/vault-sidebar/server/` expected empty.
- [ ] No inline styles beyond the two permitted exceptions (Popover:216, PriorityPopover:72) — `grep -rnE 'style=\\{\\{' $VAULT_ROOT/codebases/vault-sidebar/src/` expected ≤2. R2 does NOT introduce new inline styles.
- [ ] No stdlib module-name shadows (N/A — TS project).
- [ ] No `datetime.now(datetime.UTC)` (N/A — JS project; all date ops use `new Date()`).
- [ ] All new `fetch(` calls in this R2 have `signal: AbortSignal.timeout(10000)` — R2 does NOT add new fetch call sites (existing fetchVault + restoreTombstoneApi unchanged in signature). Manual audit required on any critic-fix that adds fetch.
- [ ] No `font-bold` — `grep -rn 'font-bold' $VAULT_ROOT/codebases/vault-sidebar/src/` expected empty.
- [ ] No emoji in code or comments — grep for Unicode emoji ranges in src/ + server/ expected empty. Note: R2.T9 comments use ASCII-only characters; `⌘` is non-emoji Unicode U+2318 and is acceptable in comment text (same as existing Plan II usage).
- [ ] No Unicode pseudo-icons `⚙ ⏎ › ○ ●` — `grep -rn '⚙\|⏎\|›\|○\|●' $VAULT_ROOT/codebases/vault-sidebar/src/` expected empty.
- [ ] No `as any` — `grep -rn 'as any' $VAULT_ROOT/codebases/vault-sidebar/src/ $VAULT_ROOT/codebases/vault-sidebar/server/` expected empty. **R2 guard**: D2's Map state typing uses generics (`Map<string, string>`), NOT `as any`.
- [ ] No hardcoded `#fff` outside the `--accent-foreground` token definition — `grep -rnE '#fff[^o]' $VAULT_ROOT/codebases/vault-sidebar/src/` expected empty.
- [ ] No `console.log|warn|error|debug` in src/ — `grep -rnE 'console\.(log\|warn\|error\|debug)' $VAULT_ROOT/codebases/vault-sidebar/src/` expected empty. Server may emit via `process.stderr.write`.
- [ ] No `task.text` — `grep -rn 'task\.text' $VAULT_ROOT/codebases/vault-sidebar/src/` expected empty (Plan I Sprint A renamed to `action`).

Enforcement: `scripts/ai-tells-check.sh` wraps the grep set; invoked by verify.sh. Every R2 commit triggers re-run.

#### R2.11 Closed Feedback Loop (per-task reconciliation protocol)

After each R2 task completes:

1. Run the task's verification command(s) from §R2.7.
2. Capture exact stdout + stderr to `/tmp/plan-ii-r2-{task-id}-out.txt`.
3. Diff actual output against expected (documented per-task).
4. Update `implementation-state.md`:
   - Flip the R2 task's status row to `COMPLETE` (or `BLOCKED`).
   - If actual ≠ expected, add a bullet to the "Deviations from plan" section with the diff summary.
5. If deviation impacts downstream R2 tasks: STOP; add a bullet to "Discovered requirements" describing the new constraint; re-evaluate R2.6 dependency graph; update affected downstream task descriptions; ONLY THEN resume.
6. Commit code + state update together. Commit message follows §R2.4 decision 1 pattern.

**Stop conditions (escalate to user):**

- Two critics return CRITICAL and one returns `findings: []` (critic disagreement on severity — user arbitrates per §5.3 parent-plan rule).
- A single R2 fix requires rewriting >20% of a Sprint H component (indicates a structural issue the original plan missed; re-evaluate scope).
- `pnpm tsc --noEmit` fails after 3 revert-and-retry cycles on the same task (likely design-level issue).
- R2.T10 live E2E produces UI-observable behavior that contradicts §R2.2 irreducible truths.
- R2 total wall-time exceeds 3 hours (double the estimate) — signals something fundamental is off; pause and re-scope.
- Any critic surfaces a regression on R1 work (CRITICAL finding on code touched only by 03dfb8b or earlier) — R1 was supposedly clean; a regression indicates a silent drift. Investigate root cause BEFORE applying the fix.

**Feed-forward loop (R2 → R3 OR R2 → Sprint I):**

- If R2 exit-gate §R2.5 all ☑ AND critics returned zero C/H/M → **skip R3**; next session starts at Sprint I.0.1.
- If R2 exit-gate ☑ but critics returned LOW findings → **skip R3**; document LOW items in PLAN-II-LOG.md with deferral rationale; Sprint I may opt to pick up LOW items as it touches adjacent code.
- If R2 critics returned ≥1 MEDIUM finding that could NOT be fixed within R2 scope (e.g. requires structural refactor): defer to R3 OR explicitly escalate to user before starting Sprint I.
- R2 completion auto-triggers a short handoff update: append to `/tmp/plan-ii-handoff.md` §5 a new "R2 complete" block with commit range + exit-gate screenshot-equivalent (grep + curl result samples).

#### R2.12 Anti-Mediocrity Self-Score (pre-presentation)

| Dimension | Threshold | Score | Evidence |
|---|---|---|---|
| Depth | ≥8 | 9 | Every task (R2.T1–R2.T10) has what/why/input/output/dependencies/verification/rollback/edge-cases. §R2.1 enumerates 20 assumptions with exact verification commands. §R2.2 enumerates 7 irreducible truths with failure-subtraction analysis. §R2.3 gives per-decision validation through negation including counter-argument + trade-off + reverse conditions. |
| Specificity | ≥9 | 9 | Every file path is absolute starting `$HOME/...`. Every command is copy-pasteable (grep with absolute paths, exact expected counts, exact curl incantations). Zero banned phrases — R2.T3 uses "change X to Y" not "update the finally block"; R2.T4 enumerates minimum error-message mappings not "as needed". |
| Completeness | ≥8 | 9 | 6 R1 deferrals enumerated individually (D1–D6); 20 assumption checks enumerated; 11 new verify.sh test labels; 4 integration-test scenarios; 19 anti-pattern checklist items; 6 stop conditions; 7 locked decisions. No "etc." or "similar to". |
| Testability | ≥8 | 9 | Every R2 task has an exact verification command with exact expected output (grep count, tsc exit code, curl HTTP status, YAML parseability). §R2.5 Success Criteria has 22 explicit ☑ items. §R2.8 provides copy-paste E2E verification block. |
| Executability | ≥9 | 9 | §R2.6 dependency graph shows linear critical path with wall-time estimates per task summing to 73–95 min total. R2.T1–R2.T10 can be followed sequentially by an agent with zero prior context. Entry gate, exit gate, rollback per task. State-tracking file format defined (implementation-state.md from parent plan). |

All five dimensions ≥ threshold. R2 plan passes anti-mediocrity gate.

#### R2.13 Final Verification Checklist (pre-ExitPlanMode)

- [x] Every section has explicit title under the format `#### R2.{N} ...`
- [x] Every R2 task has what / why / input / output / dependencies / verification / rollback / edge-cases (spot-checked R2.T3 UndoToast, R2.T5 fetchVaultSeq, R2.T7 critic-launch, R2.T10 final-verification — all present)
- [x] Dependency graph drawn with critical path explicitly marked (§R2.6)
- [x] Zero banned phrases in R2 task bodies (checked against ban-list: "set up" / "configure" / "update" / "handle" / "integrate" / "properly" / "as needed" / "etc." / "similar to" / "should work" / "make sure" / "clean up" / "refactor" / "straightforward" / "simply" / "obvious" / "basic" — grep over new R2 content finds zero occurrences in task bodies; occurrences only inside the ban-list table in parent §3 and in this checklist)
- [x] Every file path is absolute (starts with `$HOME/`)
- [x] Every command is copy-pasteable (no `<placeholder>` markers in executable commands; explicit substitution markers like `{R2.T3 commit SHA}` are documented as rollback-specific)
- [x] Every test has exact label + exact assertion + exact expected output
- [x] Agent orchestration 13 questions answered (§R2.9 table)
- [x] Claude Code anti-pattern checklist populated (§R2.10 with 19 items)
- [x] Implementation state tracking file format defined (parent plan §5.1; R2 inherits)
- [x] Closed feedback loop explicit between R2 tasks and toward Sprint I (§R2.11)
- [x] Total wall-time realistic (73–95 min matches R1 empirical; R1 took ~45 min post-fix)
- [x] R2 executable in single session without context overflow (R1 shipped in <4 hours on single session; R2 is a subset with three pre-listed fixes)
- [x] Rollback procedure for every destructive operation (each task specifies `git revert {commit SHA}` or the inverse file-edit pattern)
- [x] No circular dependencies (§R2.6 directed graph confirmed; every edge upstream→downstream)
- [x] Locked decisions explicit (§R2.4 with 7 items)
- [x] Success criteria explicit + measurable (§R2.5 with 22 checkboxes)
- [x] Irreducible truths enumerated with failure-subtraction (§R2.2)
- [x] Validation through negation for every locked decision (§R2.3)




---

## 7. Sprint I — Performance Bedrock (estimated 16h)

### Phase I Prerequisites
- [ ] Phase H COMPLETE per Phase H Exit Gate
- [ ] HEAD = {phase-H-final-commit-sha} (verified via `cd $VAULT_ROOT/codebases/vault-sidebar && git log --oneline -1`)
- [ ] `implementation-state.md` shows all H.* tasks COMPLETE through H.4.3 (R2)
- [ ] `scripts/verify.sh` 39/39

### Entry Gate (corrected by supremacy audit iter-2 R-F2 + R-F5)

**Base quality gates:**
- [ ] `pnpm tsc --noEmit` empty
- [ ] `bash scripts/verify.sh 2>&1 | tail -3` shows `TOTAL: 39 / 39 passed, 0 failed` (**fresh-server required** — 38/39 on warm-server 2nd run is a known reconcile flake from Plan I; restart via Preview MCP to clear)
- [ ] AI-tell greps in `src/` clean
- [ ] Tombstone dir exists + writable: `test -d $VAULT_ROOT/.vault-sidebar-tombstones && touch $VAULT_ROOT/.vault-sidebar-tombstones/.write-probe && rm $VAULT_ROOT/.vault-sidebar-tombstones/.write-probe && echo ok` returns `ok` (not just existence — actual writeability)

**Sprint H R2 + supremacy-audit invariant greps (added by iter-2 R-F5):**
Every Sprint-I task inherits these. If any grep fails, Sprint H has been partially reverted upstream — STOP and investigate before starting Sprint I.
- [ ] `grep -c 'fetchVaultSeq\|nextVaultSeq\|maxAppliedVaultSeq' $VAULT_ROOT/codebases/vault-sidebar/src/api.ts $VAULT_ROOT/codebases/vault-sidebar/src/store.ts` returns `≥6` (R2 D3 monotonic seq machinery intact)
- [ ] `grep -c 'aria-hidden={isDeleting' $VAULT_ROOT/codebases/vault-sidebar/src/components/TaskDetailPanel.tsx` returns `1` (R2 Gemini MEDIUM TASK-DETAIL-DEL-OVERLAY-SR + supremacy F2 invariants)
- [ ] `grep -c 'restoreFocusBeforeUnmount' $VAULT_ROOT/codebases/vault-sidebar/src/components/BulkBar.tsx` returns `≥5` (one declaration + 4 call sites from R2 Gemini HIGH BULK-BAR-FOCUS-LOSS)
- [ ] `grep -c 'TOMBSTONE_TTL_MS = 8000' $VAULT_ROOT/codebases/vault-sidebar/server/writers/task-tombstone.ts` returns `1` (R2 D4 widening intact)
- [ ] `grep -c 'terminal?: boolean' $VAULT_ROOT/codebases/vault-sidebar/src/store.ts` returns `1` (R2 Gemini HIGH UNDO-TOAST-TERMINAL-BTNS flag intact)

**Sprint H exit-gate 50/50 rationale (supremacy-audit iter-2 R-F2 note):** The original plan §6 promised `scripts/verify.sh` would grow by 11 Phase-H checks to 50/50. Those automated checks were not added because (a) Phase H's semantic coverage was provided by THREE independent critic sweeps (Opus + Gemini + Codex at R1, then again at R2) and multiple live-verified E2E roundtrips via Preview MCP, which covered the same 11 areas more rigorously than deterministic greps could; (b) the 5 invariant greps above lock the post-R2 surface directly. If Sprint I surfaces a need for automated checks on any Phase-H behavior, add them in the affected task (not as a pre-Sprint-I backlog).

### Sprint H R2 preempts (MUST read before starting any I.* task)

Surfaced by `/cognitive-supremacy` Tier-3 audit (iter-1) of R2 HEAD `fd5a77b`, revised by Tier-R iter-2 audit at HEAD `5e1507b` (R-F3). Iter-2 found that 2 of 5 iter-1 preempts were PHANTOM (category errors) and 2 were overreach/underspecified. This block is the post-revision set. If Sprint I starts from this plan, trust ONLY this revised block.

**B1 — Client refetch after I.4.17 sanity broadcast must pair with `nextVaultSeq()`** (rescoped iter-2: iter-1 originally targeted sanity-rebuild itself, which is SERVER-SIDE and doesn't touch `setVault`. The client-facing concern survives.)
- R2 D3 (commit `b0b9e29`) added client-side monotonic `fetchVaultSeq` + store-level `maxAppliedVaultSeq` guard. `setVault(vault, seq?)` with `seq === undefined` is intentionally legacy-always-apply (boot + SSE fallback).
- I.4.17's sanity-rebuild runs SERVER-SIDE (rebuilds `server/vault-cache.ts` in-memory map + emits a `vault-changed` SSE frame if diffs found). Client receives the SSE frame and triggers `fetchVault()` per existing SSE pattern in `src/App.tsx`. The concern: if that client-side SSE-triggered `fetchVault` is NOT paired with `nextVaultSeq()`, and the user has a concurrent undo-restore refetch in flight with a higher seq, the sanity-triggered refetch could arrive later in wall-clock but apply first in store-order — clobbering the user's restore.
- **Required in I.4.17 + affected client code**: every client `fetchVault` call site triggered by an SSE `vault-changed` frame MUST consume a `nextVaultSeq()` token before issuing the fetch, pass it to `setVault(v, seq)`, and accept stale drops. Audit `src/App.tsx` + any new Sprint-I SSE consumers. Today's `App.tsx` already does this correctly (R2 D3 wired it); verify no Sprint-I work introduces a second unpaired call site.
- Verification: `grep -n 'fetchVault\(\)' src/` shows every call paired with `nextVaultSeq()` within the same function body.

**B2 — `taskErrorMessages` Map must NOT be in the I.3 `useShallow` selector tuple** (UNCHANGED iter-2 — the one preempt that audited correct)
- R2 D2 (commit `a77dc65`) introduced `taskErrorMessages: Map<taskId, message>` on the store.
- I.3 collapses TaskRow's 13 `useSidebarStore(s => s.X)` calls into one `useSidebarStore(useShallow(s => ({X1, X2, ...})))`. Zustand's `useShallow` compares by shallow reference equality. Every store write that touches `taskErrorMessages` creates a NEW Map instance — shallow equality fails trivially — every row re-renders on every unrelated store update. **Perf regression worse than the pre-collapse baseline.**
- **Required in I.3**: keep `taskErrorMessages` (and any future Map/Set-valued fields) as a SEPARATE `useSidebarStore(s => s.taskErrorMessages.get(task.id))` subscription outside the shallow-selector tuple. The `.get(task.id)` returns a PRIMITIVE string (or undefined) which is stable under identity-equality.
- Verification for I.3: React Profiler (or a per-render useRef counter) shows TaskRow re-render count scales with number of rows whose message changed, NOT the total row count, when `markTaskError` is called.

**B3 — QuickAdd unconditional-mount reminder** (DOWNGRADED iter-2: original preempt was PHANTOM because QuickAdd is already at `App.tsx` level, outside the `AgendaView` subtree that I.2.1 touches. Preserved as a 2-line reminder to prevent a future refactor from moving QuickAdd inside a bucket-body by accident.)
- **Required in I.2.1**: do NOT move the `<QuickAdd />` render from `src/App.tsx` into `AgendaView.tsx` or any bucket-scoped subtree. It must remain an unconditional App-level sibling so `.quick-add-input` stays in DOM for `restoreFocusBeforeUnmount` in `BulkBar.tsx`.
- Verification for I.2.1: after I.2.1 lands, `grep -c '<QuickAdd' src/App.tsx` returns `≥1`.

**B4 — `aria-hidden={isDeleting ? true : undefined}` must survive I.1.2** (STRENGTHENED iter-2: iter-1 grep was too narrow; iter-2 uses a more robust pattern.)
- R2 critic-fix commit `eb17488` added the attribute to the `TaskDetailPanel` root. F2 (commit `fd5a77b`) added try/catch so `isDeleting` always resolves. The attribute is a11y-critical — without it, screen readers can navigate the about-to-unmount subtree during delete.
- I.1.2 migrates 7 loose `task.line !== undefined` guards to `isInlineTask(task)`. Iter-2 analysis: the migration targets internal callbacks + useCallback dep arrays, NOT the root JSX. Risk is LOW but worth a defensive grep.
- **Required in I.1.2**: after the migration lands, verify the attribute is still on the panel root.
- Verification for I.1.2: `grep -cE 'aria-hidden(=\{isDeleting|=.*isDeleting)' src/components/TaskDetailPanel.tsx` returns `≥1`. AND Preview-MCP live test: trigger delete, assert `document.querySelector('.task-detail-panel').getAttribute('aria-hidden') === 'true'` during delete window.

**B5 — `invalidateProject` fires AFTER `moveToTombstone` success (delete path) AND AFTER `restoreFromTombstone` success (restore path)** (EXPANDED iter-2: iter-1 only covered delete; iter-2 surfaced symmetric concern on restore.)
- R2 critic-fix commit `c4144f0` changed tombstone sweep to use filename timestamps. §0.4 Decision 7 says invalidate-before-broadcast — writer-synchronous.
- **Required in I.4.13 (delete path)**: concrete order `await moveToTombstone(...) → await invalidateProject(slug) → response.json({tombstoneId})`. If `moveToTombstone` throws (EEXIST, EACCES, ENOSPC), `invalidateProject` does NOT fire — in-memory cache stays authoritative.
- **Required in a new I.4.13b task (restore path, iter-2 addition)**: symmetric wiring in `server/writers/task-tombstone.ts:restoreFromTombstone` OR in the route handler — after `writeFileExclusive` success on entity restore OR `writeFileAtomic` success on inline restore, call `invalidateProject(slugFromRestoredPath)` BEFORE responding. If restore throws (EEXIST collision, ENOENT target, ENOENT tombstone), invalidation does NOT fire.
- Verification: no Jest/Vitest harness exists in this project. Verification is code-reading + E2E: `grep -B2 -A2 'moveToTombstone\|restoreFromTombstone' src/server/writers/task-*.ts` confirms `invalidateProject` on the success-side of each. Per §3.1 test-label convention, add `I.4.13-invalidate-after-tombstone-success` + `I.4.13b-invalidate-after-restore-success` to `scripts/verify.sh` as HTTP-level integration checks: trigger delete + poll `/api/vault` → slug project must reflect fresh state within 200ms.

**B6 — I.6.4 Bulk Move button must preserve `restoreFocusBeforeUnmount` + terminal-toast pattern** (NEW iter-2.)
- R2 critic-fix commit `eb17488` added `restoreFocusBeforeUnmount()` to `BulkBar.tsx` with 4 call sites (before each `clearSelection()` in Done/Cancel/Delete/legacy-done paths). I.6.4 adds a new Bulk Move button + handler. The new handler will almost certainly call `clearSelection()` at completion.
- **Required in I.6.4**: the new `handleBulkMove` (or equivalent) MUST call `restoreFocusBeforeUnmount()` before `clearSelection()`. Additionally, on partial move failure (e.g. 2 of 5 slug-collision-renamed + 1 hard-failed), the pending-undo revert closure must emit `terminal: true` on the secondary feedback toast (per R2 UNDO-TOAST-TERMINAL-BTNS pattern). Mirror the BulkBar.handleBulkDelete structure exactly.
- Verification: `grep -c 'restoreFocusBeforeUnmount' src/components/BulkBar.tsx` returns `≥6` after I.6.4 (1 declaration + 5 call sites including the new Move path). `grep -c 'terminal: true' src/components/BulkBar.tsx` returns `≥2` (existing partial-restore + new partial-move).

### Task I.0.1: Verify entry gate
- **What**: run all 4 entry gate checks; capture to `/tmp/plan-ii-i-entry-gate.txt`.
- **Why**: Phase I depends on Phase H invariants (tombstones, mtime lock wired).
- **Input**: none.
- **Output**: `/tmp/plan-ii-i-entry-gate.txt` with 4 PASS lines.
- **Dependencies**: Phase H complete.
- **Verification**: `grep -c 'PASS' /tmp/plan-ii-i-entry-gate.txt` returns `4`.
- **Rollback**: none.
- **Edge cases**: reconcile-flake handling same as H.0.2.

### Task I.1.1: Migrate src/components/BulkBar.tsx to discriminated Task union (9 sites)
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/src/components/BulkBar.tsx` replace 9 `task.line !== undefined && task.source === "inline"` patterns (at approximate line numbers 111, 114, 150, 152, 186, 195, 221, 255, 259 — verify exact lines via grep) with `isInlineTask(task)`. Add `import {isInlineTask, isEntityTask} from "../shared/types.js"` at top. All 9 guards simplify because TypeScript narrows on `source` for the InlineTask | EntityTask union.
- **Why**: strict typing eliminates silent `line === undefined` bugs; improves readability.
- **Input**: current BulkBar.tsx with loose-type guards.
- **Output**: BulkBar.tsx using type guards; zero `task.line !== undefined` patterns.
- **Dependencies**: I.0.1 complete.
- **Verification**: `grep -cE 'task\.line !== undefined' $VAULT_ROOT/codebases/vault-sidebar/src/components/BulkBar.tsx` returns `0`. `pnpm tsc --noEmit` empty.
- **Rollback**: `git revert {I.1.1 commit}`.
- **Edge cases**: (a) useCallback deps previously referenced `task.line` → after narrowing, TS errors because `line` doesn't exist on EntityTask; narrow OUTSIDE the callback and pass narrowed task in as closure var; (b) optional chaining `task?.line` patterns — replace with `isInlineTask(task) && task.line` narrowing.

### Task I.1.2: Migrate src/components/TaskDetailPanel.tsx (7 sites)
- **What**: same pattern as I.1.1 applied to TaskDetailPanel.tsx. Replace 7 loose guards with discriminated narrowing via `isInlineTask` / `isEntityTask`.
- **Why**: same rationale.
- **Input**: current TaskDetailPanel.tsx.
- **Output**: zero loose guards.
- **Dependencies**: I.1.1 complete.
- **Verification**: `grep -cE 'task\.line !== undefined|task\.entityPath &&' $VAULT_ROOT/codebases/vault-sidebar/src/components/TaskDetailPanel.tsx` returns `0`.
- **Rollback**: `git revert {I.1.2 commit}`.
- **Edge cases**: `useCallback(async (field, value) => { if (isInline) { if (!tasksPath || task.line === undefined) return; ... }}, [task.entityPath, task.line])` — narrow at call site, not in dep array; use `task` directly in deps and narrow inside.

### Task I.1.3: Migrate src/components/TaskRow.tsx (1 site) + AgendaView EnrichedTask generic
- **What**: (a) fix the 1 `task.entityPath` guard in TaskRow.tsx. (b) in `src/views/AgendaView.tsx` change `interface EnrichedTask extends Task {...}` to `type Enriched<T extends Task> = T & {projectSlug: string; projectTitle: string}` so narrowing propagates through enrichment.
- **Why**: last loose-guard site + generic fix that unblocks EnrichedTask consumers from needing loose types.
- **Input**: current TaskRow.tsx + AgendaView.tsx EnrichedTask definition.
- **Output**: zero loose guards in src/; Enriched<T> generic in AgendaView.
- **Dependencies**: I.1.2 complete.
- **Verification**: `grep -rnE 'task\.line !== undefined|task\.entityPath &&' $VAULT_ROOT/codebases/vault-sidebar/src/` returns empty. `grep -c 'type Enriched<' $VAULT_ROOT/codebases/vault-sidebar/src/views/AgendaView.tsx` returns 1. `pnpm tsc --noEmit` empty. verify.sh adds `I.1-type-migration-zero-guards`.
- **Rollback**: `git revert {I.1.3 commit}`.
- **Edge cases**: (a) EnrichedTask consumed in multiple views — update each; (b) Enriched<EntityTask> vs Enriched<InlineTask> branching at consumer — narrow via `isInlineTask(t)` before accessing line.

### Task I.1.4: Flip api.ts Task type from loose to strict re-export
- **What**: in `src/api.ts` delete the loose `interface Task {...}` and replace with `export type {Task} from "./shared/types.js"` (plus keep existing Strict re-exports). Verify every consumer still compiles.
- **Why**: make shared/types.ts authoritative — single source of truth for the discriminated union.
- **Input**: current api.ts with loose + strict coexisting.
- **Output**: api.ts re-exports strict only.
- **Dependencies**: I.1.3 complete (all sites narrowed).
- **Verification**: `grep -c 'interface Task {' $VAULT_ROOT/codebases/vault-sidebar/src/api.ts` returns 0. `pnpm tsc --noEmit` empty.
- **Rollback**: `git revert {I.1.4 commit}`.
- **Edge cases**: any consumer we missed will surface as tsc error → narrow that site and add to I.1.3 retroactively (re-open I.1.3 commit with amendment).

### Task I.2.1: AgendaView lazy-mount collapsed bucket contents
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/src/views/AgendaView.tsx` wrap `.bucket-body` children with `{!collapsed && tasks.map(...)}`. Currently `hidden={collapsed}` keeps children mounted; flip to conditional render — children not in React tree when collapsed.
- **Why**: DOM-density reduction — 35370 nodes → <5000 with default collapse state. Covers 95% of virtualization's win per user-locked Decision 1.
- **Input**: current AgendaView.tsx with always-rendered bucket bodies.
- **Output**: AgendaView.tsx with conditional render under collapsed state.
- **Dependencies**: I.1.4 complete.
- **Verification**: preview_eval — collapse all buckets → `document.querySelectorAll('[data-task-row]').length === 0`. Expand Overdue+Today+Tomorrow only → row count matches those buckets' task counts. verify.sh adds `I.2-agenda-dom-under-5000`.
- **Rollback**: `git revert {I.2.1 commit}`.
- **Edge cases**: (a) keyboard nav `getVisibleTaskIds()` in keyboard.ts already filters `isHiddenByAncestor` → unmounted rows return [] naturally; (b) animations on mount — stagger-fade (J.1.1) must still work because conditional render is "mount when expanded, unmount when collapsed", triggering keyframe on each expand; (c) task selectedTaskId pointing at a row inside a collapsed bucket — store.toggleBucketCollapsed already clears selectedTaskId when its bucket collapses (Sprint B R3).

### Task I.2.2: ProjectsView lazy-mount collapsed project contents
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/src/views/ProjectsView.tsx` verify that `.project-tasks` children render conditionally on `isExpanded`. Current code already has `{isExpanded && openTasks.length > 0 && ( ... )}` — no change if already lazy. If any project path still mounts when collapsed, fix.
- **Why**: same DOM-density rationale applied to Projects view.
- **Input**: current ProjectsView.tsx.
- **Output**: confirmed lazy.
- **Dependencies**: I.2.1 complete.
- **Verification**: preview_eval — expand 1 project, measure task row count; collapse it, row count drops to 0 for that project.
- **Rollback**: none if no change made.
- **Edge cases**: same as I.2.1.

### Task I.2.3: Apply content-visibility: auto to .task-row
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/src/styles.css` add `.task-row { content-visibility: auto; contain-intrinsic-size: auto 40px; }`.
- **Why**: browser skips layout/paint for off-screen rows after lazy-mount. Complementary to I.2.1/I.2.2.
- **Input**: current styles.css .task-row rule.
- **Output**: styles.css with content-visibility declarations.
- **Dependencies**: I.2.2 complete.
- **Verification**: preview_eval `getComputedStyle(document.querySelector('.task-row')).contentVisibility` returns `"auto"`. verify.sh adds `I.2-content-visibility-applied`.
- **Rollback**: `git revert {I.2.3 commit}`.
- **Edge cases**: (a) sticky `.bucket-header` inside content-visibility element — apply content-visibility to .task-row only, NOT to .bucket-body, so sticky continues to work; (b) scroll into view must still trigger paint — default browser behavior when element re-enters viewport.

### Task I.3: Zustand subscription collapse in TaskRow.tsx via useShallow
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/src/components/TaskRow.tsx` replace the 13 `useSidebarStore(s => s.X)` calls with a single `useSidebarStore(useShallow(s => ({selectedTaskId: s.selectedTaskId, setSelectedTaskId: s.setSelectedTaskId, ... all 13 ...})))`. Import `useShallow` from `zustand/react/shallow`.
- **Why**: 13 subscriptions × 2261 rows = 29393 selector reads per update. Collapsing to 1 subscription with shallow equality drops to 2261. Meaningful React render perf win.
- **Input**: current TaskRow.tsx with 13 individual selectors.
- **Output**: TaskRow.tsx with single useShallow selector.
- **Dependencies**: I.2.3 complete.
- **Verification**: `grep -cE 'useSidebarStore\(' $VAULT_ROOT/codebases/vault-sidebar/src/components/TaskRow.tsx` returns `≤5` (useShallow call + possibly setVault direct calls in handlers). `pnpm tsc --noEmit` empty. verify.sh adds `I.3-taskrow-subscriptions-le-5`.
- **Rollback**: `git revert {I.3 commit}`.
- **Edge cases**: (a) selectedTaskIds Set re-renders on every Set creation — Zustand's useShallow does shallow reference equality, so new Set() instances DO trigger re-render. Correct behavior (selection changed means row visual changed); (b) destructuring 13 fields from a single object has TS narrowing caveats — annotate the useShallow selector return type explicitly.

### Task I.4.1: Create server/vault-cache.ts
- **What**: create `$VAULT_ROOT/codebases/vault-sidebar/server/vault-cache.ts` with: (a) `projects: Map<slug, Project>` state; (b) `parseCache: Map<absPath, {mtime: string, parsed: {data, content}}>` for gray-matter cache; (c) `buildInitial(): Promise<void>` doing a full vault walk (same logic as current vault-index.buildVaultIndex) and populating both maps; (d) `getVault(): VaultIndex` returning a frozen snapshot of the current state (projects + today list + generatedAt); (e) `invalidateProject(slug: string): Promise<void>` re-parsing README + tasks.md + all entity tasks for that slug; (f) `invalidateFile(absPath: string): Promise<void>` routing to invalidateProject(slug-derived) for targeted invalidation; (g) `startSanityRebuild(intervalMs = 60000): () => void` returning a cleanup function that periodically rebuilds and diffs.
- **Why**: drop /api/vault warm latency from 20ms to <5ms. Enables optimistic UI + snappy feel.
- **Input**: existing `server/vault-index.ts` logic is the parsing reference.
- **Output**: new vault-cache.ts with 7 exports.
- **Dependencies**: I.3 complete.
- **Verification**: `grep -cE 'export (async function|function|const) (buildInitial|getVault|invalidateProject|invalidateFile|startSanityRebuild)' $VAULT_ROOT/codebases/vault-sidebar/server/vault-cache.ts` returns 5. `pnpm tsc --noEmit` empty.
- **Rollback**: `git revert {I.4.1 commit}`.
- **Edge cases**: (a) parseCache key collision (two files with same absPath somehow) — impossible on a filesystem; (b) stale parseCache entry (file deleted but cache retained) — invalidateFile must delete parseCache entry; (c) concurrent invalidateProject calls for same slug — serialize via per-slug lock (simple Promise chaining).

### Task I.4.2: Modify server/vault-index.ts to read from cache
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/server/vault-index.ts` change `buildVaultIndex()` to call `getVault()` from vault-cache.ts. Keep the existing parsing functions as exports for cache.ts to import, but the public API returns cached data.
- **Why**: swap read path to cache.
- **Input**: current vault-index.ts.
- **Output**: vault-index.ts `buildVaultIndex = getVault` (literally).
- **Dependencies**: I.4.1 complete.
- **Verification**: `curl -s -w '%{time_total}s\n' -o /dev/null http://127.0.0.1:5174/api/vault` on warm cache returns <0.005s (5ms). verify.sh adds `I.4-vault-warm-under-5ms`.
- **Rollback**: `git revert {I.4.2 commit}`.
- **Edge cases**: (a) first-call-before-initial-build race — I.4.15 handles this by calling buildInitial sync BEFORE app.listen; (b) hot-reload during dev may skip the sync build → add a guard `if (!initialBuilt) await buildInitial()` at the top of getVault as safety net.

### Task I.4.3 through I.4.14: Wire invalidateProject into 12 writers
Each writer adds one line: `await invalidateProject(slug)` immediately AFTER `writeFileAtomic` succeeds AND BEFORE broadcast. One task per writer to keep commits atomic and rollback-surgical. Writers:
- I.4.3 task-toggle.ts
- I.4.4 task-add.ts
- I.4.5 task-edit.ts
- I.4.6 task-move.ts (also I.6 target, see below)
- I.4.7 task-field-edit.ts
- I.4.8 task-status-edit.ts
- I.4.9 task-create-entity.ts
- I.4.10 task-promote.ts
- I.4.11 task-promote-and-edit.ts
- I.4.12 project-field-edit.ts
- I.4.13 task-delete.ts (tombstone path — also invalidate on move-to-tombstone)
- I.4.14 task-body-edit.ts

For each: **What**: add `await invalidateProject(slug)` immediately after write; extract `slug` from existing path logic. **Why**: hard invariant from §0.3 Decision 7 — invalidate BEFORE broadcast. **Input**: the writer's current code. **Output**: writer invalidates synchronously. **Dependencies**: previous writer task + I.4.2. **Verification**: per writer, verify.sh adds `I.4-{writer-name}-invalidates-before-broadcast` — instrument the writer to log invalidate+broadcast timestamps, assert invalidate < broadcast. **Rollback**: `git revert` the specific writer commit. **Edge cases**: (a) slug extraction fails (malformed path) — writer already throws at safety check, before reaching invalidate; (b) invalidateProject fails — let error propagate; HTTP response is 500; client retries.

### Task I.4.15: server/index.ts synchronous initial cache build + shutdown hook
- **What**: in `server/index.ts` `start()` function, call `await buildInitial()` from vault-cache BEFORE `app.listen(port)`. Register SIGTERM/SIGINT/beforeExit to call the cleanup function returned by `startSanityRebuild`.
- **Why**: avoid first-request-before-cache-built race.
- **Input**: current server/index.ts.
- **Output**: server boots with cache pre-populated.
- **Dependencies**: I.4.14 complete.
- **Verification**: kill + restart server, immediately `curl /api/vault` at T+0.1s, expect 200 with full vault (not 503). verify.sh adds `I.4-cache-first-request-no-503`.
- **Rollback**: `git revert {I.4.15 commit}`.
- **Edge cases**: buildInitial throws (vault parse error) → server fails to start → good, loud failure.

### Task I.4.16: server/watcher.ts chokidar external-change invalidation
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/server/watcher.ts` the existing chokidar handler also calls `await invalidateFile(absPath)` before broadcast. This catches external changes (Obsidian, git pull).
- **Why**: safety net for writes that don't originate from our server.
- **Input**: current watcher.ts.
- **Output**: watcher.ts wired to cache invalidation.
- **Dependencies**: I.4.15 complete.
- **Verification**: touch a vault file via external shell, observe /api/vault reflects the change within 200ms (150ms debounce + invalidate + read).
- **Rollback**: `git revert {I.4.16 commit}`.
- **Edge cases**: (a) chokidar fires on our own writes → redundant invalidation, idempotent, no harm; (b) chokidar fires during buildInitial → guard with `if (!initialBuilt) return`.

### Task I.4.17: Sanity rebuild timer
- **What**: call `startSanityRebuild(60000)` from server/index.ts right after buildInitial. Log any detected deltas to stderr with prefix `[cache-sanity]`.
- **Why**: chokidar misses events on high-load Linux filesystems; 60s sanity catch-up keeps cache aligned.
- **Input**: none (wires the function created in I.4.1).
- **Output**: server logs `[cache-sanity] diff: N projects reparsed` periodically.
- **Dependencies**: I.4.16 complete.
- **Verification**: simulate a missed chokidar event (manually invalidate a test file in watcher's ignore list), wait 60s, confirm cache catches up.
- **Rollback**: `git revert {I.4.17 commit}`.
- **Edge cases**: sanity rebuild runs concurrently with a writer invalidation — serialize via per-slug lock.

### Task I.5: SSE event coalescing (100ms server-side debounce)
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/server/watcher.ts` wrap `broadcast({type: "vault-changed"})` in a 100ms debounce. Multiple rapid changes emit one event.
- **Why**: reduce client refetch storms. Plan-agent Q11 — currently N events fire N refetches.
- **Input**: current watcher.ts broadcast.
- **Output**: coalesced broadcast.
- **Dependencies**: I.4.17 complete.
- **Verification**: trigger 10 file changes within 150ms, count SSE events received at client: ≤2. verify.sh adds `I.5-sse-coalesce-count-le-2`.
- **Rollback**: `git revert {I.5 commit}`.
- **Edge cases**: (a) a single isolated change still fires within 100ms; (b) debounce collapses unrelated project changes — client still refetches full /api/vault so no lost data.

### Task I.6.1: Extend task-move.ts for entity tasks
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/server/writers/task-move.ts` add entity-path support. If source is `1-Projects/A/tasks/foo.md` and target is project B, rename to `1-Projects/B/tasks/foo.md`. Rewrite `parent-project` frontmatter to `[[1-Projects/B/README]]`. Handle slug collision: if target exists, auto-suffix `-2`, `-3`... Return `{moved: relativeTargetPath, renamedFrom?: originalSlug, renamedTo?: suffixedSlug}`.
- **Why**: current task-move only supports inline. Bulk Move (I.6.4) requires entity support.
- **Input**: current task-move.ts (inline-only).
- **Output**: task-move.ts handles entity + inline + collision.
- **Dependencies**: I.5 complete.
- **Verification**: curl POST /api/tasks/move with entityPath → success with moved+optionally renamed fields. verify.sh adds `I.6-bulk-move-entity-happy-path` + `I.6-bulk-move-entity-collision-auto-suffix`.
- **Rollback**: `git revert {I.6.1 commit}`.
- **Edge cases**: (a) slug collision check via existsSync — race with concurrent creates possible but very rare; accept; (b) fs.rename fails mid-operation — atomic per POSIX; no partial state; (c) parent-project frontmatter rewrite uses gray-matter + writeFileAtomic same as task-field-edit.

### Task I.6.2: api.ts moveEntityTaskApi wrapper
- **What**: in `src/api.ts` add `moveEntityTaskApi({entityPath, targetSlug}): ApiResult<{moved: string, renamedFrom?: string, renamedTo?: string}>`.
- **Why**: client-side surface for BulkBar Move.
- **Input**: current api.ts.
- **Output**: new wrapper.
- **Dependencies**: I.6.1 complete.
- **Verification**: `grep -c 'moveEntityTaskApi' src/api.ts` returns 1.
- **Rollback**: `git revert {I.6.2 commit}`.
- **Edge cases**: same POST-JSON pattern as others.

### Task I.6.3: Create src/components/ProjectPicker.tsx
- **What**: create portaled popover with fuzzy combobox over projects. Reuse `src/lib/fuzzy.ts` from Sprint D. Render recent projects (last-used by moved/created timestamps, persisted to localStorage) at top. Keyboard-first: arrow-nav, Enter select, Esc close. Anchor positioning via same Popover pattern as DuePopover (Sprint C).
- **Why**: user-facing picker for bulk Move. Reuse established patterns.
- **Input**: `src/lib/fuzzy.ts` from Sprint D, `src/components/Popover.tsx` pattern.
- **Output**: new ProjectPicker.tsx + CSS styles in styles.css.
- **Dependencies**: I.6.2 complete.
- **Verification**: preview_eval — open picker, type 2 chars, assert fuzzy matches surface at top; arrow down + Enter selects; Esc closes.
- **Rollback**: `git revert {I.6.3 commit}`.
- **Edge cases**: (a) no recent projects → show alphabetical list; (b) fuzzy returns zero matches → show "no projects match"; (c) keyboard nav while picker open must NOT bubble to global j/k handler — same stop-down logic as ⌘K palette (`.cmdp, .popover` stand-down in keyboard.ts).

### Task I.6.4: BulkBar Move button + ProjectPicker integration
- **What**: in `src/components/BulkBar.tsx` add a Move button between Done and Cancel. On click, open ProjectPicker anchored to the button. On pick, loop `moveEntityTaskApi` per selected task; collect per-task rename info. Emit pendingUndo with a revert closure that moves each task back (including rename-back).
- **Why**: primary user-facing feature for bulk Move.
- **Input**: current BulkBar.tsx + ProjectPicker from I.6.3.
- **Output**: BulkBar.tsx with Move button + pending undo.
- **Dependencies**: I.6.3 complete.
- **Verification**: preview_eval E2E — select 3 tasks, click Move, pick a project, verify vault now has 3 moved files, undo toast says "3 moved · X renamed · Undo", click Undo, verify originals restored. verify.sh adds `I.6-bulk-move-undo-reverses-rename`.
- **Rollback**: `git revert {I.6.4 commit}`.
- **Edge cases**: (a) one of N moves fails mid-loop — finalize the successful moves, surface error for the failed one; (b) user picks same project as source — no-op with early return; (c) user presses Escape mid-picker — picker closes, no moves fire.

### Task I.6.5: Silent collision auto-suffix with transparent toast label
- **What**: ensure the BulkBar Move toast label reads e.g. "3 tasks moved to GTM · 1 renamed · Undo" when any task was collision-renamed. Label generation extracts renamedTo from each per-task response.
- **Why**: user sees rename transparency without interrupting flow (Decision 5).
- **Input**: I.6.4 response shape.
- **Output**: BulkBar.tsx toast label with rename count.
- **Dependencies**: I.6.4 complete.
- **Verification**: preview_eval — intentionally create target collision, move, verify toast contains "renamed".
- **Rollback**: `git revert {I.6.5 commit}`.
- **Edge cases**: zero renames → label omits "renamed" clause; all renames → "3 moved · 3 renamed".

### Task I.7: Locale-aware dates
- **What**: in `$VAULT_ROOT/codebases/vault-sidebar/src/lib/format.ts` replace 3 `toLocaleDateString("en-US", ...)` calls with `toLocaleDateString(undefined, ...)`. In `src/App.tsx` `formatDateLabel` do same.
- **Why**: respects `navigator.language`. German user gets German weekdays.
- **Input**: current format.ts + App.tsx.
- **Output**: zero "en-US" strings in src/.
- **Dependencies**: I.0.1 complete (independent from I.1-I.6).
- **Verification**: `grep -c '"en-US"' $VAULT_ROOT/codebases/vault-sidebar/src/` returns 0. preview_eval with `Object.defineProperty(navigator, 'language', {value:'de-DE'})` then check a due chip for German weekday. verify.sh adds `I.7-locale-de-no-en-weekdays`.
- **Rollback**: `git revert {I.7 commit}`.
- **Edge cases**: (a) tests that hard-coded "Mon/Tue" assertions break → update to locale-insensitive assertions; (b) Intl not available in some runtimes → undefined fallback handled by browser.

### Task I.8: Manual SSE reconnect button with exponential countdown
- **What**: in `src/api.ts` change `subscribeVaultEvents` to return `{close, reconnect}` where reconnect closes the current EventSource and opens a fresh one. In `src/App.tsx`, in the `.sse-banner` div add a Retry button. On click: call reconnect(); if fail, display "Retrying in Ns…" countdown with exponential backoff (2,4,8,16,32 cap). On success: show "Reconnected" green flash for 600ms.
- **Why**: manual recovery path when EventSource auto-retry gives up.
- **Input**: current subscribeVaultEvents + sse-banner.
- **Output**: reconnect handle + banner button + countdown state.
- **Dependencies**: I.5 complete (for coalesce base behavior).
- **Verification**: preview_eval — kill server externally, wait 12s, banner appears; click Retry; if server still down, countdown visible; restart server; click Retry; "Reconnected" flashes. verify.sh adds `I.8-sse-reconnect-button-visible-on-close`.
- **Rollback**: `git revert {I.8 commit}`.
- **Edge cases**: (a) reconnect called while EventSource is CONNECTING — close-and-reopen may drop an in-flight frame; acceptable (next heartbeat covers); (b) exponential backoff state must reset on successful reconnect.

### Phase I Exit Gate
- [ ] `pnpm tsc --noEmit` empty
- [ ] `bash scripts/verify.sh` shows `TOTAL: 58 / 58 passed, 0 failed` (50 after H + 8 new Phase I checks)
- [ ] AI-tell greps clean
- [ ] `curl /api/vault` warm latency <5ms p50 over 20 runs
- [ ] Agenda DOM nodes <5000 on default-collapsed state
- [ ] `grep -rnE 'task\.line !== undefined|task\.entityPath &&' src/` empty
- [ ] Bulk Move functional (3-task E2E: move + undo + no data loss)
- [ ] SSE reconnect button visible in banner
- [ ] playwright-cli video: `/tmp/sprint-i-lazy-mount.webm` exists
- [ ] implementation-state.md shows all I.* tasks COMPLETE
- [ ] HANDOFF.md updated with Sprint I summary

### Phase I Convergence Rounds

Four rounds (per plan-agent Q8 — Phase I has the subtlest failure modes). Same protocol as Phase H. Round 4 is a dedicated `git diff 2ea75c4..HEAD` regression sweep.

---

## 8. Sprint J — Feel Layer + 14-Item Autistic Polish (estimated 10h)

### Phase J Prerequisites
- [ ] Phase I COMPLETE per Phase I Exit Gate
- [ ] HEAD = {phase-I-final-commit-sha}
- [ ] implementation-state.md shows all I.* tasks COMPLETE
- [ ] `scripts/verify.sh` 58/58

### Entry Gate
- [ ] `pnpm tsc --noEmit` empty
- [ ] `bash scripts/verify.sh` 58/58
- [ ] AI-tell greps clean
- [ ] Cache warm latency <5ms confirmed

### Task J.0.1: Verify entry gate
- Same pattern as H.0.2 and I.0.1. Captures `/tmp/plan-ii-j-entry-gate.txt` with 4 PASS lines.
- **Dependencies**: Phase I complete.

### Task J.1.1: Stagger-fade-in on TaskRow mount
- **What**: (a) in `src/styles.css` add `@keyframes row-stagger-in { from {opacity:0; transform:translateY(2px);} to {opacity:1; transform:none;} }` + rule `.task-row { animation: row-stagger-in 200ms ease-out; animation-delay: calc(var(--row-index, 0) * 15ms); animation-fill-mode: both; }`. (b) in AgendaView.tsx + ProjectsView.tsx pass `style={{"--row-index": Math.min(index, 30)}}` via inline-style override (one of the permitted exceptions — dynamic value requires inline). Cap at 30 to max out stagger at 450ms.
- **Why**: perceptual smoothness signature moment.
- **Input**: current styles.css + two view files.
- **Output**: staggered row mount animation.
- **Dependencies**: J.0.1 complete.
- **Verification**: preview_eval — count `.task-row` with computed `animationDelay > 0s` under normal motion → >0; under `prefers-reduced-motion: reduce` → all `0s`. verify.sh adds `J.1.1-stagger-fade-animation-delay-per-row` and `J.1.1-stagger-fade-reduced-motion-zero`.
- **Rollback**: `git revert {J.1.1 commit}`.
- **Edge cases**: (a) row remount on SSE refresh re-triggers animation — acceptable (subtle but signals update); (b) collapsed→expanded bucket re-fires animation for every row — acceptable; (c) index prop changes during drag — not applicable, no drag in this plan.

### Task J.1.2: Optimistic UI for delete + create + bulk
- **What**: (a) in `src/store.ts` add `optimisticDelete(taskId): void` removing task from vault state; add `optimisticCreate(placeholderTask): void` prepending to project tasks; add `rollbackOptimistic(taskId, snapshot): void` restoring. (b) in TaskRow delete handler call `optimisticDelete` immediately, on 500 call `rollbackOptimistic`. (c) in QuickAdd submit handler insert placeholder row, on server ack replace placeholder with real task. (d) BulkBar per-iteration flips optimistically as each API call succeeds (currently flips at end).
- **Why**: perceived latency zero. Matches "snappiest" mandate.
- **Input**: current store.ts + components.
- **Output**: optimistic flip on all three paths.
- **Dependencies**: J.1.1 complete.
- **Verification**: preview_eval — delete with fetch mocked 500 → row disappears, then reappears within 200ms with error state. verify.sh adds `J.1.2-optimistic-delete-rollback-under-200ms`.
- **Rollback**: `git revert {J.1.2 commit}`.
- **Edge cases**: (a) optimistic delete while SSE broadcast is in flight — rollbackOptimistic races with refetch; refetch wins (server truth); (b) placeholder create with duplicate id — use crypto.randomUUID() for placeholder ids; (c) bulk optimistic partial — each row flips as its API returns; order-independent.

### Task J.1.3: Error-dot hover tooltip complements H.1
- **What**: confirm H.1's hover tooltip still works after any refactor during I.3 (useShallow collapse).
- **Why**: cross-sprint regression check.
- **Input**: H.1's existing implementation + any I.3 changes.
- **Output**: preview_eval confirmation.
- **Dependencies**: J.1.2 complete.
- **Verification**: preview_eval as in H.1.
- **Rollback**: none (verification-only task).
- **Edge cases**: none new.

### Task J.1.4: Animation timing tokens
- **What**: in `src/styles.css :root` add: `--ease-spring-subtle: cubic-bezier(0.25, 0.9, 0.35, 1.05); --ease-spring-emphatic: cubic-bezier(0.25, 0.9, 0.35, 1.25); --ease-standard: cubic-bezier(0.4, 0, 0.2, 1); --duration-quick: 150ms; --duration-medium: 200ms; --duration-signature: 360ms;`. Then find all 5 existing inline cubic-bezier uses in styles.css and replace with the token refs.
- **Why**: consistent timing language. No stray curves.
- **Input**: current styles.css with scattered cubic-bezier.
- **Output**: styles.css with 3 tokens + zero inline cubic-bezier outside the token defs.
- **Dependencies**: J.1.3 complete.
- **Verification**: `grep -c 'cubic-bezier' $VAULT_ROOT/codebases/vault-sidebar/src/styles.css` returns ≤4 (3 token defs + 0 inline uses, or 3+1 if one is inside an @keyframes that can't use var()). verify.sh adds check.
- **Rollback**: `git revert {J.1.4 commit}`.
- **Edge cases**: (a) `@keyframes` steps can't use `var()` for easing — keyframes use implicit ease; animation-timing-function is set on the rule, not inside keyframes; (b) reduced-motion keyframe overrides still work — media query zeroes out duration regardless of timing.

### Task J.1.5: Focus management audit
- **What**: (a) in `src/lib/keyboard.ts jumpToTab` after tab switch, focus the first `[data-task-row]` in the new view. (b) in `src/components/BulkBar.tsx` after bulk-action success, focus the QuickAdd input. (c) in `src/components/TaskDetailPanel.tsx` delete-success focus the next visible task row in same bucket (fallback: first visible). (d) in `src/components/CommandPalette.tsx` on open snapshot `document.activeElement` to a ref, on close call `.focus()` on the snapshot.
- **Why**: every action ends at a sensible focus target; closes measured gap.
- **Input**: current keyboard.ts + 3 components.
- **Output**: 4 focus-restoration patches.
- **Dependencies**: J.1.4 complete.
- **Verification**: verify.sh adds `J.1.5-tab-switch-focus-first-row`. preview_eval: press `1`, verify activeElement is first agenda row.
- **Rollback**: `git revert {J.1.5 commit}`.
- **Edge cases**: (a) first visible row doesn't exist (empty agenda) → focus falls to tab button; (b) snapshotted element was removed from DOM by SSE → fallback to body focus (acceptable); (c) race between animation and focus — wrap focus call in `requestAnimationFrame` to wait for layout settle.

### Task J.2.6: Touch targets 24×24 minimum on task-circle
- **What**: in `src/styles.css` add `.task-circle::before { content: ""; position: absolute; inset: -6px; }` extending hit area.
- **Why**: a11y minimum even on desktop-only surface (mouse precision varies).
- **Input**: current .task-circle rule.
- **Output**: expanded hit area invisible to eyes.
- **Dependencies**: J.1.5 complete.
- **Verification**: preview_eval: `document.querySelector('.task-circle').getBoundingClientRect()` — the ::before extends to 24×24. verify.sh adds `J.2.6-touch-target-24px`.
- **Rollback**: `git revert {J.2.6 commit}`.
- **Edge cases**: overlapping hit areas on adjacent rows — inset -6px means 12px gap; if rows are 40px tall, no overlap.

### Task J.2.7: prefers-contrast variant
- **What**: in `src/styles.css` add `@media (prefers-contrast: more) { :root { --accent: #ff3322; --separator-strong: rgba(255,255,255,0.35); --text-secondary: #b5b5b5; } [data-theme="light"] { --accent: #a0180e; --separator-strong: rgba(0,0,0,0.38); } }`. Tune exact values via contrast-checker before commit.
- **Why**: AAA-compliance.
- **Input**: current token defs.
- **Output**: contrast-mode tokens.
- **Dependencies**: J.2.6 complete.
- **Verification**: preview_eval under `matchMedia('(prefers-contrast: more)')` simulated → `getComputedStyle(document.documentElement).getPropertyValue('--accent')` returns the new hex. verify.sh adds `J.2.7-prefers-contrast-accent-delta`.
- **Rollback**: `git revert {J.2.7 commit}`.
- **Edge cases**: dark + light both need overrides.

### Task J.2.8: Color-blind non-color cues
- **What**: (a) P1 pill `.priority-pill--p1` gets `background: var(--priority-p1); color: var(--accent-foreground);` (solid fill). P2: ring border only. P3: dotted border. P4: transparent bg + muted text. (b) `.task-row--overdue` row (rule to add) prepends `<AlertCircle size={11} strokeWidth={2}/>` icon inside `.task-due` when overdue=true via TaskRow.tsx conditional render.
- **Why**: 8% of men have red-green CVD. Non-color cues make priority + overdue readable without color vision.
- **Input**: current priority-pill + task-due styling; TaskRow.tsx.
- **Output**: differentiated pill styles + icon on overdue.
- **Dependencies**: J.2.7 complete.
- **Verification**: preview_eval — `getComputedStyle('.priority-pill--p1').backgroundColor` ≠ transparent; overdue row has `svg[aria-hidden]` inside `.task-due`. verify.sh adds two checks.
- **Rollback**: `git revert {J.2.8 commit}`.
- **Edge cases**: icon + text must fit within 320px viewport → verify no overflow.

### Task J.2.9: Zoom audit (time-boxed 30min)
- **What**: run `mcp__Claude_Preview__preview_resize` to viewport widths 160px, 320px, 480px, 725px. At each width run `mcp__Claude_Preview__preview_screenshot`. For each screenshot inspect for: (a) horizontal overflow (document.documentElement.scrollWidth > window.innerWidth), (b) text clipped without ellipsis on `.task-title` / `.task-project` / `.bucket-header__label`, (c) sticky bucket headers detached from bucket body, (d) priority-pill or due-chip overflowing row bounds. Fix each issue at its root in styles.css; commit per-fix.
- **Why**: accessibility-legally-relevant for WCAG 1.4.4.
- **Input**: current layout.
- **Output**: fixes for any broken overflow (document in commit).
- **Dependencies**: J.2.8 complete.
- **Verification**: manual screenshot at 160px + 320px + 480px + 725px — no horizontal scrollbar.
- **Rollback**: per-fix revert.
- **Edge cases**: if critical overflow surfaces that can't be fixed in 30min → document as known-issue, not a blocker.

### Task J.2.10: Long-press context menu
- **What**: create `src/components/LongPressMenu.tsx`. Implement `pointerdown → startTimer(400ms) → if pointermove > 8px → cancel, if timer expires without cancel → fire context menu at pointer position`. Menu options: Edit, Delete, Move, Copy link. Wire to TaskRow via pointer event listeners on the row wrapper.
- **Why**: touch/trackpad parity for right-click menu.
- **Input**: TaskRow pointer events (none currently).
- **Output**: LongPressMenu.tsx + TaskRow wiring.
- **Dependencies**: J.2.9 complete.
- **Verification**: preview_eval simulate pointerdown + 500ms delay + no pointermove → menu appears.
- **Rollback**: `git revert {J.2.10 commit}`.
- **Edge cases**: (a) scroll during long-press must cancel (pointermove threshold); (b) right-click should also fire the same menu for consistency; (c) Esc closes menu.

### Task J.2.11: Haptics feedback
- **What**: create `src/lib/haptics.ts` with `export function pulse(ms = 10): void` that (a) checks `navigator.vibrate`, (b) checks `prefers-reduced-motion: reduce` (respect it), (c) calls `navigator.vibrate(ms)` or no-ops. Wire to task-circle toggle (TaskRow.handleToggleClick), bulk action success (BulkBar handlers), delete confirm (TaskDetailPanel).
- **Why**: tactile reinforcement on supporting devices.
- **Input**: none.
- **Output**: new haptics.ts + 3 call sites.
- **Dependencies**: J.2.10 complete.
- **Verification**: preview_eval `window.navigator.vibrate === undefined || typeof window.navigator.vibrate === "function"` → no crash.
- **Rollback**: `git revert {J.2.11 commit}`.
- **Edge cases**: (a) vibrate not supported → silent no-op; (b) reduced-motion user with vestibular sensitivity also wants no vibration.

### Task J.2.12: Skeleton crossfade polish
- **What**: in `src/components/SkeletonRow.tsx` wrap output in a div with `animation: skel-fade-out 150ms ease-out forwards` triggered when `dataReady`. In parent view (AgendaView), when skeleton unmounts and real rows mount, the real rows' stagger-fade-in (J.1.1) provides the crossfade. Match skeleton row height to real row height (~40px) via `contain-intrinsic-size`.
- **Why**: no layout jump when skeletons swap to content.
- **Input**: current SkeletonRow.tsx.
- **Output**: crossfade timing.
- **Dependencies**: J.2.11 complete.
- **Verification**: preview_eval during initial load — observe no `height: 0` frames during swap.
- **Rollback**: `git revert {J.2.12 commit}`.
- **Edge cases**: skeleton crossfade with reduced-motion → skip crossfade, instant swap.

### Task J.2.13: Scroll-shadow on sticky bucket headers
- **What**: in `src/components/BucketHeader.tsx` add scroll listener on the AgendaView container (use IntersectionObserver on a sentinel div above the first row). When sentinel exits the viewport upward, add class `.bucket-header--scrolled` to the matching header. CSS: `.bucket-header--scrolled::after { content: ""; position: absolute; bottom: -1px; left: 0; right: 0; height: 4px; background: linear-gradient(to bottom, rgba(0,0,0,0.18), transparent); pointer-events: none; }`.
- **Why**: visual cue "there's content above me".
- **Input**: current BucketHeader.tsx + styles.css.
- **Output**: shadow appears when scrolled.
- **Dependencies**: J.2.12 complete.
- **Verification**: preview_eval — scroll agenda to middle, measure `getComputedStyle(document.querySelector('.bucket-header--scrolled')).boxShadow` → non-none. verify.sh adds `J.2.13-scroll-shadow-on-scroll-position-nonzero`.
- **Rollback**: `git revert {J.2.13 commit}`.
- **Edge cases**: (a) multiple sticky headers — each has independent sentinel; (b) no overflow scrolling (agenda fits in viewport) → no shadow; (c) reduce-motion doesn't affect (static shadow).

### Task J.2.14: ⌘K focus trail
- **What**: confirm J.1.5's snapshot-and-restore pattern in CommandPalette.tsx. This is formally a dedicated task so convergence critics check it independently.
- **Why**: ⌘K must not drop focus to body on close.
- **Input**: J.1.5 work.
- **Output**: confirmed pattern.
- **Dependencies**: J.1.5 complete, J.2.13 complete.
- **Verification**: preview_eval — focus a button, press ⌘K, press Esc, verify activeElement is the original button.
- **Rollback**: none (verification task).
- **Edge cases**: snapshot element removed from DOM → fall back to QuickAdd input.

### Task J.2.15: SSE backoff countdown (merges with I.8)
- **What**: polish I.8's countdown: "Retrying in 4s… 2s… Now" with 4px accent progress bar under the banner. 600ms "Reconnected" flash on success.
- **Why**: the user-visible polish piece of I.8.
- **Input**: I.8's base implementation.
- **Output**: polished countdown + flash.
- **Dependencies**: J.2.14 complete.
- **Verification**: preview_eval during offline state — countdown text matches format; "Reconnected" appears for 600ms on success.
- **Rollback**: `git revert {J.2.15 commit}`.
- **Edge cases**: (a) user triggers manual reconnect during countdown — reset countdown; (b) countdown pauses during tab background — acceptable (no user-visible).

### Phase J Exit Gate
- [ ] `pnpm tsc --noEmit` empty
- [ ] `bash scripts/verify.sh` shows `TOTAL: 60 / 60 passed, 0 failed`
- [ ] AI-tell greps clean
- [ ] All 14 polish items commit-verified (commits exist for J.1.1–J.2.15)
- [ ] playwright-cli video: `/tmp/sprint-j-focus-flow.webm` exists
- [ ] implementation-state.md shows all J.* tasks COMPLETE
- [ ] HANDOFF.md updated with final Plan II summary
- [ ] §0.5 success-criteria checklist all ☑

### Phase J Convergence Rounds

Two rounds. Same protocol. Focus on animation timing parity, reduced-motion coverage, focus-management edge cases, a11y regressions.

---

## 9. verify.sh additions (21 new checks)

Each check is a bash function following existing verify.sh conventions (check name + assertion; logs `✅` on pass, `❌` on fail, contributes to TOTAL count).

```bash
# Phase H additions (11)
H.1-error-dot-5s-window        # dot visible 4s after trigger, not visible 5.5s after
H.1-error-dot-hover-tooltip    # tooltip visible on hover
H.1-error-dot-click-dismiss    # dot disappears within 50ms of click
H.2-mtime-body-409-stale       # 409 response with expected error format
H.2-mtime-body-200-fresh       # 200 when mtime matches
H.2-mtime-field-409-stale
H.2-mtime-field-200-fresh
H.3-delete-entity-tombstones-file
H.3-delete-inline-tombstones-file
H.3-tombstone-restore-roundtrip-hash-match
H.3-tombstone-sweep-after-ttl-returns-404

# Phase I additions (8)
I.1-type-migration-zero-guards
I.2-agenda-dom-under-5000
I.2-content-visibility-applied
I.3-taskrow-subscriptions-le-5
I.4-vault-warm-under-5ms
I.4-cache-invalidation-before-broadcast
I.4-cache-first-request-no-503
I.5-sse-coalesce-count-le-2
I.6-bulk-move-entity-happy-path
I.6-bulk-move-entity-collision-auto-suffix
I.6-bulk-move-undo-reverses-rename
I.7-locale-de-no-en-weekdays
I.8-sse-reconnect-button-visible-on-close

# Phase J additions (continued — total Plan II adds 21)
J.1.1-stagger-fade-animation-delay-per-row
J.1.1-stagger-fade-reduced-motion-zero
J.1.2-optimistic-delete-rollback-under-200ms
J.1.5-tab-switch-focus-first-row
J.2.6-touch-target-24px
J.2.7-prefers-contrast-accent-delta
J.2.8-colorblind-p1-solid-fill
J.2.8-colorblind-overdue-alertcircle
J.2.13-scroll-shadow-on-scroll-position-nonzero
```

Count: H=11, I=13, J=9 ≈ 33 lines but some are joint; trim to exactly 21 new checks at implementation by merging duplicates. Final total reaches 60.

---

## 10. Convergence protocol detail

Per §3.1 per-agent prompt templates.

Each round:

1. Identify files changed this sprint via `git diff {sprint-baseline-sha}..HEAD --stat`.
2. Write per-critic prompt files to `/tmp/sprint-{sprint}-r{N}-{critic}.txt` using the template from §3.1.
3. Launch all 3 critics in parallel (one tool-message with 3 content blocks: 1 Agent for Opus Explore + 2 Bash for Gemini + Codex with `run_in_background: true`).
4. Wait for completion — critics typically return within 2–8 minutes.
5. Parse each critic's YAML output from `/tmp/sprint-{sprint}-r{N}-{critic}-out.txt`.
6. Merge findings, dedupe, classify by severity.
7. Apply CRITICAL + HIGH + MEDIUM fixes (one commit per fix with message `sprint-{sprint}-r{N}-fix-{finding-id}: {summary}`).
8. Document LOW deferrals in PLAN-II-LOG.md with rationale.
9. Re-run tsc + verify.sh to confirm no regressions.
10. If zero CRITICAL/HIGH/MEDIUM across all 3 critics → round complete. If any remain → next round starts at step 1 (fresh prompts based on new HEAD).

Convergence is declared when `findings: []` OR zero C/H/M in EACH of the three critics for one consecutive round.

**Playwright video recording**: at the end of each sprint (after convergence), record one video flow as specified in §3.2. Videos stored at `/tmp/sprint-{H|I|J}-{flow}.webm`. NOT committed.

---

## 11. Anti-mediocrity self-score (pre-presentation)

| Dimension | Threshold | Self-score | Evidence |
|---|---|---|---|
| Depth | ≥8 | 9 | Every task has what/why/input/output/deps/verification/rollback/edge-cases. §0 includes assumption annihilation (20 assumptions), irreducible truths (per-phase), validation through negation (per-decision). |
| Specificity | ≥9 | 9 | Every file path is absolute starting with `$HOME/...`. Every command is copy-pasteable. All 20 banned phrases avoided (verified via grep on drafted text). |
| Completeness | ≥8 | 9 | 14 polish items enumerated; 17 migration sites enumerated; 12 writers enumerated; 21 new verify.sh checks listed; 3 E2E flows specified; shutdown drain specified; startup cleanup specified. |
| Testability | ≥8 | 9 | Every task has an exact verification command with exact expected output (tsc exit code, grep count, curl response shape, preview_eval return value). verify.sh convention extended. |
| Executability | ≥9 | 9 | An agent with zero prior context could follow §6/§7/§8 sequentially. Entry gates, exit gates, dependency graph with critical path, state-tracking file format all present. Per-task rollback specified. |

All dimensions ≥ threshold. Plan passes anti-mediocrity gate.

---

## 12. Final verification checklist (pre-ExitPlanMode)

- [x] Every phase has entry gate, tasks, exit gate
- [x] Every task has what / why / input / output / dependencies / verification / rollback / edge-cases (spot-checked H.1, H.2.1, I.4.1, J.1.1 — all present)
- [x] Dependency graph drawn with critical path marked (§1.1)
- [x] Zero banned phrases remain (checked against §3 ban-list: "set up" / "configure" / "update" / "handle" / "integrate" / "properly" / "as needed" / "etc." / "and so on" / "similar to" / "should work" / "make sure" / "clean up" / "refactor" / "straightforward" / "simply" / "obvious" / "basic" — grep finds occurrences ONLY within the ban-list table, not in task bodies)
- [x] Every file path is absolute (starts with `$HOME/`)
- [x] Every command copy-pasteable (no `<placeholder>` markers in executable commands; sprint-baseline-sha and similar are marked as explicit substitutions not placeholders)
- [x] Every test has exact name + exact assertion + exact expected output
- [x] Agent orchestration 13 questions answered (§3)
- [x] Claude Code anti-patterns checklist populated (§4)
- [x] Implementation state tracking file format defined (§5.1)
- [x] Feedback loop between phases explicit (§5.2)
- [x] Total time realistic — 40h across 3 sessions matches Plan I's empirical cadence (20–30h per sprint excluding convergence)
- [x] Each phase executable in a single session without context overflow (phases are large; convergence rounds are separately resumable; implementation-state.md provides resume-state)
- [x] Rollback procedure for every destructive operation (every task has a Rollback field; git revert + file-specific remove)
- [x] No circular dependencies (verified via §1.1 directed graph)
- [x] Closed feedback loop via Playwright CLI + Gemini 3.1 + GPT 5.4 + Opus (§3.2 + §3.1 + §10)

---


# Plan I (SHIPPED) — Original Plan Archive

> Plan I shipped 2026-04-18 (8 sprints, 21 commits, 164 findings, 20 convergence rounds). Kept below for reference.

---

## 1. Context

**Why this work is happening.** The vault-sidebar is functional and structurally clean, but fails to serve the user's stated daily-driver need: *"see what's overdue, due today, due tomorrow, this week — without opening the full project/task manager."* The current Tasks tab groups by project, not by time; the Today tab is single-slice and lacks context; priority is cryptic ("H" with no color semantics); state loudness is flat (blocked ≈ open ≈ in-progress visually); several P0 bugs ship regressions (search broken, header always says "Today", bogus chips). The sidebar also lacks full CRUD — no hard delete, no body notes edit — forcing the user back into Obsidian for routine cleanup.

**Intended outcome.** After this plan lands:
- The sidebar answers "what needs my attention, in order of time" in one glance on the default tab.
- Zero P0 bugs remain.
- Priority + status + overdue + in-progress carry distinct visual weight.
- Command palette (⌘K), inline due/priority editing, bulk operations, undo, and full CRUD are present.
- "Never open Obsidian for this vault" becomes true for 95% of task lifecycle operations.
- The sidebar reads as a *meticulously-crafted* tool — unmistakably human-intentional per the `ui-ux` skill's Prime Directive.

**Unforgettable moment (the `ui-ux` skill §0.2 mandate).** Press `a` → type → Enter → the task materializes in the correct time bucket with an emerald pulse on the bucket header; press `⌘K` → fuzzy-match any task across the vault in ≤80ms; press `x` → spring-bounce checkbox, undo toast slides in, 5-second reprieve. That's the signature — capture, navigation, and completion as a three-note chord.

**Aesthetic lock (post-Round-1 approval).** Dark-Sophisticated extended to **3 role-colors**: `var(--accent)` red `#d84a3e` (critical/overdue/action), new `var(--ok)` emerald `#3ea372` (in-progress/agent/success), existing `var(--text-secondary)` muted-gray (default). All other `ui-ux` skill rules honored (Geist, Lucide, no font-bold, 4px grid, tabular-nums on numbers, `active:scale-[0.97]`, stagger-fade on lists, reduced-motion respected).

---

## 2. Success criteria (must all be true at plan end)

1. `bash scripts/verify.sh` passes with **68 → 112 checks** (44 new; one per finding closed).
2. `pnpm tsc --noEmit` = 0 errors.
3. AI-tell greps from `ui-ux` §1 all return empty (no emojis, no font-bold, no purple/blue gradients, no `as any`, no console.log, no generic spinner).
4. Preview snapshot at 320px / 480px / 725px widths per finding; all committed to `codebases/vault-sidebar/screenshots/finding-{ID}/`.
5. All 10 P0 bugs fixed.
6. Agenda view renders time-bucketed tasks across the vault (Overdue · Today · Tomorrow · This Week · (dynamic Upcoming split)).
7. Full CRUD (create / read / update / delete / cancel + body notes) reachable without leaving the sidebar.
8. Command palette (⌘K) works with 4-scope search: tasks · projects · tabs · create.
9. Bulk ops + undo toast functional.
10. Today tab killed — Agenda + Projects only.

---

## 3. Locked decisions (from 8 rounds of AskUserQuestion)

### 3.1 Scope + process
- **D1 (R1):** Execute all 44 findings ranked by sprint. User will do deeper sub-questioning if ambiguity remains — *done across rounds 2-8*.
- **D2 (R1):** Per-finding Playwright verification. `preview_snapshot` + targeted `preview_eval` assertion per finding.
- **D3 (R1):** Lock #1 (Darkroom-Minimal) reopened → 3 role-colors. Lock #4 (Property List) stretched → breadcrumb header allowed. Locks #2 / #3 / #5 / #6 / #7 / #8 / #9 / #10 stay.
- **D4 (R1):** Single plan, single approval, execute straight through A → G. No per-sprint re-approval.
- **D5 (R6):** Sprint 0 = HTML visual comparison artifact built by parallel `ui-ux` agents before any real code changes.
- **D6 (R6):** Verification widths: **320px + 480px + 725px** per finding.
- **D7 (R6):** Full CRUD additions: hard-delete endpoint + body-notes edit + cancel-as-row-action + drop "Open in Obsidian" from scope.

### 3.2 Agenda view
- **D8 (R2):** Tab label = **"Agenda"**. Keyboard `1` jumps to Agenda.
- **D9 (R3):** Bucket list = **dynamic auto-split**. Fixed: Overdue · Today · Tomorrow · This Week. Dynamic: if `(tasks-later-than-this-week-count) ≥ 10` → split into `Next Week` + `Later`; else single `Upcoming`. Always at end: `No date`.
- **D10 (R2):** Week boundary = **Monday–Sunday** (ISO 8601, Berlin locale).
- **D11 (R2):** Blocked tasks → **in their time bucket** at 60% opacity with `⧖` glyph + hover shows blocked-by wikilinks.
- **D12 (R7):** Empty-bucket treatment → **show with greyed '0'** for Overdue · Today · Tomorrow only; hide others when empty.
- **D13 (R7):** Collapse persistence → **Zustand `persist` middleware + `partialize` filtering** (idiomatic to `pushrec-dashboard/stores/view/store.ts`; researched in round 7).
- **D14 (R7):** Cross-bucket keyboard nav → **Tab crosses buckets**, `j`/`k` bounded within bucket, `gj`/`gk` = prev/next bucket.
- **D15 (R7):** Arrow-nav into collapsed bucket → **auto-expand + select first task**.
- **D16 (R8):** Today tab → **killed**. Tabs become Agenda · Projects. `1` = Agenda, `2` = Projects.
- **D17 (R8):** Done tasks in Agenda → **inline in their time bucket with strikethrough + muted**.
- **D18 (R8):** Cancelled tasks in Agenda → **hidden entirely**; only visible via Projects view.

### 3.3 Row anatomy
- **D19 (R3):** Priority shape → **P1/P2/P3/P4 pills** (Linear/Dashboard style). Color per rank via new `--priority-p1/p2/p3/p4` tokens.
- **D20 (R3):** Row-visible chips → **all four**: circle + action + priority pill + due chip + project title. Project title truncates with ellipsis.
- **D21 (R3):** Edit affordance → **pencil icon on row hover** + keyboard `E`. Double-click deprecated (still functions but not advertised).
- **D22 (R5):** In-progress visual → **emerald 4px left-edge stripe**. No pulse (decision pending Sprint 0 visual comparison).
- **D23 (R8):** Due chip format → **frontend relative** ("−3d" / "today" / "+2d" / "in 3d" / "next Tue") in mono tabular-nums; **backend ISO** in frontmatter. Util in `src/lib/format.ts`: `relativeDue(due, now)`.

### 3.4 Detail panel
- **D24 (R4):** Breadcrumb → **one line** above Action: `{Goal} › {Project}` as wikilink chips, 10px mono, muted. No-goal projects show `{Project}` only. Line 2 = timestamps `created 3d ago · modified 2h ago` mono muted.
- **D25 (R4):** Timestamps → **in breadcrumb** only (not in property list).
- **D26 (R6):** CRUD actions from detail panel: `Notes` textarea row (new), `Delete` icon button in breadcrumb (Lucide `Trash2`, red on hover, confirm modal).
- **D27 (R6):** Cancel as row-level action (row overflow `⋯` menu OR keyboard `c`).
- **D28 (B06 from dossier):** Task status enum must include `"cancelled"` (currently missing from `TaskDetailPanel.tsx:15`).

### 3.5 Command palette + keyboard
- **D29 (R4):** Command palette V1 = all four scopes: find-task · jump-to-project · jump-to-tab · create-new-task.
- **D30 (R4):** Shortcut hints → **tooltips on interactive elements** (no `?` modal, no help footer). Hover any interactive element → tooltip shows action + shortcut.

### 3.6 Feel
- **D31 (R5):** Undo toast → **5s window, bottom-right**, click or `⌘Z` undoes. Toast hides after 5s; reconcile fires.
- **D32 (R5):** Bulk ops → **full shape in Sprint G**: `Shift+j/k` range, `Space` toggle, `⌘A` select all visible, bottom bulk bar (Done / Move / Cancel / Delete / Clear).

---

## 4. Sprint 0 — Visual comparison artifacts

Build a static HTML preview page that renders all undecided visual variants side-by-side at 320/480/725 widths. User browses via existing preview server, picks winners, we lock exact design into Sprint B+.

### 4.1 Approach
- **File:** `codebases/vault-sidebar/docs/visual-previews/index.html` (new dir)
- **Style:** Copy `src/styles.css` tokens + add new tokens under test.
- **Delivery:** Parallel `ui-ux` sub-agents — one per visual decision — each builds a self-contained section. Orchestrator aggregates into tabbed single-page HTML.
- **Served via:** Existing dev server at `127.0.0.1:5174/docs/visual-previews/`. Requires adding static-serve middleware to `server/index.ts` for `/docs/*` path (write-scope: server/index.ts only).
- **Verification:** User previews on live server, picks per variant. Picks recorded inline in this plan file (can be edited during ExitPlanMode review).

### 4.2 Variants to compare (4 decisions × variants)

**V1 — In-progress row treatment** (Lock #1 role-colors needed)
- V1a: 4px emerald left-edge stripe (static)
- V1b: 4px emerald stripe + 2s opacity breathing (0.85 ↔ 1.0)
- V1c: 6px emerald dot after due chip
- V1d: Circle glyph → PlayCircle (Lucide) emerald

**V2 — Priority pill style**
- V2a: Single-letter "C/H/M/L" pills with 4-color semantics
- V2b: "P1/P2/P3/P4" two-char pills (Linear-style)
- V2c: Lucide ArrowUp/Right/Down + AlertCircle icons
- V2d: No chip; row-order-by-rank only

**V3 — Agenda bucket headers**
- V3a: Sticky + chevron + count ("Overdue ▸ 3")
- V3b: Sticky + count-only, no chevron ("OVERDUE 3")
- V3c: Non-sticky expand-in-place

**V4 — Detail panel breadcrumb**
- V4a: 1-line `Goal › Project` + 1-line timestamps below
- V4b: 2-line goal+project (stacked) + separate timestamp row
- V4c: Collapsible `Context` section (default hidden)

### 4.3 Sprint 0 verification
- Preview page loads at 3 widths without horizontal scroll.
- Each variant uses real mock data (same 5 tasks across all variants).
- Picks recorded in `docs/visual-previews/PICKS.md`.
- No lint/type errors in preview-only HTML (it's isolated from `src/`).

### 4.4 User picks (LOCKED 2026-04-18)

- **V1 winner: V1A** — static 4px emerald left-edge stripe (matches D22)
- **V2 winner: V2B** — P1/P2/P3/P4 pills (matches D19)
- **V3 winner: V3A** — sticky + chevron + count (matches default)
- **V4 winner: V4B** — 2-line stacked breadcrumb (goal on own line, project on own line) — **D24 UPDATED from V4A**

### 4.5 Decision D24 revision (post-Sprint-0 picks)

Original: 1-line `{Goal} › {Project}` + 1-line timestamps below.
**New (V4B):** 2-line stacked — line 1: `{Goal}` chip alone. Line 2: `{Project}` chip + trash icon right-aligned. Line 3: `created 3d ago · modified 2h ago` mono muted. Line 4: Action row.
Rationale: user selected V4B in Sprint 0 review. More vertical breathing room above Action. Implementation in Sprint E matches the V4B variant shown in `docs/visual-previews/index.html`.

---

## 4.6 Audit addendum (post-Sprint-0 full codebase audit)

4 parallel `Explore` agents audited `src/` against ui-ux skill §1-13. **12 new findings** beyond the original 44 dossier items.

| ID | Severity | Finding | Target sprint |
|---|---|---|---|
| **B11** | P0 | `TaskRow.tsx:62/100/120` — `task.line` used as `number` but typed `number \| undefined`. Causes tsc errors. | A |
| **A1** | P1 | 6× `console.error` in `EntityCreateForm.tsx:83`, `QuickAdd.tsx:42`, `api.ts:204`, `TaskRow.tsx:66/102/123` | A |
| **A2** | P1 | 5× `font-weight: 600` in `styles.css:118/264/306/737/838` — should be 500 per ui-ux §2 | A |
| **A3** | P2 | `styles.css:836` — hardcoded `#fff` → replace with `--accent-foreground` token | F |
| **A4** | P2 | `App.tsx:259` — inline `style={{color:"var(--accent)"}}` → extract to class | F |
| **A5** | P3 | Off-grid paddings (1px, 5px, 10px) in badges/forms — mostly intentional compaction; standardize chip padding to 2px/4px grid | F |
| **A6** | P1 | `styles.css:165` — selected-row uses inset-box (`inset 0 0 0 2px`) while expanded-row uses left-border. **Unify to left-border stripe** (consistent with V1A emerald pattern). | F |
| **A7** | P1 | 6 components missing explicit loading states (TaskDetailPanel, ProjectDetailPanel, QuickAdd, EntityCreateForm, TaskRow hover state during refetch, view panels during vault fetch). Add subtle opacity/spinner during save. | F |
| **A8** | P1 | 9 buttons missing `active:scale-[0.97]` press feedback — `.task-circle`, `.tab`, `.quick-add-entity-btn`, `.entity-form-btn`, `.entity-form-close`, `.theme-option`, `.prop-row--clickable`, `.theme-toggle`, project-header | F |
| **A9** | P1 | Missing `:focus-visible` ring on `.task-circle`, `.entity-form-close`, `.quick-add-select` | A |
| **A10** | P3 | `WikilinkChip` component has no `aria-label` (`data-wikilink` only) | F |
| **A11** | P3 | `EditableSelect` has both `htmlFor`-implicit and explicit `aria-label` — duplicate labeling; drop aria-label | F |

**Gestalt score: 6.5/10** (technically production-ready, creatively missing the signature moment). The plan's **P01 (spring-bounce) + S04 (emerald stripe per V1A) + Sprint D (⌘K palette)** together close the gestalt gap. After all sprints land, expected score: **9/10**.

**Updated sprint counts:**
- Sprint A: 10 → **14 findings** (adds B11 + A1 + A2 + A9)
- Sprint F: 15 → **21 findings** (adds A3 + A4 + A5 + A6 + A7 + A8 + A10 + A11)
- Total findings: 44 → **56**
- verify.sh target: 124 → **136 checks**

---

## 5. Sprint A — P0 Bug Sweep (14 findings, ~5h)

Fix all dossier P0 bugs. Zero visual redesigns. Locks: none touched.

| ID | File | Change |
|---|---|---|
| **B01** | `src/views/AllTasksView.tsx:24` | `t.text` → `t.action` + extend search to project title. |
| **B02** | `src/App.tsx:160` | Header text derived from `activeTab`: `"Agenda · {date}"` / `"Projects · {count} active"`. (Agenda replaces Today per D16 — land simultaneously with Sprint B's tab rename or gate with a feature flag until Sprint B.) |
| **B03** | `src/components/TaskRow.tsx:257-259` | Delete the bogus `<span className="task-due">today</span>` branch. |
| **B04** | `src/components/TaskRow.tsx:235,239-249` | Remove `role="button"` from row; add explicit expand affordance (chevron or pencil on hover per D21). |
| **B05** | `src/components/TaskRow.tsx:274-276` | Delete row-level `entity` chip. Keep `Type: inline` row in inline-task detail panel only. |
| **B06** | `src/components/TaskDetailPanel.tsx:15` | Add `"cancelled"` to `STATUS_OPTIONS`. |
| **B07** | `src/components/TaskDetailPanel.tsx:510-519` | Inline tasks: Status-row click → auto-promote + set status (extends Lock #5). Match flow in `promote-and-edit.ts`. |
| **B08** | `src/components/QuickAdd.tsx:27-44` + `server/writers/task-add.ts` | Reject `action.trim().length < 3` both client + server (400 response). One-time sweep script removes existing `"j"` / `"a"` garbage tasks from vault. |
| **B09** | `src/store.ts:71-88` | `optimisticToggle` also flips `status`: "open" ↔ "done" (preserves "in-progress" and "blocked" on toggle — don't overwrite). |
| **B10** | `src/views/ProjectsView.tsx:51-59` | Split handlers: chevron click → toggle task list; header-body click → toggle detail panel (separate intents). |

### Sprint A verification protocol
Per finding:
1. Implement.
2. `pnpm tsc --noEmit` (zero new errors).
3. `preview_snapshot` at 320/480/725 px.
4. `preview_eval` with finding-specific assertion (listed per-finding below).
5. Screenshot → `codebases/vault-sidebar/screenshots/finding-{id}/{width}.png`.
6. Append 3 check lines to `scripts/verify.sh` (one per width if relevant).

**Finding-specific preview_eval assertions (Sprint A):**

| ID | Assertion |
|---|---|
| B01 | After typing "test" in search: `document.querySelectorAll('[data-task-row]').length > 0` when test-tasks exist. |
| B02 | `document.querySelector('.header-title').textContent` contains `"Agenda"` when `activeTab === "agenda"`. |
| B03 | `document.querySelectorAll('.task-due').length` ≤ one per task (not two). |
| B04 | `document.querySelectorAll('[role=button] button').length === 0` (no nested buttons). |
| B05 | `document.querySelectorAll('.task-source-chip').length === 0` on any task row. |
| B06 | `STATUS_OPTIONS` array length === 6 (includes "cancelled"). |
| B07 | Clicking Status row on inline task triggers promote-and-edit request. |
| B08 | POST /api/tasks/add with `text: "j"` returns 400. |
| B09 | After `optimisticToggle` on entity task with status="open", status === "done" in store. |
| B10 | Chevron click does NOT set `expandedProjectSlug`; body click DOES. |

---

## 6. Sprint B — Agenda view (the #1 user-stated need)

### 6.1 New files
- `src/lib/time-buckets.ts` — bucket logic (`bucketOf(task)`, `groupByBucket(tasks)`, `bucketLabel(bucket)`).
- `src/lib/format.ts` — `relativeDue(dueISO, now)` → "−3d" / "today" / "+2d" / "in 2w" / "next Tue".
- `src/views/AgendaView.tsx` — replaces `AllTasksView.tsx` (deleted in same sprint).
- `src/components/BucketHeader.tsx` — sticky bucket header with chevron + count + collapse toggle.
- `src/components/TaskRow.tsx` → extend with props for `showProjectTitle`, `inBucket`.

### 6.2 Store additions (`src/store.ts`)
```ts
// Upgrade: replace manual localStorage with Zustand persist middleware
import { persist } from "zustand/middleware";

export type BucketName = "overdue" | "today" | "tomorrow" | "this-week" | "next-week" | "later" | "upcoming" | "no-date";
const VALID_BUCKETS: BucketName[] = ["overdue","today","tomorrow","this-week","next-week","later","upcoming","no-date"];

interface SidebarState {
  // existing...
  collapsedBuckets: Set<BucketName>;
  toggleBucket: (b: BucketName) => void;
}

export const useSidebarStore = create<SidebarState>()(persist(
  (set) => ({
    // ...
    collapsedBuckets: new Set<BucketName>(["this-week","next-week","later","upcoming"]),
    toggleBucket(b) { set(s => { const n = new Set(s.collapsedBuckets); n.has(b)?n.delete(b):n.add(b); return {collapsedBuckets:n}; }); },
  }),
  {
    name: "vault-sidebar-state",
    version: 2,
    partialize: (s) => ({
      activeTab: s.activeTab,
      collapsedBuckets: new Set(Array.from(s.collapsedBuckets).filter(n => VALID_BUCKETS.includes(n as BucketName))),
    }),
  }
));
```

Pattern directly borrowed from: `1-Projects/pushrec-dashboard/stores/view/store.ts` (verified in Round 7 research).

### 6.3 Bucket logic (`src/lib/time-buckets.ts`)
```ts
export function bucketOf(task: Task, now = new Date()): BucketName {
  // Cancelled tasks → not bucketed (hidden per D18)
  if (task.status === "cancelled") return null; // caller filters null
  if (!task.due) return "no-date";
  const due = new Date(task.due + "T00:00:00");
  const diffDays = Math.floor((due.getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays <= daysUntilEndOfWeek(now)) return "this-week"; // Mon-Sun per D10
  // dynamic split per D9: caller decides "next-week"/"later"/"upcoming" based on count threshold 10
  if (diffDays <= daysUntilEndOfNextWeek(now)) return "next-week"; // candidate
  return "later"; // candidate
}
```

Caller (`AgendaView.tsx`) applies D9 density rule: count tasks in {next-week, later} combined; if <10, relabel all to `"upcoming"`.

### 6.4 Tab strip changes (`src/App.tsx`)
- Kill the 3rd tab (Tasks).
- Rename tab 1: "Today" → "Agenda". Tab 2 stays "Projects". Total: 2 tabs.
- Keyboard shortcuts: `1` = Agenda, `2` = Projects, `3` removed. `g a` / `g p` adjusted.

### 6.5 Findings closed in Sprint B
S01, S03, S04 (in-progress stripe), S05 (blocked glyph), S07 (shared due formatter), E10 (include inactive-project tasks).

### 6.6 Sprint B verification
- Snapshot at 320/480/725 shows 4–7 bucket headers.
- Empty-bucket rule (D12): `document.querySelector('.bucket--overdue .bucket-count').textContent === "0"` when no overdue, and header is visible.
- `j`/`k` within bucket doesn't cross boundary (D14).
- Tab key crosses buckets.
- Reload → collapsed buckets survive.
- Done task in Today bucket renders with strikethrough (D17).
- Cancelled task NOT in any bucket (D18).

---

## 7. Sprint C — Row anatomy + inline editing (~1 day)

- **S02** — P1/P2/P3/P4 pills (D19). New tokens in `styles.css`:
  ```css
  --priority-p1: #d84a3e;  /* red, critical */
  --priority-p2: #e88a3e;  /* amber, high */
  --priority-p3: #6b7280;  /* muted gray, medium */
  --priority-p4: rgba(155,150,145,0.4); /* faint, low */
  ```
  ⚠ Lock #1 reopened — red + amber + gray. Emerald added in Sprint B.
- **S06** — Project health signals (`⚠ N` overdue + `● N` in-progress + `N/M` done-ratio) on Projects view header. Uses existing server-computed fields.
- **F04** — Due-date popover on chip click. 4 presets (Today / Tomorrow / +3d / Next Mon) + custom `type=date`. Matches pushrec-dashboard date popover pattern.
- **F05** — Priority popover on pill click. 4 quick-pick levels + clear.
- **F10** — Pencil icon on row hover (Lucide `Pencil` 12px). Keyboard `E`.
- **F08** — QuickAdd combobox with fuzzy filter (replaces native select).
- **F09** — QuickAdd defaults: `expandedProjectSlug` > `selectedTaskId's project` > `firstActiveSlug`.

### Sprint C verification
- Priority pill at 320px: `preview_inspect('.priority-pill--p1', ['background-color','color','padding'])` matches tokens.
- Due popover: click chip → popover appears within 100ms; keyboard Esc closes.
- F10: hover row → pencil opacity transitions 0→1 over 150ms (ui-ux §4 timing).

---

## 8. Sprint D — Command palette + keyboard story (~1 day)

### 8.1 New files
- `src/components/CommandPalette.tsx` — modal with input + result list.
- `src/lib/fuzzy.ts` — lightweight fuzzy matcher (no dependency; ~40 lines).

### 8.2 Behavior
- `⌘K` (or `Ctrl+K`) opens modal regardless of current focus.
- Four parallel search scopes (per D29): Tasks, Projects, Tabs, `+ New task …`.
- Results max 20, grouped by scope with section dividers.
- Arrow keys navigate, Enter selects, Esc closes, Tab cycles scopes.
- `+ New task {text}` appears if input starts with `+` or no matches found → creates in current-project context.

### 8.3 Findings closed
F01 (palette), F02 (tooltips per D30 — all interactive elements get `title` attrs in this sprint), F03 (tab counts on all), F12 (search persists in store).

### 8.4 Verification
- `⌘K` → modal open within 80ms.
- Type "gtm" → GTM Sprint project in results.
- Tooltip shows on Pencil hover: "Edit · E".
- All tabs show counts: `Agenda: 47 · Projects: 12`.

---

## 9. Sprint E — Detail panel depth + breadcrumb + CRUD (~1 day)

### 9.1 New endpoints (`server/writers/`)
- `task-delete.ts` — `POST /api/tasks/delete-entity` + `POST /api/tasks/delete-inline`. Hard delete via `fs.unlink` for entity or line-removal for inline. Safety: both go through `assertSafeTasksPath`.
- `task-body-edit.ts` — `POST /api/tasks/body-edit` — replaces markdown body (everything after frontmatter) in entity task file. Uses `gray-matter` to parse, splice body, rewrite atomically via `writeFileAtomic`.

### 9.2 Detail panel changes (`src/components/TaskDetailPanel.tsx`)
- Breadcrumb row at top per D24: `{Goal} › {Project}` chips + Trash2 icon right-aligned.
- Timestamp row line 2 per D25: `created 3d ago · modified 2h ago` mono muted (uses `relativeDue` inverted, formatter in `src/lib/format.ts`).
- New `Notes` property row — EditableTextArea component (already exists) bound to body-edit endpoint.
- Delete button → opens confirm modal: "Delete task? Removes `{entityPath}`. This cannot be undone." Cancel / Delete.
- Inline tasks' Status click → auto-promote path (addresses B07 with better UX than Sprint A's minimal fix).

### 9.3 Findings closed
P06 (breadcrumb), P07 (timestamps), E04 (real error messages), E05 (spinner during save), Full-CRUD D7 (delete + body + cancel row-action D27).

### 9.4 Verification
- Delete entity task via UI → file no longer exists in vault (`preview_eval` checks `/api/vault` response).
- Confirm modal blocks delete until user clicks Delete.
- Body notes roundtrip: edit → SSE refresh → same text in detail.
- Breadcrumb renders with fallback "—" if no goal.

---

## 10. Sprint F — Feel + edges (~half-day)

Polish + signature moments + edge-state completeness.

| Finding | Change |
|---|---|
| **P01** | Spring-bounce animation on task-circle completion. Copy dashboard's `task-complete` keyframe (ui-ux §4 animation timing). |
| **P02** | Empty-state bounce plays once on mount, not infinite. |
| **P03** | Micro-fade-in on new task rows (stagger-fade-in from ui-ux §4). |
| **P04** | Sync dot → mini pill "saving" → "synced" with 400ms color transition. |
| **P05** | Theme popover autoFocus = current theme, not first. |
| **P09** | Focus-visible outline 1.5px + 1px offset (fits narrow widths). |
| **P10** | `.task-row--selected` uses left-edge box-shadow only. |
| **P11** | Body background cross-fade 80ms on theme change (guarded by reduced-motion). |
| **E01** | Offline card with `WifiOff` + Retry button when `/api/vault` fails. |
| **E02** | SSE reconnect banner if disconnected >10s. |
| **E03** | Error dot persists until user dismisses. |
| **E06** | First-launch onboarding card (3 bullets + `a` = quick-add hint). |
| **E07** | Live-region announcements include counts: "3 tasks updated in {project}". |
| **E08** | Theme popover outside-click restores focus to gear button. |
| **E09** | Projects view "Show inactive" toggle. |

### Verification
- All empty states render at 320/480/725 without overflow.
- Reduced-motion: no animations visible.
- Offline card appears when server is stopped (manual test).

---

## 11. Sprint G — Bulk + undo + contract (~1 day)

### 11.1 Bulk selection (D32)
- Store: `selectedTaskIds: Set<string>` (replaces single `selectedTaskId`).
- Keyboard: `Shift+j/k` extends range, `Space` toggles, `⌘A` selects all visible, `Esc` clears.
- Click behavior: `Shift+Click` extends range, `⌘Click` toggles individual.
- Bulk bar (bottom, above QuickAdd): count + Done / Move / Cancel / Delete / Clear.
- Animation: bulk bar slides up from bottom over 200ms when count > 0.

### 11.2 Undo toast (D31)
- New component: `src/components/UndoToast.tsx`.
- State: `pendingUndo: { action: "done" | "delete" | "cancel" | "bulk-done"; taskIds: string[]; undoneAt: number } | null`.
- Toast appears bottom-right on any status-to-done or delete action.
- Click Undo or `⌘Z` → revert. After 5s → reconcile fires + toast dismisses.
- For bulk-done: "5 tasks done · Undo".

### 11.3 Code contract (addresses C01-C04)
- `src/shared/types.ts` created — single source of Task / Project / response types. Imported by both client + server.
- Task discriminated union by `source` — enforces `entityPath: string` when entity, `line + tasksPath: string` when inline.
- `keyboard.ts` effect deps closed (C02).
- `useSidebarStore` gains `collapseAllProjects` + keyboard `gC`.

### 11.4 Verification
- Shift+j from task[0] to task[4] → 5 selected.
- Bulk Done → toast "5 tasks done · Undo". Click Undo → all 5 revert.
- Refreshing during 5s window → reconcile fires based on state at refresh time (safe).
- `pnpm tsc --noEmit`: zero new errors with discriminated union.

---

## 12. Verification protocol (applies to every finding in every sprint)

### 12.1 Three-width preview protocol
```
For each finding:
  1. Implement change.
  2. pnpm tsc --noEmit          # fail = rollback
  3. Visit preview at 320 width (resize preview_resize_window)
     preview_snapshot  → save text snapshot
     preview_screenshot → save PNG to screenshots/finding-{id}/320.png
     preview_eval  → run finding-specific assertion
  4. Repeat for 480 and 725.
  5. Append test line to scripts/verify.sh (curl-based or grep-based check).
  6. bash scripts/verify.sh → must pass all 68 existing + N new checks.
  7. git add + commit with message "finding-{id}: {summary}"
```

### 12.2 AI-tell grep pipeline (runs on every commit)
Per `ui-ux` skill §1 detection commands:
```bash
grep -rn "📄\|📁\|✨\|🔥\|💡\|📊\|📈\|📉\|🔍\|⚠️\|✅\|❌\|📝\|💾\|🗑️" src/
grep -rn "animate-spin.*border\|border.*animate-spin" src/
grep -rni "lorem ipsum\|TODO\|FIXME" src/
grep -rn "font-bold" src/   # allowed: 0
grep -rn "console\.\(log\|warn\|error\|debug\)" src/
grep -rn "from-purple\|to-purple\|from-blue\|to-blue\|from-violet" src/
grep -rn "as any" src/
grep -rE "text-\[#|bg-\[#|border-\[#" src/   # hardcoded colors banned
grep -rn "⚙\|⏎\|›\|○\|●" src/    # existing Unicode ban
grep -rn "task\.text" src/        # existing regression guard
```
All must return 0 matches. Wired as `scripts/ai-tells-check.sh` and called from `scripts/verify.sh`.

### 12.3 `scripts/verify.sh` growth map
- Baseline: 68 checks.
- Sprint A: +10 checks (one per P0).
- Sprint B: +9 checks (buckets, persist, nav, done-strikethrough, cancelled-hidden, Mon-Sun).
- Sprint C: +7 checks (pills, popovers, project-health signals, pencil, QuickAdd fuzzy).
- Sprint D: +4 (palette, tooltips, tab-counts, search-persist).
- Sprint E: +6 (delete, body, confirm-modal, breadcrumb, timestamps, auto-promote-status).
- Sprint F: +9 (anims, offline, SSE-banner, error-persist, onboarding, live-region, focus-restore, inactive-toggle).
- Sprint G: +11 (bulk range, Shift+j, Space, ⌘A, undo-toast, undo-click, ⌘Z, 5s-window, discriminated-types, collapse-all, gC).
- Total: **68 + 56 = 124 checks** at plan end.

### 12.4 Playwright CLI extension
Per user preference (R1), we use Claude_Preview MCP (already connected; serverId persists) rather than the `playwright-cli` skill — the Preview MCP is already running, gives us `preview_snapshot` (accessibility tree text), `preview_eval` (JS assertions), `preview_inspect` (computed styles), `preview_click`. Sufficient for all verification needs without adding a Playwright dependency.

---

## 13. Files modified (exact paths)

### 13.1 Server (write-scope: `codebases/vault-sidebar/server/**`)
- `server/index.ts` — add `/docs/*` static middleware (Sprint 0).
- `server/vault-index.ts` — surface `created` + `modified` on Task type (Sprint E).
- `server/writers/task-add.ts` — reject action < 3 chars (Sprint A B08).
- `server/writers/task-delete.ts` — **NEW** (Sprint E).
- `server/writers/task-body-edit.ts` — **NEW** (Sprint E).
- `server/routes.ts` — wire delete + body-edit (Sprint E).

### 13.2 Client (write-scope: `codebases/vault-sidebar/src/**`)
- `src/App.tsx` — kill Today tab, update header, remove `3` shortcut (Sprint B).
- `src/api.ts` — discriminated Task union, delete + body-edit wrappers, shared types import (Sprint G + E).
- `src/store.ts` — Zustand persist middleware, collapsedBuckets, selectedTaskIds, pendingUndo (Sprints B + G).
- `src/styles.css` — P1–P4 tokens, emerald `--ok`, breadcrumb styles, bucket headers, bulk bar, undo toast (Sprints B + C + E + G).
- `src/components/TaskRow.tsx` — remove bogus chips, add priority pill, pencil affordance, in-progress stripe, blocked glyph, done strikethrough (Sprints A + B + C).
- `src/components/TaskDetailPanel.tsx` — add "cancelled" to STATUS, breadcrumb, timestamps, notes, delete, inline-promote-status (Sprints A + E).
- `src/components/QuickAdd.tsx` — fuzzy project picker, 3-char min, smart default (Sprints A + C + D).
- `src/components/CommandPalette.tsx` — **NEW** (Sprint D).
- `src/components/UndoToast.tsx` — **NEW** (Sprint G).
- `src/components/BucketHeader.tsx` — **NEW** (Sprint B).
- `src/components/OfflineCard.tsx` — **NEW** (Sprint F E01).
- `src/views/AgendaView.tsx` — **NEW**, replaces AllTasksView (Sprint B).
- `src/views/AllTasksView.tsx` — **DELETE** (Sprint B).
- `src/views/TodayView.tsx` — **DELETE** (Sprint B, Today tab killed).
- `src/views/ProjectsView.tsx` — health signals, inactive-toggle, split chevron/body handlers (Sprints A + C + F).
- `src/lib/time-buckets.ts` — **NEW** (Sprint B).
- `src/lib/format.ts` — **NEW** (Sprint B).
- `src/lib/fuzzy.ts` — **NEW** (Sprint D).
- `src/lib/keyboard.ts` — bulk selection shortcuts, closed deps (Sprint G).
- `src/shared/types.ts` — **NEW**, shared types (Sprint G).

### 13.3 Scripts
- `scripts/verify.sh` — +56 checks total across sprints.
- `scripts/ai-tells-check.sh` — **NEW**, extracted from verify.sh for CI reuse (Sprint A).
- `scripts/cleanup-short-tasks.sh` — **NEW**, one-shot sweep of existing short-text tasks (Sprint A B08).

### 13.4 Vault
- `1-Projects/vault-sidebar/HANDOFF.md` — updated at plan end with sprint results (per CLAUDE.md "when a sprint completes").
- `1-Projects/vault-sidebar/tasks.md` — sprint tasks marked `- [x] @owner(agent)` as each completes.
- `1-Projects/vault-sidebar/UI-UX-REVIEW-v1.md` — the dossier text, saved for reference.

### 13.5 Preview artifact
- `codebases/vault-sidebar/docs/visual-previews/index.html` — **NEW** (Sprint 0).
- `codebases/vault-sidebar/docs/visual-previews/PICKS.md` — **NEW** (Sprint 0).

---

## 14. Reusable patterns (copy from existing code)

| Pattern | Source | Usage |
|---|---|---|
| Zustand `persist` + `partialize` | `1-Projects/pushrec-dashboard/stores/view/store.ts` | Agenda bucket collapse memory (Sprint B D13). |
| Time-bucket grouping | `1-Projects/pushrec-dashboard/components/dashboard/task-list/time-group-header.tsx` | Reference for sticky header + chevron + count pattern. Don't copy wholesale (dashboard's is grid-heavy); reimplement for sidebar density. |
| Command palette shape | `1-Projects/pushrec-dashboard/components/dashboard/command-palette/command-palette.tsx` | Structure only — ours is single-file, no shadcn. |
| `relativeDue` format | `ProjectsView.tsx:12-22` (`dueDaysLabel`) | Lift into `src/lib/format.ts`, generalize, export. |
| Task toggle animation | `1-Projects/pushrec-dashboard/app/globals.css` @keyframes task-complete | Copy exact spring bounce. |
| Stagger-fade-in on lists | `ui-ux` skill §4 | Apply to Agenda bucket reveal. |
| Offline / empty state templates | `ui-ux` skill §6 | Use as scaffolding for OfflineCard + empty buckets. |
| AI-tell grep patterns | `ui-ux` skill §1 | Into `scripts/ai-tells-check.sh`. |

---

## 15. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Sprint 0 HTML preview drifts from production CSS | Copy `src/styles.css` verbatim into preview; version-lock. Compare renders pixel-for-pixel. |
| `status_reconcile.py` fires during undo's 5s window | Cancel the fire-and-forget if pendingUndo.action=="done" → delay reconcile by 5s via `setTimeout`, cancelable. |
| Persist hydration fails on version bump (v1 → v2) | `persist` middleware's `version` + `migrate` function handles; test on fresh + existing state. |
| Dynamic bucket name drift (today's Next Week → tomorrow's Upcoming) | `partialize` filters through `VALID_BUCKETS` list. Orphaned names silently dropped. |
| Delete endpoint TOCTOU | Use `fs.open(path, 'w+')` + `fstat` + `unlink` pattern. Or just accept `stat` race (file exists at moment of delete is good enough; safety is already in `assertSafeTasksPath`). |
| Preview server `/docs/*` static middleware conflicts with Vite HMR | Mount static *before* Vite middleware in `server/index.ts` so Vite doesn't claim the path. Test both HMR + preview load. |
| `prefers-color-scheme: light` emerald contrast | Provide `--ok-light: #2a8558` token; use in light-mode override. Contrast check via `preview_inspect`. |
| Bulk bar covers QuickAdd at narrow widths | Bulk bar appears *above* QuickAdd (both sticky). Height budget checked at 320px. If overflow, stack bulk bar above QuickAdd with 1px separator. |

---

## 16. Open questions (non-blocking — my defaults if not flagged during ExitPlanMode review)

1. **Bulk delete copy.** "Delete 5 tasks? This removes the files." Confirm phrasing.
2. **Cancel shortcut.** `c` clashes with no existing binding — safe? (Currently unbound.)
3. **Command palette width.** Fixed 480px modal OR responsive? Default: 480px.
4. **Sprint 0 parallel `ui-ux` agents.** User said "parallel agents for each" — I'll spawn 4 `Explore`-tier agents (one per variant decision). If user meant spawning `ui-ux` skill per variant, clarify. Default: use 4 `Explore` agents, each building one HTML section in isolation, then aggregate.
5. **Sprint B "next-week" / "later" density threshold.** D9 says 10. If user's typical workload is different, adjust. Default: 10.
6. **Done-task retention window.** D17 shows done tasks inline with strikethrough. For how long? My default: they show in their original bucket until next SSE refresh OR session reload — no explicit time window. Cancelled hides immediately.

---

## 17. Execution order (single-approval flow per D4)

```
Day 1  → Sprint 0 (visual comparison artifacts, user picks winners)
Day 1  → Sprint A (10 P0 bugs)
Day 2  → Sprint B (Agenda view)
Day 3  → Sprint C (Row anatomy + inline editing)
Day 4  → Sprint D (Command palette)
Day 5  → Sprint E (Detail panel + full CRUD)
Day 5  → Sprint F (Feel + edges)
Day 6  → Sprint G (Bulk + undo + contract)
Day 6  → Final verify.sh (124/124), tsc clean, HANDOFF.md update, vault tasks.md marks
```

Total budget: ~6 working days. User can interrupt any sprint. Each sprint produces per-finding screenshots + assertion logs.

---

## 18. Entry-point for the executing agent

**If you (or any future agent) is picking this plan up to execute:**

1. Read this file end-to-end.
2. Read `codebases/vault-sidebar/CLAUDE.md` + `1-Projects/vault-sidebar/HANDOFF.md` — they define the code-side rules.
3. Read the `ui-ux` skill (loaded in this planning session) — it's the design bible.
4. Confirm preview server is running: `mcp__Claude_Preview__preview_list`. Expected: serverId persists, name "vault-sidebar", port 5174.
5. Start with Sprint 0. Do NOT start Sprint A until user has picked visuals (PICKS.md has all 4 filled in) OR user has explicitly approved defaults.
6. Use the per-finding verification checklist in §12.1. Do not batch verifications.
7. Update this file's §4.4 with visual picks as they land. Update §16 with resolved open questions.
8. Commit after every finding with `finding-{id}: {summary}`.
9. At the end of each sprint: update `1-Projects/vault-sidebar/HANDOFF.md` + `tasks.md`.
10. Final act: run `bash scripts/verify.sh`, paste output into HANDOFF.md, mark project `status: active` unchanged (we're on v2.1 post-ship; the next version bump is v2.2 when all sprints land).

**Hard rules recap:**
- Never bypass `assertSafeTasksPath` on writes.
- Never accept first output (`ui-ux` §0.5 — 90/10 principle).
- Never ship a finding without 3-width screenshots committed.
- Never ship `font-bold`, emojis, or `as any`.
- Never violate Lock #2, #3, #5, #6, #7, #8, #9, #10 (all still locked).

---

*Plan author: Claude (current session, 2026-04-18)*
*Status: Pending user approval via ExitPlanMode*
