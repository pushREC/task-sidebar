# Plan II v2 — Implementation State

**Plan source**: `/Users/robertzinke/.claude/plans/spicy-jumping-pike.md` (Plan II v2 section starting line 9)
**Branch**: main (local scoped git repo per Plan I pattern)
**HEAD at Plan II start**: 2ea75c4
**Session started**: 2026-04-19
**HEAD at session checkpoint**: 03dfb8b

## Phase H — Safety + Recoverability

### H.0 Entry
- H.0.1 Assumption-annihilation check — COMPLETE (20/20 PASS, see `/tmp/plan-ii-assumption-checks.txt`)
- H.0.2 Entry-gate verification — COMPLETE (4/4 PASS, see `/tmp/plan-ii-h-entry-gate.txt`)
- H.0.3 Create implementation-state.md — COMPLETE (commit 7955778) ← THIS FILE
- H.0.4 Create PLAN-II-LOG.md — COMPLETE (commit 7955778)

### H.1 Error-dot persistence
- H.1 Error-dot 5s + hover tooltip + click-dismiss — COMPLETE (commit c50c97e)

### H.2 mtime optimistic lock
- H.2.1 Create server/writers/mtime-lock.ts — COMPLETE (commit fe8baa3)
- H.2.2 Wire into task-body-edit.ts — COMPLETE (commit 25d8a64)
- H.2.3 Wire into task-field-edit.ts — COMPLETE (commit e40187f)
- H.2.4 api.ts expectedModified param — COMPLETE (commit 3c663ba)
- H.2.5 TaskDetailPanel capture on edit-open — COMPLETE (commit 3bd092c)
- H.2.6 Client 409 handling — COMPLETE (commit 3bd092c)

### H.3 Tombstone delete system
- H.3.1 Create server/writers/task-tombstone.ts — COMPLETE (commit be89ab6)
- H.3.2 POST /api/tasks/restore-tombstone route — COMPLETE (commit ee8b339)
- H.3.3 Convert deleteEntityTask — COMPLETE (commit c823e10)
- H.3.4 Convert deleteInlineTask — COMPLETE (commit c823e10)
- H.3.5 server/index.ts sweeper + cleanup + shutdown — COMPLETE (commit 2129744)
- H.3.3b Route forwards tombstoneId — COMPLETE (commit 4273e36)
- H.3.6 api.ts restore wrappers — COMPLETE (commit ee8b339)
- H.3.7 BulkBar real delete undo — COMPLETE (commit 0050cff)
- H.3.8 UndoToast enable real Undo for delete — COMPLETE (commit 0050cff)
- H.3.9 TaskDetailPanel capture tombstoneId — COMPLETE (commit 0050cff)

### H.4 Exit + Convergence
- H.4.1 Phase-H exit-gate verification — COMPLETE (tsc 0, verify.sh 39/39, AI-tell clean, no stray #fff — see `/tmp/plan-ii-h-exit-gate.txt`)
- H.4.2 Convergence Round 1 (3 parallel critics) — COMPLETE
  - Opus R1: 10 findings (1 CRITICAL, 2 HIGH, 4 MEDIUM, 3 LOW)
  - Gemini R1: 10 findings (1 CRITICAL, 2 HIGH, 3 MEDIUM, 4 LOW)
  - Codex R1: killed after exceeding 5min timeout, 50KB partial output
  - R1 fixes applied in commit 03dfb8b:
    - CRITICAL tombstone-filename-base64-slash — URL-safe base64
    - CRITICAL restore-target-toctou-overwrite — writeFileExclusive pattern
    - HIGH mtime-granularity-gap — BigInt nanosecond precision
    - HIGH tombstone-filename-length — 255-byte APFS limit + @FILE body fallback
    - MEDIUM sweeper-vs-restore-enoent — catch + translate to 404
    - MEDIUM inline-write-error-not-caught — try/catch with safetyError(500)
    - Conflict banner wording updated (no longer falsely claims "draft is kept")
  - Deferred to R2:
    - UNDO-TOAST-FEEDBACK-SWALLOWED (finally-block clears terminal feedback)
    - ERROR-DOT-TOOLTIP-GENERIC (hardcoded message doesn't show actual error)
    - FETCH-VAULT-RACE (out-of-order vault refreshes)
    - Several LOW items
- H.4.3 Convergence Round 2 — NOT STARTED (next session)
- H.4.4 Convergence Round 3 — NOT STARTED (next session)

## Phase I — Performance Bedrock

All tasks NOT STARTED. Deferred to next session.

## Phase J — Feel Layer

All tasks NOT STARTED. Deferred to next session.

## Deviations from plan

1. **2026-04-19 (A11 skill path)**: playwright skill is at `~/.claude/skills/native-playwright/`, not `~/.claude/skills/playwright-cli/`. Non-blocking; native-playwright serves the same purpose.
2. **2026-04-19 (Codex convergence timeout)**: Codex R1 critic timed out at ~5min with partial output; Opus + Gemini converged on same critical findings so R1 fixes landed without Codex input. R2 retry will feed it smaller prompt.
3. **2026-04-19 (H.3.2 + H.3.6 commit)**: originally planned as two separate commits; bundled into one (ee8b339) because route + API wrapper are tightly coupled and must ship together for the client contract to work.
4. **2026-04-19 (H.3.3b unplanned)**: initial H.3.3 commit converted the writer but forgot to forward tombstoneId through the route JSON response. Unplanned fix commit (4273e36) added that. Documented here for next session clarity.

## Discovered requirements

1. `stat(path, {bigint:true})` is required to access `mtimeNs` — not `stat(path)` which returns a default `Stats` with only `mtimeMs`. Critical for the nanosecond-precision mtime check.
2. macOS APFS filename-length limit (255 bytes) is smaller than some task bodies need to encode. Required fallback path for long-text inline tombstones.
3. Base64 standard alphabet includes `/` which breaks filename encoding. URL-safe variant needed.
4. `fs.rename` silently overwrites existing targets on POSIX. `writeFileExclusive` (O_EXCL) required for safe restore.

## Risk register

- **TOMBSTONE_TTL_MS = 5500ms tight against UndoToast 5000ms window.** Gemini flagged as LOW (500ms margin). If network latency + restore API roundtrip exceed 500ms, tombstone could be swept mid-request. **Mitigation deferred to R2**: widen TTL to 8000ms OR add a "sweep-in-progress" marker lookup on restore.
- **Codex convergence timeout pattern.** Prompts over ~100 lines seem to cause Codex to hang. Mitigation: cap Codex prompts at 80 lines going forward.
- **UNDO-TOAST-FEEDBACK-SWALLOWED (R1 deferred).** Terminal toasts set by revert closures are immediately cleared by the finally block. User may miss "Restore failed" messages. **R2 must fix.**
- **Sprint I + Sprint J not started.** Plan II estimated 40h total; Sprint H alone took ~16h including R1 convergence. Remaining 24h across I + J. Session resume protocol in HANDOFF.md.

## Convergence round log

### Sprint H R1 (2026-04-19)
- Opus: 10 findings (1 CRITICAL, 2 HIGH, 4 MEDIUM, 3 LOW)
- Gemini: 10 findings (1 CRITICAL, 2 HIGH, 3 MEDIUM, 4 LOW)
- Codex: timed out after 5min, 50KB partial output
- Fixes applied: 6 (2 CRITICAL, 2 HIGH, 2 MEDIUM) — commit 03dfb8b
- Deferred: ~6 (1 HIGH, 4 MEDIUM, several LOW) → tracked for R2
- tsc 0, verify.sh 39/39, AI-tells clean — Sprint H checkpoint-shippable
