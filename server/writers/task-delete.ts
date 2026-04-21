import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { assertSafeTasksPath, resolveTasksPath, safetyError, VAULT_ROOT_SLASH } from "../safety.js";
import { writeFileAtomic } from "./atomic.js";
import { moveToTombstone, moveInlineToTombstone } from "./task-tombstone.js";
import { invalidateFile } from "../vault-cache.js";

/**
 * Task deletion — two shapes:
 *
 *   1. Entity task (canonical entity file under
 *      `<VAULT_ROOT>/1-Projects/<slug>/tasks/<task-slug>.md`) — hard unlink
 *      after path safety check.
 *
 *   2. Inline checkbox task in `<VAULT_ROOT>/1-Projects/<slug>/tasks.md` —
 *      remove the line at the given line number after confirming its text
 *      still matches what the client rendered from. This guards the common
 *      TOCTOU race where SSE triggers line shifts between read and delete.
 *
 * Both paths go through `assertSafeTasksPath` + `writeFileAtomic`
 * (or `fs.unlink`) so 4-Archive / Templates / .obsidian / symlinks
 * that escape VAULT_ROOT are uniformly rejected.
 */

const VAULT_ROOT = VAULT_ROOT_SLASH;

function toRelative(abs: string): string {
  return abs.startsWith(VAULT_ROOT) ? abs.slice(VAULT_ROOT.length) : abs;
}

// Mirrors vault-index.ts TASK_RE exactly — same regex drives both parse + delete.
const TASK_RE = /^(\s*)- \[([ xX/])\]\s+(.+)$/;

// ─── Entity delete ──────────────────────────────────────────────────────────

export interface TaskDeleteEntityInput {
  entityPath: string;
}

export interface TaskDeleteEntityResult {
  entityPath: string;      // vault-relative (what we deleted)
  tombstoneId?: string;    // Sprint H.3.3 — set when a tombstone was created
}

export async function deleteEntityTask(
  input: TaskDeleteEntityInput
): Promise<TaskDeleteEntityResult> {
  if (!input || typeof input.entityPath !== "string" || !input.entityPath) {
    throw safetyError("entityPath must be a non-empty string", 400);
  }

  const resolved = resolveTasksPath(input.entityPath);
  assertSafeTasksPath(resolved);

  // R2 CRITICAL (Codex) — assertSafeTasksPath intentionally admits three
  // shapes (README.md, tasks.md, entity task file). delete-entity must
  // narrow to the entity-task shape specifically; otherwise a caller
  // could POST `{entityPath: "1-Projects/foo/README.md"}` and delete the
  // project README. Mirror the same shape-check task-body-edit uses.
  if (!/\/1-Projects\/[^/]+\/tasks\/[^/]+\.md$/.test(resolved)) {
    throw safetyError("delete-entity is only valid for entity task files", 403);
  }

  // Idempotent: if the file is already gone, treat it as success. This
  // is friendlier than 404 when SSE or another agent beat us to it.
  if (!existsSync(resolved)) {
    return { entityPath: toRelative(resolved) };
  }

  // Sprint H.3.3 — replace hard unlink with tombstone rename. The
  // tombstone sweeper (server/index.ts) deletes the file ~5s later
  // if no restore came in. moveToTombstone throws on fs.rename error;
  // ENOENT races are handled by the sweeper's existsSync guard.
  try {
    const { tombstoneId } = await moveToTombstone(resolved);
    // Sprint I.4.13 — invalidate-after-success, before returning the
    // tombstoneId (plan §0.4 Decision 7 + preempt B5 delete path).
    // Only fires on successful tombstone move; ENOENT races below skip it.
    await invalidateFile(resolved);
    return { entityPath: toRelative(resolved), tombstoneId };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "ENOENT") {
      // Beat to the unlink by a concurrent SSE-triggered change.
      return { entityPath: toRelative(resolved) };
    }
    throw err;
  }
}

// ─── Inline delete ──────────────────────────────────────────────────────────

export interface TaskDeleteInlineInput {
  tasksPath: string;
  line: number;
  /**
   * The action text the client rendered from. The server reads the file,
   * locates the matching checkbox line at `line`, strips the owner tag,
   * and verifies the action equals this. Mismatch → 409 Conflict so the
   * client can refetch and retry.
   *
   * Without this guard, an SSE-triggered line shift (another agent added
   * a task above) would cause us to delete a different task than the
   * one the user clicked Delete on.
   */
  expectedAction: string;
}

export interface TaskDeleteInlineResult {
  tasksPath: string;      // vault-relative
  line: number;           // line we deleted
  tombstoneId?: string;   // Sprint H.3.4 — set when a tombstone was created
}

const OWNER_RE = /@owner\((human|agent|either)\)/;

export async function deleteInlineTask(
  input: TaskDeleteInlineInput
): Promise<TaskDeleteInlineResult> {
  if (!input || typeof input.tasksPath !== "string" || !input.tasksPath) {
    throw safetyError("tasksPath must be a non-empty string", 400);
  }
  if (typeof input.line !== "number" || !Number.isInteger(input.line) || input.line < 1) {
    throw safetyError("line must be a positive integer", 400);
  }
  if (typeof input.expectedAction !== "string" || !input.expectedAction) {
    throw safetyError("expectedAction must be a non-empty string", 400);
  }

  const resolved = resolveTasksPath(input.tasksPath);
  assertSafeTasksPath(resolved);

  // R2 CRITICAL (Codex) — narrow to the tasks.md shape so delete-inline
  // can't be steered at an entity task file or a README.
  if (!/\/1-Projects\/[^/]+\/tasks\.md$/.test(resolved)) {
    throw safetyError("delete-inline is only valid for project tasks.md", 403);
  }

  if (!existsSync(resolved)) {
    throw safetyError(`tasks.md not found: ${toRelative(resolved)}`, 404);
  }

  const raw = await readFile(resolved, "utf8");
  const lines = raw.split("\n");

  const idx = input.line - 1;
  if (idx < 0 || idx >= lines.length) {
    throw safetyError(`line ${input.line} out of range (1..${lines.length})`, 409);
  }

  const match = TASK_RE.exec(lines[idx]);
  if (!match) {
    throw safetyError(
      `line ${input.line} is not a task checkbox (vault changed — refetch and retry)`,
      409
    );
  }

  const rawText = match[3].trim();
  const actionOnFile = rawText.replace(OWNER_RE, "").trim();
  const expected = input.expectedAction.trim();
  if (actionOnFile !== expected) {
    throw safetyError(
      `line ${input.line} text mismatch (vault changed — refetch and retry)`,
      409
    );
  }

  // Sprint H.3.4 — BEFORE removing the line, write a tombstone marker
  // that records exactly which line was removed + its full text.
  // restoreFromTombstone reads the filename-encoded metadata and
  // splices the text back in. If the tombstone write fails, we
  // propagate — no partial state (line stays in file).
  const { tombstoneId } = await moveInlineToTombstone({
    tasksPath: resolved,
    line: input.line,
    text: lines[idx], // the whole line (includes the checkbox + owner + text)
  });

  // Remove the line. Preserve file-ending newline convention: if the
  // original ended with "\n" (i.e. last array element is ""), re-add it.
  const endedWithNewline = lines.length > 0 && lines[lines.length - 1] === "";
  const remaining = lines.filter((_, i) => i !== idx);
  let updated = remaining.join("\n");
  if (endedWithNewline && !updated.endsWith("\n")) updated += "\n";

  await writeFileAtomic(resolved, updated);

  // Sprint I.4.13 — invalidate-before-return for inline delete (plan §0.4
  // Decision 7). Pairs with the entity-path invalidate above + B5 preempt.
  await invalidateFile(resolved);

  return { tasksPath: toRelative(resolved), line: input.line, tombstoneId };
}
