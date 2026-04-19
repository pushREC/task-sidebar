# Planning Discipline

> The second-most-valuable artifact in this repo (after the code itself) is the **planning process** that produced the code. This doc is the playbook. Fork it. Adapt it. Use it on your own projects.

## Why plan this way

Most engineering plans are post-hoc rationalizations of whatever the author already wanted to build. This process is designed to defeat that failure mode via four compounding disciplines:

1. **Assumption annihilation** — before writing one line of code, enumerate every assumption and verify each with a concrete command.
2. **Irreducible truths** — state the minimum fact-set that must hold after the work lands. Apply failure-subtraction: if removing any truth doesn't break something, remove it from the plan.
3. **Validation through negation** — for every locked decision, write the strongest counter-argument you can. Steelman the alternatives. Decide.
4. **3-parallel-critic convergence** — at every sprint boundary, dispatch 3 adversarial agents with orthogonal priors and fix everything CRITICAL/HIGH/MEDIUM before advancing.

No single one of these is new. The combination — religiously applied — changes the quality of what you ship.

Plan I + Plan II of task-sidebar shipped ~164 findings across 22 convergence rounds using this discipline. Zero CRITICAL issues remain. Every lock has a documented counter-argument on file.

## The plan-file format

A complete plan file has these sections, in this order:

### 0. Context + Goals
- Why this work is happening (the problem, not the solution)
- Intended outcome (testable success criteria)
- Unforgettable moment (the Prime Directive — what the user should feel)
- Aesthetic/architecture lock summary

### 0.1 Assumption Annihilation
A table with one row per assumption:

| # | Assumption | Verification command | Expected output |
|---|---|---|---|

Minimum 10 rows, target 20. Every assumption must be testable via a shell command, HTTP request, file inspection, or library call. "I think X" is not an assumption; it's a guess. If you can't write the verification command, you haven't actually identified the assumption — you have a gut feeling. Keep digging.

The first task of the plan runs all assumption checks. Any FAIL blocks the phase.

### 0.2 Irreducible Truths
Per phase, the minimum fact-set:

- T-X1: <concrete testable statement>
- T-X2: ...

**Failure-subtraction test**: for each truth, what concrete regression appears if we remove it? If nothing breaks when you remove the truth, it's not irreducible — delete it.

### 0.3 Validation Through Negation
Per locked decision, THREE sub-sections:

**Counter-argument**: the strongest case against this approach.
**Tradeoff analysis**: why we accept the cost of rejecting the counter-argument. Cite concrete evidence (measured numbers, observed bugs, user quotes).
**Reverse conditions**: under what conditions would we flip this decision?

If you can't write a plausible counter-argument, you haven't thought about the decision long enough. Steelman harder.

### 0.4 Locked Decisions
Numbered list of Ds with one-line statements. Each references its validation-through-negation entry.

### 0.5 Success Criteria
Checkboxes, each testable:

- [ ] `pnpm tsc --noEmit` returns empty
- [ ] `bash scripts/verify.sh` passes 37/37
- [ ] Grep for `/Users/<username>` returns 0

No prose. No "the UI should feel good". Everything grep-able or curl-able.

### 1. Dependency Graph + Critical Path
Text-diagram of task dependencies. Mark the critical path explicitly. Any task not on the critical path is a parallelization candidate.

### 2. Testing Strategy
Three layers:

- **Unit tests**: exact file path, exact function names, exact assertions.
- **Integration tests**: what two+ components exercised together? What's the fixture? What's the exact command?
- **E2E verification**: copy-pasteable sequence a human would run. Expected LITERAL terminal output, not "should work".

No theoretical tests. If it's in the plan, it must be runnable.

### 3. Agent Orchestration (13 Irreducible Questions)
Answer each explicitly:

1. How many agents?
2. How do they relate? (parallel / sequential / iterative)
3. How long per agent?
4. What validation per agent?
5. What on failure?
6. What persists (files, commits, logs)?
7. Where do outputs go?
8. Single source of truth?
9. How do we detect done?
10. How do we measure progress?
11. Session-init protocol?
12. Work-unit granularity?
13. Runtime setup?

Full agent prompts inline. Model choice (opus / sonnet / haiku) with justification.

### 4. Claude Code Anti-Patterns Checklist
Verify NONE of these in the final code:

- [ ] No `sys.path.insert` cross-skill imports
- [ ] No `decision: "approve"` in PreToolUse hooks (use `permissionDecision: "allow"`)
- [ ] No `rstrip("s")` for plural stripping
- [ ] No `--model` flag with subscription routing (forces API routing)
- [ ] No `ANTHROPIC_API_KEY` leaked to subprocess env
- [ ] No `currentColor` in SVG data URIs
- [ ] No `var` in JavaScript (use `const`/`let`)
- [ ] Stop hooks check `stop_hook_active`
- [ ] No stdlib module shadows (e.g. `queue.py`)
- [ ] All HTTP requests have explicit timeout

(There are more — see `~/.claude/skills/claude-code/references/` for the full reference, or copy the per-anti-pattern enforcement from `scripts/verify.sh`.)

### 5. Closed Feedback Loop
Per-phase:

```
Phase N completes
  → Run exit-gate tests
  → Record: worked / surprised / changed from plan
  → Feed forward: update Phase N+1 tasks if assumptions changed
  → If Phase N produced different output than planned:
      STOP. Re-evaluate all downstream phases. Update plan BEFORE continuing.
```

State-tracking file at repo root (e.g. `implementation-state.md`) holds:

- Per-task status: NOT STARTED / IN PROGRESS / COMPLETE / BLOCKED
- Deviations from plan (timestamp + reason)
- Discovered requirements (not in original plan, surfaced mid-execution)
- Risk register
- Convergence round log

### 6. Per-Task Spec Format
Every task, without exception, has these 8 fields:

- **What**: exact description. Not "set up X" but "create file at /exact/path with these exact contents".
- **Why**: what breaks without this. Not "it's needed" but "Task N.3 imports from this path".
- **Input**: exact files/data this task reads from, with paths.
- **Output**: exact files/data this task produces, with paths.
- **Dependencies**: task IDs that must complete first.
- **Verification**: exact command + exact expected output.
- **Rollback**: exact steps to undo if this task fails.
- **Edge cases**: what happens if input is empty? missing? malformed? already exists?

Any task missing any of these 8 is not ready to execute.

### 7. Anti-Mediocrity Self-Score
Before presenting the plan, score on 5 dimensions (1–10 each):

| Dimension | Threshold |
|---|---|
| Depth | ≥8 |
| Grounding | ≥9 |
| Confidence | ≥8 |
| Novelty | ≥8 |
| Actionability | ≥9 |

If ANY dimension scores below threshold, rewrite that section before presenting.

## Zero-ambiguity phrases — banned

These phrases trigger automatic plan rejection:

| Banned | Replace with |
|---|---|
| "set up" | "create [file/config] at [exact path] containing [exact content]" |
| "configure" | "write [exact key: value] to [exact file path] at [exact line]" |
| "update" | "in [exact file] change [exact old value] to [exact new value]" |
| "handle" | "when [exact condition] occurs, execute [exact action] returning [exact result]" |
| "integrate" | "import [exact module] from [exact path] and call [exact function]" |
| "properly", "as needed", "etc.", "and so on" | DELETE. State the actual requirement or enumerate every case. |
| "similar to" | write the ACTUAL code/config, not a reference. |
| "should work" | state the EXACT test that proves it works. |
| "make sure" | "verify by running [exact command] expecting [exact output]." |
| "clean up" | "delete [exact files] because [exact reason]." |
| "refactor" | "move [exact code] from [exact location] to [exact location]." |
| "straightforward", "simply", "obvious", "basic" | DELETE. Spell it out. |

## The 3-parallel-critic convergence protocol

At every sprint boundary (after implementation tasks land but before declaring sprint done), run ONE convergence round:

1. **Launch 3 critics in parallel** (ONE tool message, 3 content blocks):
   - **Opus Explore agent** (Claude sub-agent, unconstrained prompt) — breadth + pattern-matching
   - **Gemini CLI** (`gemini -p "..."`) — focus on UX/a11y/ARIA/reduced-motion/i18n
   - **Codex CLI** (`codex exec -s read-only "..."`, **≤80-line prompt** — longer prompts reliably time out) — focus on correctness/races/TOCTOU/boundary cases
2. **Every critic outputs STRICT YAML**:
   ```yaml
   findings:
     - id: <unique-id>
       severity: CRITICAL | HIGH | MEDIUM | LOW
       file: <absolute path>
       line: <line>
       problem: <1-3 sentences>
       proposed_fix: <1-2 sentences>
   ```
   Empty `findings: []` = convergence for that critic.
3. **Merge manually** across the 3 outputs. Dedupe overlaps. Flag any critic-disagreement (one says CRITICAL, another says LOW — user arbitrates).
4. **Apply CRITICAL + HIGH + MEDIUM in commits**. One commit per fix (or batched if ≤40 LoC) for surgical rollback.
5. **Document LOW deferrals** in `PLAN-II-LOG.md` (or equivalent convergence audit log) with explicit rationale (Sprint J polish / not ship-blocking / accepted trade-off).
6. **Re-run quality gates** (tsc, verify.sh, AI-tell greps) after fixes.
7. **If zero C/H/M across all 3 critics** → round complete. Else → next round starts at step 1 with diff against new HEAD.

**Expected cadence** (from Plan I empirical data):
- Round 1: 5–10 findings per critic (lots of net-new)
- Round 2: 2–5 findings per critic
- Round 3: 0–2 findings (often skipped if Round 2 is clean)

## The anti-mediocrity gate at round close

After applying fixes, self-score the round output on the 5 dimensions above (Depth / Grounding / Confidence / Novelty / Actionability). Any dimension <8 → revise before closing the round.

## Recursive self-improvement (Tier R)

Occasionally a round-close needs a fresh angle. Tier-R is: re-run the convergence protocol against the commit that contains the previous round's fixes. The improvement should surface gaps the first pass couldn't see by construction (e.g. "audit the audit commit itself", "audit the preempts for implementability", "audit the audit-trail internal consistency").

Rule: continue Tier-R iterations only while improvement > 5%. When improvement drops below, converge.

task-sidebar Sprint H iter-2 caught 10 blind spots iter-1 missed (4 phantom preempts, 1 verify-threshold mismatch, 1 stale HANDOFF, etc.). Iter-3 would have been theater.

## Using this protocol in your own projects

1. Copy `templates/plan-file.md` to your project's `plans/` directory.
2. Fill in each section. Don't skip any — the plan rejection gate is literally "did you fill every section".
3. Run the assumption annihilation checks BEFORE writing the first line of code.
4. Execute per-task spec strictly. Edge cases must be handled (even if the handling is "accept and log").
5. At each sprint boundary, launch 3 critics in parallel. Fix C/H/M. Document LOW deferrals.
6. At each convergence round close, anti-mediocrity self-score. ≥8 on 5 dimensions or revise.

Budget ~15–20 hours per sprint for the discipline (on top of implementation). Empirically: projects that skip this process ship features faster in week 1 and drown in bug reports in week 4. Projects that apply it ship slower in week 1 and accelerate in week 4 because the bug queue is empty.

## Example artifacts

- **Full plan file**: `docs/examples/plan-file-example.md` (sanitized copy of the plan that shipped this sidebar)
- **Convergence log**: the Plan II + supremacy-audit commits in git history (commits `ff028c4` → `a93a621` cover Sprint H R1 + R2 + 2 supremacy audits)
- **Plan-review gate prose**: the 10-section strict-format mandate Rob applied when rejecting v1 of Plan II lives inline in the example plan at §0

## Recommended reading (internal — future repos)

- `cognitive-supremacy` skill (private): the 5-layer compound intelligence stack that powers this process
- `first-principles` skill (private): the decomposition protocol that underpins assumption annihilation
- `debate-orchestrator` skill (private): the multi-persona debate framework used for validation-through-negation

Public-internet equivalents: steel-man arguments; Fermi estimation; pre-mortem post-mortems; "the best way to review an argument is to try to refute it".
