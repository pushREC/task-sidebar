# Decisions

> Flat machine-parseable index of every locked decision in task-sidebar. Claude Code agents grep this table to understand what's non-negotiable. Prose rationale lives in the adjacent doc files; this doc is the index.

**Tiers**:
- `architecture` — the 10 hard locks from `CLAUDE.md`. Changing any requires explicit user approval.
- `plan-ii` — the 7 Plan II decisions from the §0.4 locked-decisions block. Shaped the Safety Sprint (Sprint H).
- `plan-i` — the 28 Plan I decisions from the archive. Shaped the UI/UX Sprints (0→G).

**Source** — file:line where the decision is canonically stated. Grep these for the full context.

**Rationale** — one-line why-this-matters.

| id | tier | lock | source | rationale |
|---|---|---|---|---|
| A1 | architecture | Darkroom-Minimal aesthetic (both themes low-chroma, single accent) | `CLAUDE.md:L38` | `/ui-ux` skill §11 prime directive; prevents dashboard-chart-sprawl aesthetic drift |
| A2 | architecture | Geist Sans + Geist Mono via `@fontsource` | `CLAUDE.md:L39` | Shipping Geist inline avoids the system-ui AI-tell flagged in AI-tell grep battery |
| A3 | architecture | Lucide icons only, zero Unicode pseudo-icons | `CLAUDE.md:L40` | `⚙/⏎/›/○/●` render inconsistently across platforms, break dark-mode, trigger AI-tell grep |
| A4 | architecture | Property List detail panel (label-left, click-to-edit, `+ set X` placeholders) | `CLAUDE.md:L41` | User-tested density model from `pushrec-dashboard`; Lego-compatible with sidebar width constraint |
| A5 | architecture | Auto-promote inline→entity on first field edit (no Promote button) | `CLAUDE.md:L42` | User explicitly removed Promote button in detail-panel redesign — if you care enough to edit, the promotion is implied |
| A6 | architecture | Responsive body width (no fixed 340px, no resize handle) | `CLAUDE.md:L43` | Follows Preview-panel width naturally; prevents horizontal-scroll + avoids reinventing window-management |
| A7 | architecture | Vault-relative paths in all API responses | `CLAUDE.md:L44` | M19 Sprint-2 guarantee; absolute-path leaks are a PII + portability risk |
| A8 | architecture | Priority INFERRED from impact+urgency+due+goal-timeframe, never stored | `CLAUDE.md:L45` | Inputs don't drift; priority drifts as due ticks closer — storing drift is a data-integrity trap |
| A9 | architecture | Field allowlist on `field-edit` (status/priority/created/constructor rejected) | `CLAUDE.md:L46` | Sprint-2 P0 security fix; prevents prototype-pollution + bypasses of state-machine and priority-inference locks |
| A10 | architecture | `writeFileExclusive` (O_EXCL) for creates, `writeFileAtomic` for updates | `CLAUDE.md:L47` | TOCTOU-safe; verified by 20-parallel-create → 1×201 → 19×409 test in verify.sh |
| B1 | plan-ii | Lazy-mount collapsed buckets + `content-visibility: auto` | `docs/examples/plan-file-example.md:§0.4.D1` | Covers 95% of virtualization's DOM-density win at 10 lines of code; real virtualization deferred pending measurement |
| B2 | plan-ii | Safety-first phase order (H → I → J) | `docs/examples/plan-file-example.md:§0.4.D2` | Tombstones + mtime lock land before in-memory cache so the cache stays disk-truth (avoids Plan-agent-Q10 cache-invalidation race) |
| B3 | plan-ii | Tombstones inside vault at `.vault-sidebar-tombstones/` | `docs/examples/plan-file-example.md:§0.4.D3` | Outside chokidar's watched tree + `.gitignore`-able + survives `/tmp` cleanup; simplest safe location |
| B4 | plan-ii | Full 14-item autistic polish list (Sprint J) | `docs/examples/plan-file-example.md:§0.4.D4` | User explicitly chose completeness; no scope cuts on the signature feel-layer |
| B5 | plan-ii | Bulk-Move collision: silent auto-rename with transparent undo toast | `docs/examples/plan-file-example.md:§0.4.D5` | Preserves bulk-action atomicity; toast transparency "3 moved · 1 renamed foo → foo-2 · Undo" keeps user informed |
| B6 | plan-ii | mtime optimistic lock on body-edit + field-edit only (skip status-edit) | `docs/examples/plan-file-example.md:§0.4.D6` | Status transitions already guarded by reconcile queue; surface-area minimization principle |
| B7 | plan-ii | Writer-synchronous cache invalidation BEFORE SSE broadcast | `docs/examples/plan-file-example.md:§0.4.D7` | Hard invariant — kills the Plan-agent-Q10 killer race where broadcast arrives before cache invalidation |
| C1 | plan-i | Execute all 44 findings ranked by sprint (single approval) | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D1` | Avoids per-sprint re-approval ceremony; reduces planning overhead without losing rigor |
| C2 | plan-i | Per-finding Playwright verification (snapshot + eval) | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D2` | Forced concrete regression evidence per finding; couldn't fake "done" without a passing assertion |
| C3 | plan-i | 3 role-colors: `--accent` + `--ok` + `--text-secondary` | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D3` | Extended original 1-accent Darkroom-Minimal for in-progress visibility without rainbow drift |
| C4 | plan-i | Single plan, single approval, execute A→G straight through | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D4` | Removed context-switching overhead; 20 convergence rounds happened without approval gates |
| C5 | plan-i | Sprint 0 = HTML visual comparison artifact (via parallel `ui-ux` agents) | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D5` | De-risked 4 visual decisions (V1–V4) before real code changes; user picked V1A/V2B/V3A/V4B |
| C6 | plan-i | Verification widths: 320 + 480 + 725px per finding | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D6` | Covers narrow/medium/wide Preview-panel widths; caught responsive-layout bugs per finding |
| C7 | plan-i | Full CRUD additions: hard-delete + body-notes + cancel-as-row-action | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D7` | 95% of task lifecycle without opening Obsidian; "never leave the sidebar" goal |
| C8 | plan-i | Agenda tab label; `1` keyboard shortcut | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D8` | "Agenda" > "Today" — honors the multi-bucket time view the tab actually shows |
| C9 | plan-i | Dynamic bucket auto-split at threshold 10 | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D9` | Prevents "Upcoming" bucket from hiding overflow; next-week vs later split matches planning cadence |
| C10 | plan-i | ISO 8601 Monday–Sunday week boundaries | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D10` | Berlin-locale default; US-Sunday-start was rejected as regional default |
| C11 | plan-i | Blocked tasks render in bucket with ⧖ glyph + 60% opacity | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D11` | Still visible (blocking ≠ hiding); cue reads as "waiting" without color change |
| C12 | plan-i | Show overdue/today/tomorrow buckets even when empty (greyed `0`) | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D12` | Zero state is information; prevents "did my data disappear" anxiety |
| C13 | plan-i | Collapse persistence via Zustand `persist` + `partialize` filter | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D13` | Matches `pushrec-dashboard` pattern; survives page reload without DB |
| C14 | plan-i | Tab key crosses buckets, `j/k` bounded, `gj/gk` = prev/next bucket | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D14` | Mimics vim/gmail keyboard conventions users already know |
| C15 | plan-i | Arrow-nav into collapsed bucket auto-expands + selects first task | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D15` | Prevents focus-vanished-into-collapsed-subtree dead-end |
| C16 | plan-i | Kill Today tab; tabs are Agenda + Projects (2) | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D16` | Agenda subsumes Today; removing the redundant tab eliminates navigation ambiguity |
| C17 | plan-i | Done tasks inline in their time bucket with strikethrough | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D17` | Keeps the context of "I did this today" visible; vs hiding, which loses momentum signal |
| C18 | plan-i | Cancelled tasks hidden from Agenda; surface only via Projects view | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D18` | Cancelled ≠ done; shouldn't compete with active work for attention |
| C19 | plan-i | P1/P2/P3/P4 priority pills (Linear-style) | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D19` | Shape-encoded not color-encoded; colorblind-safe; pattern matches user expectation |
| C20 | plan-i | Row-visible chips: circle + action + priority pill + due chip + project title | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D20` | Every chip earns its place; ellipsis handles overflow before dropping chips |
| C21 | plan-i | Edit affordance: pencil icon on row hover + keyboard `E` | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D21` | Progressive disclosure (not always visible) + keyboard-first |
| C22 | plan-i | In-progress visual: emerald 4px left-edge stripe (static, no pulse) | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D22` | V1A variant picked in Sprint 0; static over pulse because pulse competes with overdue accent |
| C23 | plan-i | Due chip format: frontend relative ("−3d" / "today" / "+2d"); backend ISO in frontmatter | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D23` | Storage = absolute, display = relative (auto-updates without rewriting files) |
| C24 | plan-i | V4B 2-line stacked breadcrumb (goal line / project+trash line / timestamps) | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D24` | User picked V4B in Sprint 0; vertical breathing room > horizontal chip density |
| C25 | plan-i | Timestamps in breadcrumb only (not in property list) | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D25` | Breadcrumb is the metadata zone; property list is the editable zone |
| C26 | plan-i | Body notes via textarea row; delete via trash icon + confirm modal | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D26` | Inline editing keeps flow; confirm modal for destructive guards against fat-finger |
| C27 | plan-i | Cancel as row-level action (overflow menu or keyboard `c`) | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D27` | Status transition, not a top-level nav; row-level action matches mental model |
| C28 | plan-i | Status enum includes "cancelled" | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D28` | Plan-I audit found the enum missing "cancelled"; B06 P0 fix |
| C29 | plan-i | Command palette V1: 4 scopes (tasks/projects/tabs/+create) | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D29` | ⌘K is the universal escape hatch; narrower scope confuses |
| C30 | plan-i | Shortcut hints via tooltips on interactive elements (no help modal) | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D30` | Progressive discovery; doesn't bloat chrome with a dedicated help surface |
| C31 | plan-i | Undo toast: 5s window, bottom-right, ⌘Z global binding | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D31` | Mac-Finder parity; 5s is long enough to react, short enough to commit |
| C32 | plan-i | Bulk ops: Shift+j/k range + Space toggle + ⌘A + bottom bar | `docs/examples/plan-file-example.md:Plan-I-Archive-§3.D32` | Matches gmail/linear conventions; no custom modifier key to learn |

## How to read this table

- Every `A` decision is enforced by the AI-tell grep battery in `scripts/verify.sh`. Violating it fails CI.
- Every `B` decision shapes what shipped in Plan II Sprint H (safety layer).
- Every `C` decision is embodied in the Sprints A–G commits visible in the git history.

If you're an agent extending this codebase and you want to violate any of these, STOP and ask the user first. They were each debated against their strongest counter-argument (see `docs/PLANNING-DISCIPLINE.md` §Validation-Through-Negation) before landing.
