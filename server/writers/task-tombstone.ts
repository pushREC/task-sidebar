import { rename, unlink, readdir, mkdir, stat, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";
import { safetyError, assertSafeTasksPath } from "../safety.js";
import { writeFileAtomic } from "./atomic.js";

/**
 * Sprint H.3.1 — real delete-undo via tombstoned files.
 *
 * On delete, the file is RENAMED (fs.rename — atomic on POSIX) into
 * `${VAULT_ROOT}/.vault-sidebar-tombstones/` with a filename that
 * encodes: timestamp, kind (entity|inline), original-path, and (for
 * inline deletes) the line number + the checkbox text.
 *
 * A sweeper (setInterval in server/index.ts) unlinks tombstones older
 * than TOMBSTONE_TTL_MS (5s window — matches UndoToast 5s lifetime).
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
export const TOMBSTONE_TTL_MS = 5500; // slight slack past UndoToast 5s window
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

function encodeInline(
  absTasksPath: string,
  line: number,
  text: string,
  timestamp: number,
): string {
  const rel = absTasksPath.startsWith(VAULT_ROOT + "/")
    ? absTasksPath.slice(VAULT_ROOT.length + 1)
    : absTasksPath;
  const b64text = Buffer.from(text, "utf8").toString("base64");
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
      text: Buffer.from(inlineMatch[4], "base64").toString("utf8"),
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

export async function moveInlineToTombstone(
  input: MoveInlineToTombstoneInput,
): Promise<MoveToTombstoneResult> {
  await ensureTombstoneDir();
  const timestamp = Date.now();
  const dstName = encodeInline(input.tasksPath, input.line, input.text, timestamp);
  const dstPath = `${TOMBSTONE_DIR}/${dstName}`;
  assertSafeTombstonePath(dstPath);
  // For inline, we store a small marker file; the text is in the filename
  // (base64). The file body is unused but written as "" so the existsSync
  // probe from the sweeper works.
  await writeFile(dstPath, "", "utf8");
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
    if (existsSync(targetAbs)) {
      throw safetyError(
        `Original path re-occupied; cannot restore without overwrite: ${decoded.originalPath}`,
        409,
        { originalPath: decoded.originalPath },
      );
    }
    await rename(tombstonePath, targetAbs);
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
  const raw = await readFile(targetAbs, "utf8");
  const lines = raw.split("\n");
  const insertIdx = Math.min(Math.max(0, decoded.line - 1), lines.length);
  lines.splice(insertIdx, 0, decoded.text);
  let updated = lines.join("\n");
  // Preserve trailing-newline convention of the original file.
  if (raw.endsWith("\n") && !updated.endsWith("\n")) updated += "\n";
  await writeFileAtomic(targetAbs, updated);
  await unlink(tombstonePath);
  return { kind: "inline", restoredPath: decoded.originalPath };
}

// ── Sweeper + orphan cleanup ───────────────────────────────────────────────

/** Delete any tombstone with mtime older than maxAgeMs. Returns count. */
export async function sweepTombstones(maxAgeMs: number = TOMBSTONE_TTL_MS): Promise<number> {
  if (!existsSync(TOMBSTONE_DIR)) return 0;
  const names = await readdir(TOMBSTONE_DIR);
  const now = Date.now();
  let swept = 0;
  for (const name of names) {
    const full = `${TOMBSTONE_DIR}/${name}`;
    try {
      const st = await stat(full);
      if (now - st.mtimeMs > maxAgeMs) {
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
