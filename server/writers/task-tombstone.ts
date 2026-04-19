import { rename, unlink, readdir, mkdir, stat, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";
import { safetyError, assertSafeTasksPath } from "../safety.js";
import { writeFileAtomic, writeFileExclusive } from "./atomic.js";

/**
 * Sprint H.3.1 — real delete-undo via tombstoned files.
 *
 * On delete, the file is RENAMED (fs.rename — atomic on POSIX) into
 * `${VAULT_ROOT}/.vault-sidebar-tombstones/` with a filename that
 * encodes: timestamp, kind (entity|inline), original-path, and (for
 * inline deletes) the line number + the checkbox text.
 *
 * A sweeper (setInterval in server/index.ts) unlinks tombstones older
 * than TOMBSTONE_TTL_MS (8s — UndoToast 5s client window + 3s network-RTT
 * margin. Widened from 5500ms in Sprint H R2 D4 per Gemini R1 LOW finding
 * "TTL-TIGHTNESS": 500ms margin was vulnerable to slow-connection latency
 * letting the sweeper beat a user's restore click).
 * A startup cleanup drops orphans older than ORPHAN_TTL_MS (1h) so
 * a server crash mid-window doesn't leak stale tombstones indefinitely.
 *
 * Safety invariants (Plan II §0.2 T-H4, T-H5, §0.3 Decision 3):
 *   - TOMBSTONE_DIR is at VAULT_ROOT, OUTSIDE chokidar's `1-Projects/`
 *     watched tree → tombstones never leak into /api/vault responses.
 *   - assertSafeTombstonePath whitelists only `.vault-sidebar-tombstones/*`
 *     — the restore endpoint validates both tombstone path AND the
 *     derived target path (via assertSafeTasksPath).
 *   - Filenames URI-encode the original path + use base64 for inline
 *     text so checkbox special chars + `/` survive round-trip.
 *
 * Tombstone filename formats:
 *   - entity: `{timestamp}__entity__{uriEncoded(originalRelPath)}.md`
 *   - inline: `{timestamp}__inline__{uriEncoded(tasksPath)}__{line}__{base64(text)}.tombstone`
 */

export const VAULT_ROOT = "/Users/robertzinke/pushrec-vault";
export const TOMBSTONE_DIR = `${VAULT_ROOT}/.vault-sidebar-tombstones`;
export const TOMBSTONE_TTL_MS = 8000; // UndoToast 5s + 3s network-RTT margin (R2 D4)
export const ORPHAN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Ensure the tombstone directory exists with mode 700. Idempotent.
 * Called at server boot (before app.listen) and lazily as a safety net.
 */
export async function ensureTombstoneDir(): Promise<void> {
  try {
    await mkdir(TOMBSTONE_DIR, { recursive: true, mode: 0o700 });
  } catch (err) {
    throw safetyError(`Failed to create tombstone directory: ${err}`, 500);
  }
}

/** Path-safety check dedicated to tombstones. Accept ONLY paths inside
 *  TOMBSTONE_DIR, no `..` traversal, no null bytes. */
export function assertSafeTombstonePath(rawPath: string): void {
  if (!rawPath || typeof rawPath !== "string") {
    throw safetyError("tombstone path must be a non-empty string", 400);
  }
  if (rawPath.includes("\0") || rawPath.includes("..")) {
    throw safetyError("tombstone path contains illegal characters", 403);
  }
  const resolved = resolve(rawPath);
  if (!resolved.startsWith(TOMBSTONE_DIR + "/")) {
    throw safetyError("tombstone path escapes tombstone directory", 403);
  }
}

// Filename encoding: we need to distinguish entity vs inline tombstones,
// round-trip the original path, preserve inline line + text, and stay
// within filesystem name limits. ISO timestamps are sortable and compact.

function encodeEntity(absSrcPath: string, timestamp: number): string {
  // Strip VAULT_ROOT prefix so the original-path segment doesn't contain
  // the root twice when decoded.
  const rel = absSrcPath.startsWith(VAULT_ROOT + "/")
    ? absSrcPath.slice(VAULT_ROOT.length + 1)
    : absSrcPath;
  return `${timestamp}__entity__${encodeURIComponent(rel)}.md`;
}

// R1 CRITICAL (Gemini TOMBSTONE-FILENAME-B64-SLASH + Opus #1) — standard
// base64 uses `/`, `+`, `=` chars. `/` in a filename creates subfolders,
// breaking writeFile. Use URL-safe base64 (RFC 4648 §5): `-` for `+`,
// `_` for `/`, strip `=` padding. Decoding reverses the swap + pads.
function urlSafeBase64Encode(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function urlSafeBase64Decode(s: string): string {
  // Restore standard base64 alphabet + re-pad.
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const standard = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(standard, "base64").toString("utf8");
}

function encodeInline(
  absTasksPath: string,
  line: number,
  text: string,
  timestamp: number,
): string {
  const rel = absTasksPath.startsWith(VAULT_ROOT + "/")
    ? absTasksPath.slice(VAULT_ROOT.length + 1)
    : absTasksPath;
  const b64text = urlSafeBase64Encode(text);
  return `${timestamp}__inline__${encodeURIComponent(rel)}__${line}__${b64text}.tombstone`;
}

function decodeTombstoneName(name: string):
  | { kind: "entity"; timestamp: number; originalPath: string }
  | { kind: "inline"; timestamp: number; originalPath: string; line: number; text: string }
  | null {
  // entity: {timestamp}__entity__{encoded}.md
  // inline: {timestamp}__inline__{encoded}__{line}__{base64}.tombstone
  const entityMatch = /^(\d+)__entity__(.+)\.md$/.exec(name);
  if (entityMatch) {
    return {
      kind: "entity",
      timestamp: parseInt(entityMatch[1], 10),
      originalPath: decodeURIComponent(entityMatch[2]),
    };
  }
  const inlineMatch = /^(\d+)__inline__(.+?)__(\d+)__(.+)\.tombstone$/.exec(name);
  if (inlineMatch) {
    return {
      kind: "inline",
      timestamp: parseInt(inlineMatch[1], 10),
      originalPath: decodeURIComponent(inlineMatch[2]),
      line: parseInt(inlineMatch[3], 10),
      text: urlSafeBase64Decode(inlineMatch[4]),
    };
  }
  return null;
}

// ── Entity tombstone: rename file into tombstone dir ──────────────────────

export interface MoveToTombstoneResult {
  tombstoneId: string; // absolute path to the tombstone file
}

export async function moveToTombstone(absSrcPath: string): Promise<MoveToTombstoneResult> {
  await ensureTombstoneDir();
  const timestamp = Date.now();
  const dstName = encodeEntity(absSrcPath, timestamp);
  const dstPath = `${TOMBSTONE_DIR}/${dstName}`;
  // Verify destination is safe (paranoia against encoding bugs).
  assertSafeTombstonePath(dstPath);
  await rename(absSrcPath, dstPath);
  return { tombstoneId: dstName };
}

// ── Inline tombstone: write a sidecar file that records the removed line ──

export interface MoveInlineToTombstoneInput {
  tasksPath: string; // absolute
  line: number; // 1-based
  text: string;
}

// R1 HIGH (Opus #1, Gemini) — macOS APFS filename component limit is 255
// BYTES (not chars). If the tombstone name would exceed, truncate the
// base64(text) payload but preserve the prefix so decodeTombstoneName
// still surfaces the path+line. The restored line is still byte-identical
// IF truncation didn't hit; otherwise we fall back to storing the text
// in the file BODY (and encode a sentinel `@FILE` token in the name).
const MAX_TOMBSTONE_NAME_BYTES = 240; // APFS 255 with a small safety margin

export async function moveInlineToTombstone(
  input: MoveInlineToTombstoneInput,
): Promise<MoveToTombstoneResult> {
  await ensureTombstoneDir();
  const timestamp = Date.now();
  let dstName = encodeInline(input.tasksPath, input.line, input.text, timestamp);
  let fileBody = "";
  if (Buffer.byteLength(dstName, "utf8") > MAX_TOMBSTONE_NAME_BYTES) {
    // Overflow fallback: encode a sentinel in the name, put the raw text
    // in the file body. decodeTombstoneName detects `@FILE` and signals
    // the restore code to read body.
    const rel = input.tasksPath.startsWith(VAULT_ROOT + "/")
      ? input.tasksPath.slice(VAULT_ROOT.length + 1)
      : input.tasksPath;
    dstName = `${timestamp}__inline__${encodeURIComponent(rel)}__${input.line}__@FILE.tombstone`;
    fileBody = input.text;
  }
  const dstPath = `${TOMBSTONE_DIR}/${dstName}`;
  assertSafeTombstonePath(dstPath);
  try {
    await writeFile(dstPath, fileBody, "utf8");
  } catch (err) {
    // R1 MEDIUM (Opus #6) — surface meaningful error instead of generic 500.
    throw safetyError(`Failed to write tombstone: ${String(err)}`, 500);
  }
  return { tombstoneId: dstName };
}

// ── Restore ────────────────────────────────────────────────────────────────

export interface RestoreResult {
  kind: "entity" | "inline";
  restoredPath: string; // vault-relative
}

export async function restoreFromTombstone(tombstoneId: string): Promise<RestoreResult> {
  // Validate id shape — no path traversal, no slashes.
  if (tombstoneId.includes("/") || tombstoneId.includes("..") || tombstoneId.includes("\0")) {
    throw safetyError("tombstoneId contains illegal characters", 403);
  }
  const tombstonePath = `${TOMBSTONE_DIR}/${tombstoneId}`;
  assertSafeTombstonePath(tombstonePath);

  if (!existsSync(tombstonePath)) {
    throw safetyError(`Tombstone not found: ${tombstoneId}`, 404);
  }

  const decoded = decodeTombstoneName(tombstoneId);
  if (!decoded) {
    throw safetyError(`Tombstone filename unrecognized: ${tombstoneId}`, 400);
  }

  if (decoded.kind === "entity") {
    const targetAbs = `${VAULT_ROOT}/${decoded.originalPath}`;
    assertSafeTasksPath(targetAbs);
    // R1 CRITICAL (Opus #4) — fs.rename SILENTLY OVERWRITES existing
    // target on POSIX. Use writeFileExclusive (O_EXCL) pattern: read
    // tombstone bytes → writeFileExclusive target (throws EEXIST if
    // occupied) → unlink tombstone on success. This closes the
    // existsSync→rename TOCTOU window.
    if (existsSync(targetAbs)) {
      throw safetyError(
        `Original path re-occupied; cannot restore without overwrite: ${decoded.originalPath}`,
        409,
        { originalPath: decoded.originalPath },
      );
    }
    try {
      const bytes = await readFile(tombstonePath);
      await writeFileExclusive(targetAbs, bytes.toString("utf8"));
      await unlink(tombstonePath);
    } catch (err) {
      // R1 MEDIUM (Opus #3) — sweeper race: tombstone swept between
      // decode and read → ENOENT. Translate to 404 for the client.
      if (err && typeof err === "object" && "code" in err) {
        const code = (err as { code?: string }).code;
        if (code === "ENOENT") {
          throw safetyError(`Tombstone swept before restore completed`, 404);
        }
        if (code === "EEXIST") {
          throw safetyError(
            `Original path re-occupied between check and write: ${decoded.originalPath}`,
            409,
            { originalPath: decoded.originalPath },
          );
        }
      }
      throw err;
    }
    return { kind: "entity", restoredPath: decoded.originalPath };
  }

  // inline restore: re-insert the line at position `line` (1-based)
  const targetAbs = `${VAULT_ROOT}/${decoded.originalPath}`;
  assertSafeTasksPath(targetAbs);
  if (!existsSync(targetAbs)) {
    throw safetyError(
      `tasks.md missing for inline restore: ${decoded.originalPath}`,
      404,
    );
  }
  // Determine text source: filename-encoded (default) or file-body
  // (overflow fallback sentinel `@FILE`).
  let text = decoded.text;
  if (text === "@FILE") {
    try {
      text = await readFile(tombstonePath, "utf8");
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "ENOENT") {
        throw safetyError(`Tombstone swept before restore completed`, 404);
      }
      throw err;
    }
  }
  const raw = await readFile(targetAbs, "utf8");
  const lines = raw.split("\n");
  const insertIdx = Math.min(Math.max(0, decoded.line - 1), lines.length);
  lines.splice(insertIdx, 0, text);
  let updated = lines.join("\n");
  // Preserve trailing-newline convention of the original file.
  if (raw.endsWith("\n") && !updated.endsWith("\n")) updated += "\n";
  await writeFileAtomic(targetAbs, updated);
  try { await unlink(tombstonePath); } catch { /* may have been swept — OK */ }
  return { kind: "inline", restoredPath: decoded.originalPath };
}

// ── Sweeper + orphan cleanup ───────────────────────────────────────────────

/** Delete any tombstone older than maxAgeMs (based on the timestamp
 *  encoded in the filename, NOT fs mtime). Returns count.
 *
 *  Sprint H R2 critic-fix (Codex R2-TOMBSTONE-MTIME HIGH) — fs.rename
 *  preserves the source file's mtime on POSIX, so for an entity task
 *  edited hours ago, the resulting tombstone's stat.mtimeMs is
 *  hours-old. That made the old stat.mtimeMs-based sweeper prune
 *  tombstones immediately after creation (mtime check passes trivially),
 *  collapsing the R2 D4 TTL widening to ~0s for any stale-edited
 *  entity task. Fix: parse the ISO-timestamp prefix from the tombstone
 *  filename; that value is set to Date.now() at moveToTombstone() time
 *  and reflects true tombstone-creation time. Fallback to stat.mtimeMs
 *  only for unparseable names (shouldn't happen, but fail safe). */
export async function sweepTombstones(maxAgeMs: number = TOMBSTONE_TTL_MS): Promise<number> {
  if (!existsSync(TOMBSTONE_DIR)) return 0;
  const names = await readdir(TOMBSTONE_DIR);
  const now = Date.now();
  let swept = 0;
  for (const name of names) {
    const full = `${TOMBSTONE_DIR}/${name}`;
    try {
      const decoded = decodeTombstoneName(name);
      let createdAt: number;
      if (decoded) {
        createdAt = decoded.timestamp;
      } else {
        // Unparseable filename — fall back to filesystem mtime as a
        // conservative safety net. Unknown-shape tombstones shouldn't
        // linger indefinitely; use maxAgeMs against stat anyway.
        const st = await stat(full);
        createdAt = st.mtimeMs;
      }
      if (now - createdAt > maxAgeMs) {
        await unlink(full);
        swept++;
      }
    } catch {
      // Tombstone may have been swept by a concurrent call; continue.
    }
  }
  return swept;
}

/** Startup-time: delete tombstones older than ORPHAN_TTL_MS. Handles
 *  crashes mid-window — prevents stale tombstones from accumulating
 *  across server restarts. */
export async function cleanupOrphans(ttlMs: number = ORPHAN_TTL_MS): Promise<number> {
  return sweepTombstones(ttlMs);
}

export function pendingTombstoneCountSync(): number {
  if (!existsSync(TOMBSTONE_DIR)) return 0;
  try {
    // Intentionally using the fs/promises readdir would be async;
    // this sync helper is for tests + debugging only.
    const fs = require("fs");
    return fs.readdirSync(TOMBSTONE_DIR).length;
  } catch {
    return 0;
  }
}
