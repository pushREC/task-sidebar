import { readFile } from "fs/promises";
import { existsSync } from "fs";
import matter from "gray-matter";
import { assertSafeTasksPath, resolveTasksPath, safetyError } from "../safety.js";
import { writeFileAtomic } from "./atomic.js";

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

const VAULT_ROOT = "/Users/robertzinke/pushrec-vault/";
const MAX_BODY_LEN = 64 * 1024;   // 64KB ceiling on notes

function toRelative(abs: string): string {
  return abs.startsWith(VAULT_ROOT) ? abs.slice(VAULT_ROOT.length) : abs;
}

export interface TaskBodyEditInput {
  entityPath: string;
  body: string;
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

  const raw = await readFile(resolved, "utf8");
  const parsed = matter(raw);

  // matter.stringify adds exactly one trailing newline after the frontmatter
  // block. Ensure body has a leading blank line for readability, and trim
  // trailing whitespace to keep the file clean across repeated edits.
  const normalizedBody = "\n" + input.body.replace(/\s+$/g, "") + (input.body.length > 0 ? "\n" : "");

  const updated = matter.stringify(normalizedBody, parsed.data);
  await writeFileAtomic(resolved, updated);

  return { entityPath: toRelative(resolved) };
}
