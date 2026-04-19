# Security

> task-sidebar runs on loopback (`127.0.0.1:5174`) with single-user trust. That does NOT mean the safety layer is optional — file-system writes to arbitrary paths are the biggest risk even for single-user tools. This doc catalogs what's hardened and how to verify.

## Threat model

Three realistic threats:

1. **Path traversal** — `"tasksPath": "../../etc/passwd"` would let an attacker write to arbitrary filesystem locations if unchecked.
2. **Symlink escape** — an attacker-controlled symlink pointing OUT of the vault would let writes through the realpath check trivially.
3. **TOCTOU race** — two concurrent creates with the same slug, or an editor modifying a file between our read + write, could leave the vault in an inconsistent state.

Out of scope: CSRF (loopback-only), auth (single-user), remote code execution (server doesn't exec user input).

## The safety boundary

All file-system writes go through `server/safety.ts`. Every writer in `server/writers/` imports `assertSafeTasksPath` + `resolveTasksPath` from there. Rule: **no writer calls `fs.writeFile`, `fs.rename`, or `fs.unlink` without first calling `assertSafeTasksPath` on the target**.

### Path validation (`assertSafeTasksPath`)

Order of checks (failing any throws `SafetyError` with status 403):

1. **Realpath resolution** — `realpathSync(path)` resolves symlinks. Result must `startsWith(VAULT_ROOT + "/")`. Blocks symlink escapes entirely.
2. **Forbidden-segment check** — path must NOT contain `4-Archive`, `Templates`, or `.obsidian` anywhere in its segments. These folders are read-only by policy.
3. **Shape match** — path must match one of three regexes:
   - `^.../1-Projects/<slug>/tasks\.md$`
   - `^.../1-Projects/<slug>/tasks/<task-slug>\.md$`
   - `^.../1-Projects/<slug>/[^/]*README\.md$`
4. **Slug validation** — each captured `<slug>` must not contain `..`, `/`, `\0`. Regex: `^[a-zA-Z0-9_-]+$`.

Verified by verify.sh tests:
- `Path traversal blocked (403)` — POST with `"tasksPath":"../../etc/passwd"` → 403
- `4-Archive blocked (403)` — POST with path inside `4-Archive/` → 403
- `Templates blocked (403)` — POST with path inside `Templates/` → 403
- `symlink to /etc/passwd blocked (403)` — create symlink inside vault pointing out → writer rejects

### Atomic writes (`server/writers/atomic.ts`)

Two primitives:

- **`writeFileAtomic(path, content)`** — writes to `{path}.tmp.{pid}.{counter}`, then `fs.rename` to target. Rename is atomic on POSIX. Used for all UPDATES.
- **`writeFileExclusive(path, content)`** — opens with `O_EXCL | O_CREAT | O_WRONLY`. Fails with EEXIST if target already exists. Used for all CREATES. Prevents TOCTOU where two concurrent creates would race.

Verified by verify.sh: `TOCTOU: 1×201 (others 409)` — 20 parallel creates of the same slug → exactly 1 succeeds with 201, 19 return 409.

### Field allowlist (`server/writers/task-field-edit.ts`)

`POST /api/tasks/field-edit` rejects any field not on the allowlist. Explicit rejections:

- `status` → 400 with `"use /api/tasks/status-edit"` (state machine is authoritative)
- `priority` → 400 with `"not editable"` (Lock #8 — inferred only)
- `created` → 400 (immutable creation timestamp)
- `constructor`, `__proto__`, `prototype` → 400 (prototype-pollution guards)

Verified by verify.sh: `field-edit rejects priority`, `field-edit rejects constructor`, `field-edit redirects status`.

### 50-parallel toggle race

Each `POST /api/tasks/toggle` reads, mutates, and writes the target `tasks.md`. Under concurrent load, each request independently reads the current state + writes its own result via `writeFileAtomic`. The atomic rename ensures there's always exactly one authoritative file on disk — no partial writes, no torn reads.

Verified by verify.sh: `50/50 parallel toggles` — fires 50 concurrent toggles, expects 50×200 responses, final file state is consistent.

Caveat: concurrent toggles on the same line race in terms of final state (last-writer-wins at the filesystem level). For mutation-order-sensitive operations (body-edit), use the mtime optimistic lock below.

### mtime optimistic lock (body-edit + field-edit)

Two endpoints (`/api/tasks/body-edit` + `/api/tasks/field-edit`) accept an optional `expectedModified` string from the client. When present:

1. Server stats the target file on disk.
2. If `stat.mtime.toISOString() !== expectedModified`, return 409 with `currentModified` in the response body.
3. Client surfaces a non-destructive conflict banner ("File was edited elsewhere. Row refreshed with latest — re-apply your change to save.").
4. Client refetches `/api/vault`; user's draft text remains in the textarea.

Rationale: prevents last-write-wins lost-update when the user's editor (Obsidian, etc.) is making concurrent changes. Failing loudly + preserving the draft is categorically better than silently overwriting.

Verified by: Plan II Sprint H live-verify logs (see `PLAN-II-LOG.md` in the author's vault; reproducible via `/api/tasks/body-edit` with mismatched `expectedModified`).

### Tombstone safety (`server/writers/task-tombstone.ts`)

Delete is not terminal — it's a tombstone-then-sweep. Guarantees:

- **Tombstone location** — `$VAULT_ROOT/.vault-sidebar-tombstones/` (mode 700). Outside the chokidar-watched `1-Projects/` glob, so moves don't emit spurious broadcasts.
- **Filename encoding** — `{timestampMs}__{entity|inline}__{urlSafeBase64(path)}.md`. URL-safe base64 (no `/` — would create subdirs). Rejected by `assertSafeTombstonePath` if decoded path contains `..` or `\0`.
- **APFS 255-byte filename ceiling** — if the encoded filename would exceed 240 bytes, falls back to storing text in file BODY with `@FILE` sentinel in filename.
- **Restore atomicity** — `writeFileExclusive` on the restore target. If another file now occupies the original path, restore returns 409 with `originalPath`. User decides (retry to new name vs accept collision).
- **Sweep** — `setInterval(sweepTombstones, 8000)`. Tombstone older than 8000ms (TTL) gets `fs.unlink`'d.
- **Sweep uses filename timestamp, NOT fs.mtime** — critical fix from supremacy-audit: `fs.rename` preserves source mtime on POSIX, so if a task hadn't been edited recently, the tombstone would appear instantly-expired to the mtime-based sweeper. The filename timestamp reflects true tombstone-creation time.
- **Crash recovery** — on boot, `cleanupOrphans()` sweeps any tombstone older than 1 hour. Protects against crashes between tombstone-creation and next sweep-tick.

Verified by:
- `verify.sh` — delete + restore round-trip returns byte-identical content
- `verify.sh` — tombstone with backdated filesystem mtime (simulating pre-sanitization) still survives the sweep for the full TTL

## Observability

Errors from the safety layer are structured as `SafetyError`:

```ts
{
  message: string,
  statusCode: 403 | 400 | 404 | 409 | 500,
  extra?: Record<string, unknown>  // e.g. {currentModified, currentModifiedNs}
}
```

`routes.ts` catches these + serializes to JSON: `{ok: false, error: message, ...extra}`. Never leaks stack traces to the client.

Server-side logging: `process.stderr.write(...)` for uncaught errors + tombstone-sweep events. No client-side telemetry.

## What's NOT secured (and why)

- **No auth** — single-user loopback. If you want multi-user, build a separate server with a proper auth layer; don't bolt it onto this one.
- **No rate limiting** — single-user tool; the concurrency tests (50-parallel toggle) were correctness probes, not capacity tests.
- **No CSRF tokens** — loopback-only; no browser from another origin can reach `127.0.0.1:5174` without the user's active consent.
- **No CSP** — irrelevant for a localhost dev tool; add if you deploy this externally (you shouldn't).

## Reporting a vulnerability

This is a personal-use tool published as reference inspiration. If you find a real security issue, open a GitHub issue or email the maintainer. Treat responsibly.

For the safety-layer verification battery, run:

```bash
bash scripts/verify.sh
```

Any `❌` in the output categorized under `Safety`, `50-parallel toggle`, `Symlink bypass`, or `TOCTOU regression` is a regression to fix before the next commit.
