---
created: 2026-04-21
created-by: agent
created-session: 2026-04-21
tags:
  - type/perf-baseline
  - domain/vault-sidebar
parent-project: "[[1-Projects/vault-sidebar/README]]"
head-at-capture: 3515a5e
target-phase: Sprint I (partial — I.6 + I.9 deferred)
server: launchd com.robertzinke.task-sidebar @ 127.0.0.1:5174
vault-target: /Users/robertzinke/pushrec-vault (real vault, 50 projects)
---

# Sprint I — Post-Execution Performance Measurements

Captured 2026-04-21 after the I.1 type-migration + I.2 DOM-density + I.3 useShallow + I.4 server-cache + I.5 SSE-coalesce + I.7 locale + I.8 SSE-reconnect + D.02/D.07 hardening commits landed. I.6 Bulk Move + I.9 exit-convergence + Sprint J + Phase K are deferred to a follow-up session.

## `/api/vault` Warm Latency — 50-sample benchmark

| Metric | Pre (HEAD 350c987) | Post (HEAD 3515a5e) | Win Factor |
|---|---|---|---|
| **p50 (median)** | **17.89 ms** | **4.40 ms** | **4.06×** ✓ (target < 5 ms) |
| min | 13.70 ms | 3.28 ms | 4.18× |
| max | 73.00 ms | 21.05 ms | 3.47× |
| response size | 600,000 bytes | 600,000 bytes | unchanged |

**T-I1 irreducible truth ACHIEVED.** Warm p50 < 5 ms target hit.

Root cause of the win: the cache layer (I.4.1) collapses the full vault walk + every parse; pre-serialized JSON (I.4.2 polish) collapses the 600KB JSON.stringify cost on every hit. Hit path is now effectively memcpy-only.

## Discriminated Union Migration (Sprint I.1)

| Metric | Pre | Post |
|---|---|---|
| `task.line !== undefined` loose guards | 9 matches (BulkBar only; other sites used reverse-order 4-site pattern) | 0 ✓ |
| `task.entityPath &&` unguarded access | 3 matches (TaskDetailPanel) | 0 ✓ |
| `interface Task { … }` in `api.ts` | 1 (loose shape, 26 lines) | 0 ✓ (strict re-export from shared/types.ts) |
| `as any` in `src/` | 0 (baseline clean) | 0 ✓ (no new casts; used `as Enriched<Task>` for AgendaView spread — not `as any`) |

**T-I4 irreducible truth ACHIEVED.** Zero loose guards remain.

## DOM Density (Agenda View) — Pending live measurement

Expected via preview_eval `document.querySelectorAll('*').length`:
- Pre: ~35,370 (plan §0 baseline, all buckets expanded across 50 projects)
- Post: < 5000 (default-collapsed, Overdue+Today+Tomorrow only)

Not live-measured in this session — playwright-cli E2E deferred to Sprint I.9 exit gate in a follow-up session. Target captured as pending gate.

## Zustand Subscription Density (TaskRow)

| Metric | Pre | Post |
|---|---|---|
| `useSidebarStore(...)` calls per TaskRow | 12 individual selectors | 2 (1 useShallow tuple + 1 Map.get) |
| Selector invocations per store update | 12× per row × every update | 1× per row × every update |

**Reduction**: 83% in selector invocation cost per row. B2 preempt honored — `taskErrorMessages` Map kept as separate primitive subscription outside the useShallow tuple.

## SSE Coalesce (I.5)

| Metric | Pre | Post |
|---|---|---|
| SSE events emitted per bulk-50-toggle | ~50 | Target ≤ 2 (coalesce window 100ms) |

Target: T-I5 irreducible truth "10 rapid writes within 150ms emit ≤ 2 SSE events". Implementation verified via code review; live-test deferred to Sprint I.9 exit.

## Locale (I.7)

| Metric | Pre | Post |
|---|---|---|
| `"en-US"` hardcoded in `src/` | 4 matches | 0 ✓ |
| `.toLocaleDateString(undefined, ...)` (browser locale) | 0 | 4 |

**T-I6 irreducible truth foundation** — German-locale test deferred to Sprint I.9 E2E.

## SSE Reconnect (I.8)

- `subscribeVaultEvents` signature: `() => void` → `{ close, reconnect }`
- Manual "Retry" button rendered in `.sse-banner` when `sseState === "closed"`
- Exponential backoff countdown: 2 → 4 → 8 → 16 → 32 → 32 → … (cap)
- 600ms "Reconnected" green flash via `.sse-banner--reconnected` variant + `@keyframes sse-flash`

**T-I8 irreducible truth** — code-verified; live E2E via `launchctl bootout` deferred.

## Writer-Synchronous Invalidate Contract (I.4.3-I.4.14 + I.4.13b)

13 writer files now call `await invalidateFile(absPath)` after every successful write, BEFORE returning:

| # | Writer | Task |
|---|---|---|
| 1 | task-toggle.ts | I.4.3 |
| 2 | task-add.ts | I.4.4 |
| 3 | task-edit.ts | I.4.5 |
| 4 | task-move.ts (source only; target via addTask's own invalidate) | I.4.6 |
| 5 | task-field-edit.ts | I.4.7 |
| 6 | task-status-edit.ts | I.4.8 |
| 7 | task-create-entity.ts | I.4.9 |
| 8 | task-promote.ts | I.4.10 |
| 9 | task-promote-and-edit.ts | I.4.11 |
| 10 | project-field-edit.ts | I.4.12 |
| 11 | task-delete.ts (entity + inline) | I.4.13 |
| 12 | task-body-edit.ts | I.4.14 |
| 13 | task-tombstone.ts (B5 symmetric restore: entity + inline) | I.4.13b |

**T-I3 irreducible truth ACHIEVED.** Writer-synchronous invalidation ordering preserved: every writer invalidates BEFORE the downstream SSE broadcast fires.

## Remaining Deferred / Not Shipped

### Sprint I feature work
- **I.6 Bulk Move** (I.6.1-I.6.5, ~3.5h estimate): NOT SHIPPED. Deferred to follow-up session. Plan §7 Task I.6 body unchanged. Preempt B6 will apply when it lands.

### Sprint I deferred hardening (HANDOFF §4.3)
- **D-01** `/tmp/task-sidebar.log` rotation: NOT SHIPPED. macOS /tmp cleanup handles it short-term.
- **D-03** launchd active-kill supervision test: NOT RUN.
- **D-04** pnpm-install preflight: NOT SHIPPED.
- **D-05** inline R2 greps into plan §7 I.0.1: NOT SHIPPED (plan edit).
- **D-06/D-08/D-09/D-10** already resolved or historical.

### Sprint I.9 exit-gate convergence
- **agent-orchestrator gap-convergence** with Opus+Gemini+Codex: NOT RUN.
- Playwright CLI E2E video (`/tmp/sprint-i-lazy-mount.webm`): NOT RECORDED.
- Before/after screenshots at `docs/screenshots/sprint-i/{task}/`: NOT CAPTURED.

### Sprint J + Phase K
- Entirely deferred per session context budget.

## Conclusion

**Sprint I PARTIAL shipped.** Core perf targets achieved: T-I1 (warm latency <5ms), T-I3 (writer-synchronous invalidate), T-I4 (zero loose guards), T-I6 locale foundation, T-I8 SSE reconnect infrastructure. Sprint I.6 Bulk Move + Sprint I.9 convergence + Sprint J + Phase K remain as follow-up work.

13 commits pushed to `origin/main` at `github.com/pushREC/task-sidebar` across HEAD range `350c987..3515a5e`.
