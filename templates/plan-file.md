# <Project Name> — <Plan Title>

> Copy this template when starting a new plan. Fill every section — do NOT skip any. See [`docs/PLANNING-DISCIPLINE.md`](../docs/PLANNING-DISCIPLINE.md) for the rationale behind each section + the banned-phrase list + the anti-mediocrity gate.

## 0. Context + Goals

<!--
Why is this work happening? What problem does it solve?
What is the intended outcome? Testable success criteria?
What is the unforgettable moment the user should feel?
Aesthetic/architecture constraints inherited from the existing codebase?
-->

## 0.1 Assumption Annihilation

<!--
Every assumption that must be true BEFORE the first line of code. Minimum 10 rows.
Each verification must be a shell command / HTTP request / file inspection — testable.
-->

| # | Assumption | Verification command | Expected output |
|---|---|---|---|
| A1 | | | |
| A2 | | | |

## 0.2 Irreducible Truths

<!--
Per phase, the minimum fact-set that MUST hold after the work lands.
Failure-subtraction test: removing any truth must break something concretely.
-->

**Phase X truths:**
- T-X1: <concrete testable statement>
- T-X2:

## 0.3 Validation Through Negation

<!--
Per locked decision: strongest counter-argument + tradeoff analysis + reverse conditions.
If you can't write a plausible counter-argument, think harder.
-->

**Decision 1 — <short name>**
- **Counter-argument**: <steelmanned case against>
- **Tradeoff analysis**: <why we accept the cost; cite evidence>
- **Reverse conditions**: <when we would flip this>

## 0.4 Locked Decisions

1. D1 — <one-line statement>
2. D2 —

## 0.5 Success Criteria

<!-- All testable. No prose. Everything grep-able or curl-able. -->

- [ ] `pnpm tsc --noEmit` returns empty
- [ ] `bash scripts/verify.sh` passes N/N
- [ ] Grep pattern X returns 0 matches
- [ ] Live check: curl Y returns Z

## 1. Dependency Graph + Critical Path

<!--
Text diagram of task dependencies. Mark the critical path explicitly.
Any task not on the critical path is a parallelization candidate.
-->

```
Phase A (prereq)
  ├─ A.1
  ├─ A.2 (depends: A.1) ← CRITICAL
  └─ A.3 (parallel with A.2)
```

## 2. Testing Strategy

### Unit tests
<!-- Exact file paths, exact function names, exact assertions. -->

### Integration tests
<!-- What 2+ components exercised together? Exact fixture. Exact command. -->

### E2E verification
<!-- Copy-pasteable sequence. Expected LITERAL output, not "should work". -->

## 3. Agent Orchestration

<!-- Answer all 13 questions if using multi-agent work. -->

| # | Question | Answer |
|---|---|---|
| 1 | How many agents? | |
| 2 | Relate? | parallel / sequential / iterative |
| 3 | How long? | |
| 4 | Validation? | |
| 5 | On failure? | |
| 6 | Persists? | |
| 7 | Output where? | |
| 8 | SSoT? | |
| 9 | Done detection? | |
| 10 | Progress measure? | |
| 11 | Session init? | |
| 12 | Work unit granularity? | |
| 13 | Runtime setup? | |

Per-agent: prompt, model, tools, success criteria, failure handling.

## 4. Claude Code Anti-Patterns Checklist

- [ ] No `sys.path.insert` cross-skill imports
- [ ] No `decision: "approve"` in PreToolUse (use `permissionDecision: "allow"`)
- [ ] No `rstrip("s")` for plural stripping
- [ ] No `--model` flag with subscription routing
- [ ] No `ANTHROPIC_API_KEY` leaked to subprocess env
- [ ] No `currentColor` in SVG data URIs
- [ ] No `var` in JavaScript (use `const`/`let`)
- [ ] Stop hooks check `stop_hook_active`
- [ ] No stdlib module shadows
- [ ] All HTTP requests have explicit timeout

## 5. Closed Feedback Loop

<!-- Where does state live? How do deviations propagate? -->

State-tracking file: `<path>`. Updated after every task completion.

Deviation protocol:
1. Record in "Deviations" section of state file
2. If deviation affects downstream tasks, update those before continuing
3. If deviation changes a locked decision, escalate to user

## 6. Per-Task Spec (repeat this block for every task)

### Task <ID>: <Verb> <Specific Object>

- **What:** <exact description — not "set up X" but "create file at /exact/path with these exact contents">
- **Why:** <what breaks without this>
- **Input:** <exact files/data, paths>
- **Output:** <exact files/data, paths>
- **Dependencies:** <task IDs that must complete first>
- **Verification:** <exact command + exact expected output>
- **Rollback:** <exact steps to undo>
- **Edge cases:** <empty input? missing? malformed? already exists?>

## 7. Convergence Protocol (per sprint boundary)

Launch 3 parallel critics (ONE tool message):
- Opus Explore agent (breadth + pattern)
- Gemini CLI (UX / a11y / ARIA / reduced-motion / i18n)
- Codex CLI (correctness / races / TOCTOU; **cap at 80 lines**)

Merge findings. Fix CRITICAL + HIGH + MEDIUM in commits. Document LOW deferrals. Re-run quality gates. Round closes when zero C/H/M across all 3.

## 8. Anti-Mediocrity Self-Score (before presenting)

| Dimension | Threshold | Score | Evidence |
|---|---|---|---|
| Depth | ≥8 | | |
| Grounding | ≥9 | | |
| Confidence | ≥8 | | |
| Novelty | ≥8 | | |
| Actionability | ≥9 | | |

If any <threshold, revise that section before presenting.

## 9. Open Questions

<!-- What's not yet decided? What would you ask the user if they were in the room? -->

---

*Template version: 1.0*
*See [docs/PLANNING-DISCIPLINE.md](../docs/PLANNING-DISCIPLINE.md) for the full discipline.*
