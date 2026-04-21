---
created: 2026-04-21
created-by: agent
created-session: 2026-04-21
tags:
  - type/perf-baseline
  - domain/vault-sidebar
parent-project: "[[1-Projects/vault-sidebar/README]]"
head-at-capture: 350c987
target-phase: Sprint I
server: launchd com.robertzinke.task-sidebar @ 127.0.0.1:5174
vault-target: /Users/robertzinke/pushrec-vault (real vault, 50 projects)
---

# Sprint I — Pre-Execution Performance Baseline

Captured 2026-04-21 via 10 warm `curl` samples against the live launchd server running `pnpm dev` with the real vault (50 projects, no sample-vault leakage). These are the numbers Sprint I must move against.

## `/api/vault` Warm Latency (median of 10 consecutive samples)

| Metric | Baseline (HEAD 350c987) | Sprint I Target | Win Factor |
|---|---|---|---|
| **p50 (median)** | **17.89 ms** | **< 5 ms** | **≥ 3.6×** |
| min | 13.70 ms | < 3 ms | — |
| max | 73.00 ms | < 15 ms (cold case) | — |
| response size | 600,000 bytes (600 KB) | unchanged (not a Sprint I target) | — |

Method: `for i in 1..10; do curl -s -w '%{time_total}\n' -o /dev/null http://127.0.0.1:5174/api/vault; done | sort -n | awk 'NR==5||NR==6{a[NR]=$1} END{print (a[5]+a[6])/2}'`

## DOM Density (Agenda View, default collapse state)

| Metric | Baseline | Sprint I Target |
|---|---|---|
| `document.querySelectorAll('*').length` | TO BE CAPTURED via Preview MCP preview_eval in Phase 14.14.3 | < 5000 |
| `document.querySelectorAll('[data-task-row]').length` | measured pre-I.2.1 | scales with visible expanded buckets only |

Baseline from plan §0: 35,370 total DOM nodes (across all 50 real vault projects, with all buckets expanded). Sprint I target: < 5000 when default-collapsed (Overdue+Today+Tomorrow expanded only).

## Zustand Subscription Density

| Metric | Baseline | Sprint I Target (after I.3 useShallow) |
|---|---|---|
| `useSidebarStore(...)` call count in `src/components/TaskRow.tsx` | 13 individual selectors (from plan §0 measured baseline) | ≤ 5 (1 useShallow tuple + ≤ 4 primitive selectors for Map-valued state per preempt B2) |
| TaskRow re-render count per `markTaskError(id, msg)` call | baseline scales with total row count (every row re-renders per Map instance change) | bounded to rows whose message changed (typically 1-5) |

Baseline measurement deferred to I.3 entry. React Profiler / per-render useRef counter used as evidence.

## Preempt Integrity (Sprint H R2 invariant greps must stay at these counts through Sprint I)

| Invariant | Baseline count | Command |
|---|---|---|
| `fetchVaultSeq\|nextVaultSeq\|maxAppliedVaultSeq` refs across api.ts + store.ts | **22** (≥ 6 minimum) | `grep -c 'fetchVaultSeq\|nextVaultSeq\|maxAppliedVaultSeq' src/api.ts src/store.ts` |
| `aria-hidden={isDeleting` in TaskDetailPanel.tsx | **1** | `grep -c 'aria-hidden={isDeleting' src/components/TaskDetailPanel.tsx` |
| `restoreFocusBeforeUnmount` in BulkBar.tsx | **5** (1 decl + 4 calls; grows to 6 after I.6.4 B6 preempt) | `grep -c 'restoreFocusBeforeUnmount' src/components/BulkBar.tsx` |
| `TOMBSTONE_TTL_MS = 8000` in task-tombstone.ts | **1** | `grep -c 'TOMBSTONE_TTL_MS = 8000' server/writers/task-tombstone.ts` |
| `terminal?: boolean` in store.ts | **1** | `grep -c 'terminal?: boolean' src/store.ts` |

## Discriminated Union Migration Targets (zero loose-guard patterns post-I.1.*)

| Site count | Location | Target |
|---|---|---|
| 4 | `src/components/BulkBar.tsx` | I.1.1 → 0 (replaced with `isInlineTask(task)`) |
| 3 | `src/components/TaskDetailPanel.tsx` | I.1.2 → 0 (2 `const isInline` narrowings via helper + 1 redundant guard removed) |
| 1 | `src/components/TaskRow.tsx` | I.1.3 → 0 (trivial rename; real work is AgendaView `Enriched<T>` generic) |
| loose `interface Task` | `src/api.ts` | I.1.4 → strict re-export from `shared/types.ts` + cascade narrow |

## Locale Hardcoding (zero `"en-US"` post-I.7)

| Occurrences | File | Target |
|---|---|---|
| 3 | `src/lib/format.ts` | `.toLocaleDateString(undefined, ...)` |
| 1 | `src/App.tsx` | same |
| **4 total** | `src/` | **0** post-I.7 |

## Success Criteria Recap (Sprint I exit gate per §14.14.11)

- [ ] `/api/vault` warm p50 latency ≤ 5 ms (T-I1).
- [ ] Agenda DOM nodes ≤ 5000 (T-I2).
- [ ] Zero loose-guard patterns in `src/` (T-I4).
- [ ] Zero `"en-US"` strings in `src/` (T-I6).
- [ ] Bulk-Move of N entity tasks with collision auto-suffix + undo works end-to-end (T-I7).
- [ ] SSE Retry button visible when connection CLOSED (T-I8).
- [ ] Writer-synchronous invalidate-before-broadcast holds for all 12 writers + restore path (T-I3, B5).
- [ ] SSE coalesce window ≥ 100ms (T-I5).
- [ ] tsc 0 errors end of Sprint I (T-I9, T-G1).
- [ ] All 5 R2 invariants unchanged (T-G4).
- [ ] All Sprint I commits pushed to `origin/main` at `github.com/pushREC/task-sidebar` (L3).

Post-execution comparison: `docs/perf-baselines/sprint-i-post.md` captures same metrics with empirical deltas.
