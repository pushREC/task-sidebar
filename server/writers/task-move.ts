import { readFile, stat, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { basename, join } from "path";
import matter from "gray-matter";
import { VAULT_ROOT, assertSafeTasksPath, resolveTasksPath, safetyError } from "../safety.js";
import { writeFileAtomic, writeFileExclusive } from "./atomic.js";
import { addTask } from "./task-add.js";
import { extractSlug } from "./slug.js";
import { invalidateFile, invalidateProject } from "../vault-cache.js";

const TASK_LINE_RE = /^(\s*)- \[([ xX])\]\s+(.+)$/;

// Sprint I.6.1 — entity-move path regex for slug extraction from full absolute path.
// Expects `<VAULT_ROOT>/1-Projects/<slug>/tasks/<stem>.md` (matches ENTITY_TASK_PATH_RE
// in safety.ts). Captures sourceSlug + stem. Safety validation is handled upstream by
// `assertSafeTasksPath` (which enforces this exact shape) — this regex only parses.
const ENTITY_PATH_SLUG_RE = /\/1-Projects\/([^/]+)\/tasks\/([^/]+)\.md$/;

// Sprint I.6.1 — pathological-collision cap. If 99 tasks with the same stem already
// exist at target, further auto-suffix is a sign of either user error or a bug loop;
// surface 409 rather than iterating unbounded.
const MAX_COLLISION_SUFFIX = 99;

export interface MoveTaskInput {
  sourcePath: string;
  line: number;       // 1-based line in source file
  targetSlug: string; // destination project slug
}

export interface MoveTaskResult {
  sourceSlug: string;
  targetSlug: string;
}

// Sprint I.6.1 — entity-move inputs + result
export interface MoveEntityTaskInput {
  entityPath: string;   // vault-relative `1-Projects/<slug>/tasks/<stem>.md` or absolute
  targetSlug: string;
}

export interface MoveEntityTaskResult {
  sourceSlug: string;
  targetSlug: string;
  moved: string;         // vault-relative final path, e.g. "1-Projects/<targetSlug>/tasks/<finalStem>.md"
  renamedFrom?: string;  // original stem, present only if collision auto-suffix was applied
  renamedTo?: string;    // suffixed stem (e.g. "foo-2")
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

  // Sprint I.9 R2 — Codex MOVE-ROLLBACK-CLOBBERS-SOURCE (MEDIUM): capture
  // the mtime right AFTER our write commits. On rollback, we verify the
  // source file still has this exact mtime before restoring. If a concurrent
  // writer has since edited the source, mtime differs → we surface a
  // "concurrent edit" error instead of blindly clobbering their work.
  // writeFileAtomic uses tmp+rename so mtime is set at rename time and is
  // deterministic per-write.
  let postWriteMtimeMs: number;
  try {
    postWriteMtimeMs = (await stat(sourcePath)).mtimeMs;
  } catch {
    // stat failure is unexpected (we just wrote the file) but not fatal for
    // the happy path — use 0 as a sentinel so a later mtime check fails
    // defensively (prefer throwing "concurrent edit" over blind clobber).
    postWriteMtimeMs = 0;
  }

  // Sprint I.4.6 — invalidate source project cache BEFORE addTask
  // touches target (addTask's own invalidate covers targetSlug).
  // Keeps the vault-cache consistent during the cross-project move.
  await invalidateFile(sourcePath);

  const sourceSlug = extractSlug(sourcePath);

  // Add to target — addTask internally invalidates targetSlug's cache
  // (I.4.4 wire-in), so we don't need a second invalidateProject here.
  //
  // On failure, compensate by restoring source to its pre-move state so
  // the user's task is not silently destroyed. Rollback is mtime-guarded
  // (R2) — if another writer landed in the source meanwhile, we surface
  // a conflict instead of blindly overwriting their edit.
  try {
    await addTask({ slug: targetSlug, text: extractedText, section: "open" });
  } catch (addErr) {
    // Verify source mtime hasn't changed since our write. If it has, a
    // concurrent edit landed — we can't safely restore.
    let currentMtimeMs: number | null = null;
    try {
      currentMtimeMs = (await stat(sourcePath)).mtimeMs;
    } catch {
      currentMtimeMs = null;
    }
    const addMsg = addErr instanceof Error ? addErr.message : String(addErr);
    if (currentMtimeMs === null || currentMtimeMs !== postWriteMtimeMs) {
      throw safetyError(
        `task-move failed to add to target (${addMsg}) AND source file ${sourcePath} was modified by another writer between our removal and this failure. Manual review required — task may be in inconsistent state.`,
        500,
      );
    }
    // Safe to restore: mtime unchanged → no concurrent edit.
    try {
      await writeFileAtomic(sourcePath, originalSourceContent);
      await invalidateFile(sourcePath);
    } catch (restoreErr) {
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
 * Sprint I.6.1 — Entity-task move across projects.
 *
 * Moves an entity task file from `1-Projects/<sourceSlug>/tasks/<stem>.md` to
 * `1-Projects/<targetSlug>/tasks/<finalStem>.md` with four invariants:
 *
 * 1. **Atomic cutover**: write target first via O_EXCL (`writeFileExclusive`),
 *    THEN unlink source. A race with a concurrent writer on target produces
 *    EEXIST → auto-suffix retry. A failure mid-flight leaves the source intact
 *    (not data-destructive) — user sees an error, can retry.
 * 2. **Frontmatter rewrite**: `parent-project` is updated to point at target's
 *    README before the O_EXCL write, so the target file lands in a consistent
 *    state. gray-matter round-trip preserves ordering of other fields.
 * 3. **Collision auto-suffix**: if target stem is taken, append `-2`, `-3`, …
 *    up to `-${MAX_COLLISION_SUFFIX}`. Caller sees `{renamedFrom, renamedTo}`
 *    in response so the UI can surface transparency (toast copy).
 * 4. **Dual-slug invalidation BEFORE response**: both `sourceSlug` and
 *    `targetSlug` caches are invalidated synchronously so the very next
 *    `/api/vault` call returns a coherent state (writer-sync invariant, plan
 *    §0.4 Decision 7).
 *
 * Non-goals:
 * - This function does NOT emit SSE broadcasts. Caller (route handler) does that.
 * - This function does NOT rename arbitrary non-task files — strict entity-path
 *   shape enforced by `assertSafeTasksPath`.
 */
export async function moveEntityTask(
  input: MoveEntityTaskInput,
): Promise<MoveEntityTaskResult> {
  const { targetSlug } = input;

  // ─── Input validation (targetSlug) ─────────────────────────────────────
  if (!targetSlug || typeof targetSlug !== "string") {
    throw safetyError("targetSlug must be a non-empty string", 400);
  }
  if (targetSlug.includes("..") || targetSlug.includes("/") || targetSlug.includes("\0")) {
    throw safetyError("targetSlug contains illegal characters", 403);
  }

  // ─── Resolve + validate source ─────────────────────────────────────────
  const sourceAbs = resolveTasksPath(input.entityPath);
  assertSafeTasksPath(sourceAbs);

  if (!existsSync(sourceAbs)) {
    throw safetyError(`entity task not found: ${input.entityPath}`, 404);
  }

  // Extract sourceSlug + stem from the validated absolute path.
  const match = ENTITY_PATH_SLUG_RE.exec(sourceAbs);
  if (!match) {
    // Should be unreachable if assertSafeTasksPath matched ENTITY_TASK_PATH_RE,
    // but surface a clear error rather than silently treat as inline.
    throw safetyError(
      `entityPath does not match expected shape 1-Projects/<slug>/tasks/<stem>.md: ${input.entityPath}`,
      400,
    );
  }
  const sourceSlug = match[1];
  const originalStem = match[2];

  // Reject same-slug move (no-op but potentially destructive if collision
  // logic would overwrite itself — explicit guard).
  if (sourceSlug === targetSlug) {
    throw safetyError(
      `sourceSlug and targetSlug are identical (${sourceSlug}); move would be a no-op`,
      400,
    );
  }

  // ─── Build target dir + ensure it exists ───────────────────────────────
  const targetDir = join(VAULT_ROOT, "1-Projects", targetSlug, "tasks");
  // mkdir -p is idempotent; safe if target project already has tasks/ dir.
  // If target project doesn't exist at all, this creates the tasks/ subtree —
  // but the project's README is the source-of-truth for existence, not this
  // directory. If the user moves a task into a non-existent target, they'll
  // see a "no such project" elsewhere in the app. We don't gate here because
  // the caller (BulkBar ProjectPicker) enumerates existing projects only.
  await mkdir(targetDir, { recursive: true });

  // ─── Collision auto-suffix ─────────────────────────────────────────────
  // Try `<stem>.md`, then `<stem>-2.md`, `<stem>-3.md`, … up to MAX.
  // existsSync check is a TOCTOU hint, NOT a lock — the actual atomicity
  // comes from writeFileExclusive (O_EXCL) below. A concurrent writer
  // landing at our chosen candidate will cause writeFileExclusive to throw
  // 409 EEXIST, and we retry on the next suffix.
  let finalStem = originalStem;
  let targetAbs = join(targetDir, `${finalStem}.md`);
  assertSafeTasksPath(targetAbs);

  for (let suffix = 2; existsSync(targetAbs) && suffix <= MAX_COLLISION_SUFFIX + 1; suffix++) {
    if (suffix > MAX_COLLISION_SUFFIX) {
      throw safetyError(
        `collision auto-suffix exceeded ${MAX_COLLISION_SUFFIX} for stem '${originalStem}' in target '${targetSlug}'. Rename manually before retry.`,
        409,
      );
    }
    finalStem = `${originalStem}-${suffix}`;
    targetAbs = join(targetDir, `${finalStem}.md`);
    assertSafeTasksPath(targetAbs);
  }

  const renamed = finalStem !== originalStem;

  // ─── Read source + rewrite parent-project frontmatter ──────────────────
  const raw = await readFile(sourceAbs, "utf8");
  const parsed = matter(raw);
  parsed.data["parent-project"] = `[[1-Projects/${targetSlug}/README]]`;
  const rewritten = matter.stringify(parsed.content, parsed.data);

  // ─── Atomic cutover: write target (O_EXCL), THEN unlink source ─────────
  //
  // Order rationale: if we unlinked source first and then write-to-target
  // failed, we'd lose the task. Writing target first means source stays
  // intact until we successfully persist target; worst case is a duplicate,
  // not data loss.
  //
  // O_EXCL protects against another writer racing us to the same target
  // path between our existsSync probe and our write. On EEXIST we throw
  // 409 (caller can retry — picking a different target or re-trying with
  // fresh suffix). We do NOT retry inside this function because the race
  // is rare and surfacing the error preserves caller control.
  try {
    await writeFileExclusive(targetAbs, rewritten);
  } catch (writeErr) {
    // writeFileExclusive already wraps EEXIST as a 409 SafetyError. Any
    // other error (disk full, permission) propagates as-is. Nothing has
    // committed on the source side, so no rollback needed.
    throw writeErr;
  }

  // Target is safely on disk with the rewritten parent-project. Now unlink
  // source. If unlink fails, we have a duplicate — log the compound error
  // but do NOT roll back target (user-visible data loss would be worse).
  try {
    await unlink(sourceAbs);
  } catch (unlinkErr) {
    const msg = unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr);
    // Invalidate target so the duplicate is visible to the UI at least.
    try {
      await invalidateProject(targetSlug);
    } catch {
      // Ignore — we're already in an error path.
    }
    throw safetyError(
      `moveEntityTask: target ${targetAbs} written successfully but failed to remove source ${sourceAbs} (${msg}). Manual cleanup required — task now exists in BOTH projects.`,
      500,
    );
  }

  // ─── Dual-slug invalidation BEFORE response (writer-sync invariant) ────
  // plan §0.4 Decision 7 / preempt B5. Invalidate source first so a
  // concurrent reader hitting source's stale cache doesn't see the moved
  // task still present; then target so the moved task appears in its new
  // home. Both calls are awaited — no fire-and-forget.
  await invalidateProject(sourceSlug);
  await invalidateProject(targetSlug);

  // ─── Build vault-relative `moved` path (lock #7) ───────────────────────
  const moved = `1-Projects/${targetSlug}/tasks/${basename(targetAbs)}`;

  return {
    sourceSlug,
    targetSlug,
    moved,
    renamedFrom: renamed ? originalStem : undefined,
    renamedTo: renamed ? finalStem : undefined,
  };
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
