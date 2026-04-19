# Contributing

This is a personal-use project shared as reference inspiration. Contributions are welcome but not actively solicited. Before opening a PR, read this file + [`CLAUDE.md`](CLAUDE.md) + [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Quickstart for contributors

```bash
git clone https://github.com/robertzinke/task-sidebar
cd task-sidebar
pnpm install
pnpm dev              # serves against sample-vault/
```

## Quality gates — required before every commit

```bash
pnpm tsc --noEmit          # must return empty
bash scripts/verify.sh     # must end with "TOTAL: 37 / 37 passed, 0 failed"
```

The AI-tell grep battery inside `verify.sh` enforces the anti-pattern list in [`docs/UI-UX.md` §6](docs/UI-UX.md#6-anti-patterns--explicitly-rejected). Any of these in your diff = CI failure:

- `font-bold`
- `as any`
- `console.log|warn|debug` in `src/`
- Unicode pseudo-icons (`⚙`, `⏎`, `›`, `○`, `●`)
- `task.text` (field was renamed to `task.action` in v2.0)
- emoji anywhere

## Agent governance

If you're a Claude Code agent working on this codebase, read [`CLAUDE.md`](CLAUDE.md) first. It is authoritative over the 10 architecture locks. Don't violate any without explicit user approval — see [`docs/DECISIONS.md`](docs/DECISIONS.md) for the rationale behind each.

## Commit message format

Plan-phase-based naming:

```
sprint-<letter>-<task-id>: <short imperative summary>

<longer body if needed — the "why", not the "what">

<optional Co-Authored-By trailer>
```

Example: `sprint-h-2.1: add mtime optimistic-lock helper`.

## PR checklist

Before requesting review:

- [ ] `pnpm tsc --noEmit` clean
- [ ] `bash scripts/verify.sh` 37/37 (fresh server)
- [ ] AI-tell greps empty (see above)
- [ ] If UI change: tested at 320 + 480 + 725px viewport widths
- [ ] If safety change: cross-reference [`docs/SECURITY.md`](docs/SECURITY.md) — don't regress the safety boundary
- [ ] If any lock from `docs/DECISIONS.md` changed: explicitly note in PR body + explain why

## Convergence protocol for larger changes

Anything > ~200 LoC or anything touching safety-layer code should go through the 3-parallel-critic convergence protocol described in [`docs/PLANNING-DISCIPLINE.md`](docs/PLANNING-DISCIPLINE.md). If you don't have Opus + Gemini CLI + Codex CLI to hand, at minimum write out the counter-arguments + tradeoff analysis before the PR.

## Running against your own vault

```bash
VAULT_ROOT=/path/to/your/vault pnpm dev
```

Sample vault structure required — see [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md). If your vault doesn't match the PARA shape, either adapt it or point at the bundled `sample-vault/` for testing.

## Reporting issues

Open a GitHub issue. Include:
- HEAD sha of your checkout
- `pnpm tsc --noEmit` output
- `bash scripts/verify.sh` tail
- Minimum reproduction if the bug is behavioral

## License

MIT — see [`LICENSE`](LICENSE). By contributing you agree to license your contributions under MIT.
