import { readFile } from "fs/promises";
import { existsSync } from "fs";
import matter from "gray-matter";
import { assertSafeTasksPath, resolveTasksPath, safetyError } from "../safety.js";
import { writeFileAtomic } from "./atomic.js";
import { fireStatusReconcile } from "../status-reconcile.js";

const VALID_STATUSES = new Set([
  "backlog",
  "open",
  "in-progress",
  "blocked",
  "done",
  "cancelled",
]);

/**
 * Updates the `status:` frontmatter field on a canonical entity task file.
 * This is a dedicated code path (separate from task-field-edit) so we can
 * trigger status-reconcile when the task transitions to "done".
 *
 * Also updates the status anchor wikilink in the body when transitioning.
 */
export interface TaskStatusEditInput {
  entityPath: string;   // vault-relative or absolute
  status: string;       // new status value
}

export interface TaskStatusEditResult {
  entityPath: string;       // vault-relative
  reconcileFired: boolean;
}

const VAULT_ROOT_SLASH = "/Users/robertzinke/pushrec-vault/";
function toRelative(abs: string): string {
  return abs.startsWith(VAULT_ROOT_SLASH) ? abs.slice(VAULT_ROOT_SLASH.length) : abs;
}

export async function editTaskStatus(input: TaskStatusEditInput): Promise<TaskStatusEditResult> {
  const { status } = input;

  if (!status || !VALID_STATUSES.has(status)) {
    throw safetyError(
      `status must be one of: ${[...VALID_STATUSES].join(", ")}`,
      400
    );
  }

  const resolvedPath = resolveTasksPath(input.entityPath);
  assertSafeTasksPath(resolvedPath);

  if (!existsSync(resolvedPath)) {
    throw safetyError(`Entity task file not found: ${resolvedPath}`, 404);
  }

  const raw = await readFile(resolvedPath, "utf8");
  const parsed = matter(raw);

  const previousStatus = typeof parsed.data.status === "string" ? parsed.data.status : "open";
  parsed.data.status = status;

  // Update the status anchor wikilink in the body
  // Replace any existing [[3-Resources/anchors/status-*]] wikilink with the new one
  const anchorPattern = /\[\[3-Resources\/anchors\/status-[^\]]+\]\]/g;
  const newAnchor = `[[3-Resources/anchors/status-${status}]]`;
  let updatedContent = parsed.content;
  if (anchorPattern.test(updatedContent)) {
    updatedContent = updatedContent.replace(
      /\[\[3-Resources\/anchors\/status-[^\]]+\]\]/g,
      newAnchor
    );
  } else {
    // Prepend the anchor if not present
    updatedContent = `${newAnchor}\n${updatedContent}`;
  }

  const updated = matter.stringify(updatedContent, parsed.data);
  await writeFileAtomic(resolvedPath, updated);

  // Fire reconcile when transitioning to done (fire-and-forget)
  const transitioningToDone = status === "done" && previousStatus !== "done";
  if (transitioningToDone) {
    fireStatusReconcile();
  }

  return { entityPath: toRelative(resolvedPath), reconcileFired: transitioningToDone };
}
