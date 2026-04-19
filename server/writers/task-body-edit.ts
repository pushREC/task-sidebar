import { readFile } from "fs/promises";
import { existsSync } from "fs";
import matter from "gray-matter";
import { assertSafeTasksPath, resolveTasksPath, safetyError, VAULT_ROOT_SLASH } from "../safety.js";
import { writeFileAtomic } from "./atomic.js";
import { assertMtimeMatch } from "./mtime-lock.js";

/**
 * Replaces the markdown body (everything after frontmatter) of an entity
 * task file. Frontmatter is parsed, preserved as-is, and re-serialized
 * via `gray-matter.stringify`. Body may be empty — callers delete notes
 * by sending `body: ""`.
 *
 * Rejects:
 *   - Non-entity paths (handled by assertSafeTasksPath)
 *   - Missing file (404)
 *   - Body > MAX_BODY_LEN (400)
 *   - Body containing null bytes (400)
 *   - Body starting with `---\n` or `---\r\n` (400) — would look like a
 *     second frontmatter block to re-parsers; defensive ban (Sprint E C1)
 */

const VAULT_ROOT = VAULT_ROOT_SLASH;
const MAX_BODY_LEN = 64 * 1024;   // 64KB ceiling on notes

function toRelative(abs: string): string {
  return abs.startsWith(VAULT_ROOT) ? abs.slice(VAULT_ROOT.length) : abs;
}

export interface TaskBodyEditInput {
  entityPath: string;
  body: string;
  // Sprint H.2.2 — optional optimistic-concurrency token. When present,
  // the server asserts `fs.stat(resolvedPath).mtime.toISOString()` equals
  // this value before the write. Mismatch → 409 with currentModified in
  // the response so the client can refetch before overwriting.
  expectedModified?: string;
}

export interface TaskBodyEditResult {
  entityPath: string;   // vault-relative
}

export async function editTaskBody(
  input: TaskBodyEditInput
): Promise<TaskBodyEditResult> {
  if (!input || typeof input.entityPath !== "string" || !input.entityPath) {
    throw safetyError("entityPath must be a non-empty string", 400);
  }
  if (typeof input.body !== "string") {
    throw safetyError("body must be a string", 400);
  }
  if (input.body.length > MAX_BODY_LEN) {
    throw safetyError(`body exceeds ${MAX_BODY_LEN} bytes`, 400);
  }
  if (input.body.includes("\0")) {
    throw safetyError("body must not contain null bytes", 400);
  }

  // Reject content that looks like a second frontmatter block. gray-matter
  // only parses the leading `---\n ... ---` block, so sneaking in a
  // frontmatter-shaped prefix wouldn't corrupt our parse — but other
  // vault tools (Obsidian plugins, life-os scripts) may re-parse and
  // get confused. Reject defensively rather than guess intent.
  if (/^---\s*\r?\n/.test(input.body)) {
    throw safetyError("body must not start with a frontmatter block (---)", 400);
  }

  const resolved = resolveTasksPath(input.entityPath);
  assertSafeTasksPath(resolved);

  // Must be an entity file (not tasks.md or README.md). assertSafeTasksPath
  // admits all three shapes; narrow to the entity-task shape here so
  // callers can't edit README bodies or tasks.md via this endpoint.
  if (!/\/1-Projects\/[^/]+\/tasks\/[^/]+\.md$/.test(resolved)) {
    throw safetyError("body-edit is only valid for entity task files", 403);
  }

  if (!existsSync(resolved)) {
    throw safetyError(`Entity task file not found: ${toRelative(resolved)}`, 404);
  }

  // Sprint H.2.2 — optimistic-lock check BEFORE readFile so a mismatch
  // short-circuits without paying the read cost. If input.expectedModified
  // is undefined (backward-compat) this is a no-op.
  await assertMtimeMatch(resolved, input.expectedModified);

  const raw = await readFile(resolved, "utf8");
  const parsed = matter(raw);

  // R1 FINDING-4 — trim BEFORE length check so whitespace-only bodies
  // (" ", "\n", "\t\n") don't oscillate between "\n\n" and "\n" across
  // saves. Invariant now: empty trimmed → "" (no trailing); non-empty
  // trimmed → "\n" + body + "\n" (stable on repeat saves).
  const trimmed = input.body.trim();
  const normalizedBody = trimmed.length === 0 ? "" : "\n" + trimmed + "\n";

  // R1 FINDING-5 — gray-matter's stringify output trailing-newline count
  // is implementation-dependent; force exactly one trailing "\n" so
  // repeated reads + writes are idempotent.
  const stringified = matter.stringify(normalizedBody, parsed.data);
  const updated = stringified.replace(/\n*$/, "\n");
  await writeFileAtomic(resolved, updated);

  return { entityPath: toRelative(resolved) };
}
