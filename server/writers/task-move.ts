import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { assertSafeTasksPath, resolveTasksPath, safetyError } from "../safety.js";
import { writeFileAtomic } from "./atomic.js";
import { addTask } from "./task-add.js";
import { extractSlug } from "./slug.js";
import { invalidateFile } from "../vault-cache.js";

const TASK_LINE_RE = /^(\s*)- \[([ xX])\]\s+(.+)$/;

export interface MoveTaskInput {
  sourcePath: string;
  line: number;       // 1-based line in source file
  targetSlug: string; // destination project slug
}

export interface MoveTaskResult {
  sourceSlug: string;
  targetSlug: string;
}

/**
 * Moves a task from one project's tasks.md to another.
 * 1. Reads the source file and removes line N (and any trailing blank line it left).
 * 2. Atomically writes the source file.
 * 3. Calls addTask to append to the target project under ## Open.
 *
 * Both slugs are returned so the caller can broadcast two SSE events.
 *
 * Sprint I.9 R1 — Codex TASK-MOVE-NONATOMIC-PARTIAL-COMMIT (MEDIUM):
 * previously, if `addTask` threw after the source rewrite had already
 * committed to disk, the task would be GONE from source but NEVER
 * inserted into target — silent user-visible data loss. Fix: snapshot
 * the ORIGINAL source contents before rewriting; wrap `addTask` in
 * try/catch and, on failure, restore source to its pre-move state
 * AND re-invalidate the cache so the UI stays consistent with disk.
 *
 * The compensation is best-effort — if restoring source itself fails
 * (e.g. disk full between original write and rollback), we surface the
 * compound error so the caller's 5xx response reflects the true state.
 * The alternative (silently succeeding with half-state) is strictly
 * worse under the "ultimate snappiest" mandate.
 */
export async function moveTask(input: MoveTaskInput): Promise<MoveTaskResult> {
  const { line, targetSlug } = input;
  const sourcePath = resolveTasksPath(input.sourcePath);

  assertSafeTasksPath(sourcePath);

  if (typeof line !== "number" || !Number.isInteger(line) || line < 1) {
    throw safetyError("line must be a positive integer", 400);
  }

  if (!targetSlug || typeof targetSlug !== "string") {
    throw safetyError("targetSlug must be a non-empty string", 400);
  }
  if (targetSlug.includes("..") || targetSlug.includes("/") || targetSlug.includes("\0")) {
    throw safetyError("targetSlug contains illegal characters", 403);
  }

  if (!existsSync(sourcePath)) {
    throw safetyError(`tasks.md not found: ${sourcePath}`, 404);
  }

  const content = await readFile(sourcePath, "utf8");
  const lines = content.split("\n");
  const zeroIdx = line - 1;

  if (zeroIdx < 0 || zeroIdx >= lines.length) {
    throw safetyError(`Line ${line} out of range (file has ${lines.length} lines)`, 409);
  }

  const targetLine = lines[zeroIdx];
  const match = TASK_LINE_RE.exec(targetLine);
  if (!match) {
    throw safetyError(`Line ${line} is not a task checkbox: ${targetLine.slice(0, 80)}`, 409);
  }

  // Extract the raw text (including @owner annotations)
  const extractedText = match[3].trim();

  // Remove the task line from the source
  lines.splice(zeroIdx, 1);

  // If removing the line left a double-blank (blank line followed by blank line
  // or section heading preceded by blank), clean it up to avoid ugly whitespace.
  // We only collapse consecutive blank lines — we never remove section headings.
  const cleaned = collapseConsecutiveBlanks(lines);

  // Snapshot the ORIGINAL source contents so we can restore on target-side
  // failure. Captured BEFORE the source rewrite commits to disk. Sprint I.9 R1
  // Codex TASK-MOVE-NONATOMIC-PARTIAL-COMMIT.
  const originalSourceContent = content;

  // Write source atomically first — before touching the target
  await writeFileAtomic(sourcePath, cleaned.join("\n"));

  // Sprint I.4.6 — invalidate source project cache BEFORE addTask
  // touches target (addTask's own invalidate covers targetSlug).
  // Keeps the vault-cache consistent during the cross-project move.
  await invalidateFile(sourcePath);

  const sourceSlug = extractSlug(sourcePath);

  // Add to target — addTask internally invalidates targetSlug's cache
  // (I.4.4 wire-in), so we don't need a second invalidateProject here.
  //
  // On failure, compensate by restoring source to its pre-move state so
  // the user's task is not silently destroyed. If restore itself fails,
  // surface a compound error describing BOTH the target write failure
  // AND the source restore failure — the caller can log + bubble a 500.
  try {
    await addTask({ slug: targetSlug, text: extractedText, section: "open" });
  } catch (addErr) {
    try {
      await writeFileAtomic(sourcePath, originalSourceContent);
      await invalidateFile(sourcePath);
    } catch (restoreErr) {
      const addMsg = addErr instanceof Error ? addErr.message : String(addErr);
      const restoreMsg = restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
      throw safetyError(
        `task-move failed to add to target (${addMsg}) AND failed to restore source (${restoreMsg}). Task may be in inconsistent state — check ${sourcePath}.`,
        500,
      );
    }
    // Source restored successfully. Re-throw the original target-side error
    // so the caller sees the genuine failure cause.
    throw addErr;
  }

  return { sourceSlug, targetSlug };
}

/**
 * Collapses runs of 3+ blank lines down to 2 blank lines (one empty separator).
 * Prevents whitespace buildup when many tasks are moved out of a section.
 */
function collapseConsecutiveBlanks(lines: string[]): string[] {
  const result: string[] = [];
  let blankRun = 0;

  for (const line of lines) {
    if (line.trim() === "") {
      blankRun++;
      if (blankRun <= 2) result.push(line);
    } else {
      blankRun = 0;
      result.push(line);
    }
  }

  return result;
}
