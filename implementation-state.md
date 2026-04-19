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
- H.4.3 Convergence Round 2 — COMPLETE (2026-04-19 resume session)
  - 9 R2 commits: b5b57ed → a77dc65 → b0b9e29 → f0b6969 → c4144f0 → eb17488 → 6c9f5d3 (plus R2 final checkpoint)
  - R2 D1–D4 closed the 4 R1 deferrals (UNDO-TOAST-FEEDBACK-SWALLOWED HIGH, ERROR-DOT-TOOLTIP-GENERIC MEDIUM, FETCH-VAULT-RACE MEDIUM, TTL-TIGHTNESS LOW)
  - R2 critics launched in parallel: Opus Explore (unconstrained), Gemini CLI (unconstrained), Codex CLI (63-line prompt — within 80-line cap per R1 lesson)
  - Critic results:
    - Opus R2: `findings: []` — full convergence on all 10 probes
    - Gemini R2: 9 findings (2 HIGH, 4 MEDIUM, 3 LOW)
    - Codex R2: 3 findings (1 HIGH, 1 MEDIUM, 1 LOW)
  - Applied in commits c4144f0 + eb17488:
    - Codex HIGH R2-TOMBSTONE-MTIME — sweep expiry now uses filename timestamp, not stat.mtimeMs (fs.rename preserves source mtime; entity tasks edited >8s ago were immediately swept)
    - Gemini HIGH UNDO-TOAST-TERMINAL-BTNS — PendingUndo.terminal?:boolean omits Undo button + ⌘Z binding on terminal toasts
    - Gemini HIGH BULK-BAR-FOCUS-LOSS — restoreFocusBeforeUnmount() restores focus to .quick-add-input before clearSelection
    - Gemini MEDIUM ERROR-DOT-KBD-TOOLTIP — :focus-visible tooltip variant (keyboard users see specific error text)
    - Gemini MEDIUM UNDO-CMDZ-SELECT-GUARD — SELECT added to ⌘Z exclusion list
    - Gemini MEDIUM MTIME-BANNER-A11Y-FOCUS — banner tabIndex + ref + requestAnimationFrame focus on conflict
    - Gemini MEDIUM TASK-DETAIL-DEL-OVERLAY-SR — aria-hidden on panel subtree during delete
    - Codex MEDIUM R2-HMR-SEQ-RESET — fetchVaultSeq seeded from globalThis.__maxAppliedVaultSeq + mirrored across modules
    - Opportunistically applied Gemini ERROR-TOOLTIP-OVERFLOW LOW (white-space normal + line-height) in same CSS edit as ERROR-DOT-KBD-TOOLTIP
  - D5 + D6 doc-only comments landed in commit 6c9f5d3 (Partial-undo semantics on handleBulkDelete; PendingUndo replacement semantics on setPendingUndo)
  - Deferred LOW (to PLAN-II-LOG.md R2 entry):
    - Gemini ERROR-DOT-FALLBACK-COPY (wording polish)
    - Gemini TRUNCATION-SURROGATE-BREAK (emoji-at-37-byte-boundary slice)
    - Codex R2-INLINE-RESTORE-ENOENT (existsSync/readFile TOCTOU in inline-restore path)
  - Exit gate: tsc 0, verify.sh 39/39 on fresh server, AI-tells clean, stray-#fff clean (see `/tmp/plan-ii-r2-exit-gate.txt`)
- H.4.4 Convergence Round 3 — SKIPPED
  - Per §R2.4 decision 6: R3 skipped if R2 critics return zero C/H/M post-fix
  - All 8 R2 C/H/M findings fixed in-commit; LOW findings documented not ship-blockers
  - R3 diff-against-R2-HEAD regression sweep is optional; none of the R2 fixes introduced regressions (verified via tsc + verify.sh + AI-tells post each commit)

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

### Sprint H R2 (2026-04-19 resume)
- Opus: `findings: []` (clean convergence on all 10 probes)
- Gemini: 9 findings (2 HIGH, 4 MEDIUM, 3 LOW)
- Codex: 3 findings (1 HIGH, 1 MEDIUM, 1 LOW) — 63-line prompt per R1 lesson (80-line cap)
- D-fix commits (closed R1 deferrals): b5b57ed (D1), a77dc65 (D2), b0b9e29 (D3), f0b6969 (D4)
- Critic-fix commits: c4144f0 (Codex HIGH tombstone-mtime), eb17488 (2 HIGH + 4 MEDIUM Gemini + 1 MEDIUM Codex + opportunistic 1 LOW Gemini)
- Doc-only commit: 6c9f5d3 (D5 + D6)
- Total: 8 C/H/M fixed (of 8 non-LOW findings) + 1 LOW opportunistically fixed
- Deferred LOW: 3 (Gemini ERROR-DOT-FALLBACK-COPY, Gemini TRUNCATION-SURROGATE-BREAK, Codex R2-INLINE-RESTORE-ENOENT)
- R3 SKIPPED per §R2.4 decision 6 (zero C/H/M post-fix, no regressions)
- tsc 0, verify.sh 39/39 on fresh server, AI-tells clean — Sprint H R2 complete + ship-ready
