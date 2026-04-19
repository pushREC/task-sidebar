# Life-OS Integration (Optional)

> task-sidebar ships with two optional subprocess integrations. If you don't configure them, everything degrades gracefully. This doc is for anyone who wants to wire them up.

## What these scripts provide

**priority_infer.py** — given `impact + urgency + due + parent-goal-timeframe`, returns a priority rank (P1–P4) + numeric score + breakdown. task-sidebar calls this on every `/api/vault` read via a 4-worker subprocess pool with 500ms hard timeout + LRU cache. Without it, tasks surface `priority: null` and the UI renders an unranked chip.

**status_reconcile.py** — fire-and-forget subprocess called on every `status: "done"` transition. Handles parent-goal rollup (e.g. closing a task marks its parent project as "in-progress" if first task done, etc.). 3-second timeout. Without it, done-transitions stay local to the task file.

Both are part of the author's private `life-os` orchestrator skill. The scripts are not included in this repo.

## Script API contracts

If you want to build your own drop-in replacements, here are the exact interfaces task-sidebar expects:

### priority_infer.py

**Invocation** — `python3 <script> --json [--impact X] [--urgency Y] [--due YYYY-MM-DD] [--goal-timeframe Z]`

**Inputs** (all optional — if all omitted, task-sidebar doesn't call the script):
- `--impact` — `low` | `medium` | `high`
- `--urgency` — `low` | `medium` | `high`
- `--due` — ISO 8601 date
- `--goal-timeframe` — e.g. `Q1-2026`, `Q2-2026`, etc.

**Output** — JSON to stdout:
```json
{
  "score": 42,
  "rank": "high",
  "breakdown": {
    "impact_weight": 2,
    "urgency_weight": 3,
    "due_proximity": 1.5,
    "goal_alignment": 1
  }
}
```

`rank` must be one of `"critical" | "high" | "medium" | "low"`. These map to P1/P2/P3/P4 pills in the UI.

**Failure modes** — non-zero exit OR timeout OR malformed JSON → task-sidebar treats as `null` and surfaces the unranked chip. Never crashes.

### status_reconcile.py

**Invocation** — `python3 <script>` (no args).

**Behavior** — whatever you want. task-sidebar spawns the process after every `status: "done"` write, with 3s hard timeout, and doesn't wait for result. The script's stdout/stderr is captured to the task-sidebar stderr log.

**Typical behavior** (in the author's life-os) — walks the vault, finds any task that just transitioned to done, and updates the parent project's progress + goal's progress. It's a rollup script.

## How to enable

1. Write (or install) the two Python scripts somewhere on disk.
2. Set env vars before starting the server:

```bash
export PRIORITY_SCRIPT_PATH=/absolute/path/to/priority_infer.py
export RECONCILE_SCRIPT_PATH=/absolute/path/to/status_reconcile.py
pnpm dev
```

3. Verify in the UI — tasks should now show P1/P2/P3/P4 pills instead of the empty chip.
4. Test done-transition: toggle a task to done, check that `status_reconcile.py` is being invoked (observe stderr log or add logging to the script itself).

## Minimal reference implementation

If you want to build your own `priority_infer.py` from scratch, here's a 30-line starter:

```python
#!/usr/bin/env python3
"""Minimal priority inference script for task-sidebar."""
import argparse, json, sys
from datetime import datetime

IMPACT = {"low": 1, "medium": 2, "high": 3}
URGENCY = {"low": 1, "medium": 2, "high": 3}

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--json", action="store_true")
    p.add_argument("--impact")
    p.add_argument("--urgency")
    p.add_argument("--due")
    p.add_argument("--goal-timeframe")
    args = p.parse_args()

    impact = IMPACT.get(args.impact, 0)
    urgency = URGENCY.get(args.urgency, 0)
    due_proximity = 0
    if args.due:
        try:
            days = (datetime.fromisoformat(args.due).date() - datetime.now().date()).days
            due_proximity = max(0, 5 - days / 7)  # closer = higher
        except ValueError:
            pass

    score = impact * 2 + urgency * 2 + due_proximity
    if score >= 9: rank = "critical"
    elif score >= 6: rank = "high"
    elif score >= 3: rank = "medium"
    else: rank = "low"

    print(json.dumps({
        "score": round(score, 2),
        "rank": rank,
        "breakdown": {
            "impact_weight": impact,
            "urgency_weight": urgency,
            "due_proximity": round(due_proximity, 2),
            "goal_alignment": 0,
        }
    }))

if __name__ == "__main__":
    main()
```

Save as `priority_infer.py`, `chmod +x`, set `PRIORITY_SCRIPT_PATH` to point at it. That's the complete integration.

`status_reconcile.py` is even simpler — even an empty `if __name__ == "__main__": pass` script works (it just becomes a true no-op, which is fine).

## Why keep this optional

task-sidebar's value is the UI + the task model + the safety layer. Priority inference is a nice-to-have; making it mandatory would force everyone to install Python + maintain external scripts. Making it env-gated keeps the ship-it-and-run experience trivial while leaving power-users room to wire up sophisticated rollup logic.

If the scripts were bundled in this repo, task-sidebar would become opinionated about *how* you rank priorities. The author's life-os opinion is strong (it includes parent-goal alignment bonuses, quarter-boundary boosts, etc.) and won't match everyone's. The env-var contract lets you BYO-logic without any code changes to task-sidebar itself.
