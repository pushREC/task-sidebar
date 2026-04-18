# Plan II v2 — Implementation State

**Plan source**: `/Users/robertzinke/.claude/plans/spicy-jumping-pike.md` (Plan II v2 section starting line 9)
**Branch**: main (local scoped git repo per Plan I pattern)
**HEAD at Plan II start**: 2ea75c4
**Session started**: 2026-04-19

## Phase H — Safety + Recoverability

### H.0 Entry
- H.0.1 Assumption-annihilation check — COMPLETE
  - Expected: 20/20 PASS
  - Actual: 20/20 PASS (see /tmp/plan-ii-assumption-checks.txt)
  - Deviation: A11 skill path corrected (`native-playwright` not `playwright-cli`); non-blocking
- H.0.2 Entry-gate verification — COMPLETE
  - Expected: tsc 0 / verify.sh 39/39 / AI-tells clean / no stray #fff
  - Actual: all 4 PASS (see /tmp/plan-ii-h-entry-gate.txt); reconcile flake required server restart once
- H.0.3 Create implementation-state.md — COMPLETE ← THIS FILE (commit 7955778)
- H.0.4 Create PLAN-II-LOG.md — COMPLETE (commit 7955778)

### H.1 Error-dot persistence
- H.1 Error-dot 5s + hover tooltip + click-dismiss — IN PROGRESS
  - ERROR_DOT_DURATION_MS: 2000 → 5000 (TaskRow.tsx)
  - Wrapped .task-error-dot in a <button class="task-error-dot-button"> with onClick clearTaskError
  - Added hover tooltip via `.task-error-dot-button:hover::after` reading `data-error-msg`
  - Animation: `error-tooltip-in` 120ms ease-out 80ms delay

### H.2 mtime optimistic lock
- H.2.1 Create server/writers/mtime-lock.ts — NOT STARTED
- H.2.2 Wire into task-body-edit.ts — NOT STARTED
- H.2.3 Wire into task-field-edit.ts — NOT STARTED
- H.2.4 api.ts expectedModified param — NOT STARTED
- H.2.5 TaskDetailPanel capture on edit-open — NOT STARTED
- H.2.6 Client 409 handling — NOT STARTED

### H.3 Tombstone delete system
- H.3.1 Create server/writers/task-tombstone.ts — NOT STARTED
- H.3.2 POST /api/tasks/restore-tombstone route — NOT STARTED
- H.3.3 Convert deleteEntityTask to tombstone — NOT STARTED
- H.3.4 Convert deleteInlineTask to tombstone — NOT STARTED
- H.3.5 server/index.ts sweeper + cleanup + shutdown — NOT STARTED
- H.3.6 api.ts restore wrappers — NOT STARTED
- H.3.7 BulkBar real delete undo — NOT STARTED
- H.3.8 UndoToast enable real Undo for delete — NOT STARTED
- H.3.9 TaskDetailPanel capture tombstoneId — NOT STARTED

### H.4 Exit
- H.4.1 Phase-H exit-gate verification — NOT STARTED
- H.4.2 Convergence Round 1 (3 parallel critics) — NOT STARTED
- H.4.3 Convergence Round 2 — NOT STARTED
- H.4.4 Convergence Round 3 — NOT STARTED

## Phase I — Performance Bedrock

- I.0.1 Entry gate — NOT STARTED
- I.1.1 BulkBar.tsx migrate 9 guard sites — NOT STARTED
- I.1.2 TaskDetailPanel.tsx migrate 7 guard sites — NOT STARTED
- I.1.3 TaskRow.tsx + AgendaView.tsx Enriched<T> — NOT STARTED
- I.1.4 api.ts flip to strict Task re-export — NOT STARTED
- I.2.1 AgendaView lazy-mount — NOT STARTED
- I.2.2 ProjectsView lazy-mount confirm — NOT STARTED
- I.2.3 content-visibility CSS — NOT STARTED
- I.3 Zustand useShallow collapse in TaskRow — NOT STARTED
- I.4.1 Create server/vault-cache.ts — NOT STARTED
- I.4.2 vault-index reads from cache — NOT STARTED
- I.4.3 task-toggle writer invalidates — NOT STARTED
- I.4.4 task-add writer invalidates — NOT STARTED
- I.4.5 task-edit writer invalidates — NOT STARTED
- I.4.6 task-move writer invalidates — NOT STARTED
- I.4.7 task-field-edit writer invalidates — NOT STARTED
- I.4.8 task-status-edit writer invalidates — NOT STARTED
- I.4.9 task-create-entity writer invalidates — NOT STARTED
- I.4.10 task-promote writer invalidates — NOT STARTED
- I.4.11 task-promote-and-edit writer invalidates — NOT STARTED
- I.4.12 project-field-edit writer invalidates — NOT STARTED
- I.4.13 task-delete writer invalidates — NOT STARTED
- I.4.14 task-body-edit writer invalidates — NOT STARTED
- I.4.15 server/index.ts sync build BEFORE app.listen — NOT STARTED
- I.4.16 server/watcher.ts external invalidation — NOT STARTED
- I.4.17 sanity-rebuild timer — NOT STARTED
- I.5 SSE coalesce — NOT STARTED
- I.6.1 task-move entity extension — NOT STARTED
- I.6.2 moveEntityTaskApi wrapper — NOT STARTED
- I.6.3 ProjectPicker component — NOT STARTED
- I.6.4 BulkBar Move button — NOT STARTED
- I.6.5 Collision auto-suffix toast — NOT STARTED
- I.7 Locale-aware dates — NOT STARTED
- I.8 Manual SSE reconnect button — NOT STARTED
- I.9.1 Phase-I exit gate — NOT STARTED
- I.9.2 Convergence Round 1 — NOT STARTED
- I.9.3 Convergence Round 2 — NOT STARTED
- I.9.4 Convergence Round 3 — NOT STARTED
- I.9.5 Convergence Round 4 (diff-against-master regression sweep) — NOT STARTED

## Phase J — Feel Layer

- J.0.1 Entry gate — NOT STARTED
- J.1.1 Stagger-fade-in TaskRow mount — NOT STARTED
- J.1.2 Optimistic UI delete/create/bulk — NOT STARTED
- J.1.3 Error-dot hover tooltip confirm — NOT STARTED
- J.1.4 Animation timing tokens — NOT STARTED
- J.1.5 Focus management audit — NOT STARTED
- J.2.6 Touch targets 24x24 — NOT STARTED
- J.2.7 prefers-contrast variant — NOT STARTED
- J.2.8 Color-blind non-color cues — NOT STARTED
- J.2.9 Zoom audit (160/320/480/725) — NOT STARTED
- J.2.10 Long-press context menu — NOT STARTED
- J.2.11 Haptics feedback — NOT STARTED
- J.2.12 Skeleton crossfade polish — NOT STARTED
- J.2.13 Scroll-shadow on bucket headers — NOT STARTED
- J.2.14 Command palette focus trail — NOT STARTED
- J.2.15 SSE backoff countdown polish — NOT STARTED
- J.3.1 Phase-J exit gate — NOT STARTED
- J.3.2 Convergence Round 1 — NOT STARTED
- J.3.3 Convergence Round 2 — NOT STARTED

## Deviations from plan
(populate each time actual output differs from expected)

2026-04-19: A11 assumption — playwright skill is at `~/.claude/skills/native-playwright/`, not `~/.claude/skills/playwright-cli/`. Non-blocking; native-playwright serves the same purpose.

## Discovered requirements
(populate for work discovered mid-implementation)

## Risk register
(populate as new risks surface)

## Convergence round log
(populate after each round)
