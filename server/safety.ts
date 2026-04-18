import { resolve, dirname, basename } from "path";
import { realpathSync, existsSync } from "fs";

const VAULT_ROOT = "/Users/robertzinke/pushrec-vault";

const FORBIDDEN_SEGMENTS = ["4-Archive", "Templates", ".obsidian"];

// Matches: <VAULT_ROOT>/1-Projects/<slug>/tasks.md  (legacy inline)
const TASKS_PATH_RE = /^\/[^/].*\/1-Projects\/([^/]+)\/tasks\.md$/;

// Matches: <VAULT_ROOT>/1-Projects/<slug>/tasks/<task-slug>.md  (entity tasks)
const ENTITY_TASK_PATH_RE = /^\/[^/].*\/1-Projects\/([^/]+)\/tasks\/([^/]+)\.md$/;

// Matches: <VAULT_ROOT>/1-Projects/<slug>/README.md or <slug>/<SLUG>-README.md  (project frontmatter)
const README_PATH_RE = /^\/[^/].*\/1-Projects\/([^/]+)\/[^/]*README\.md$/;

/** Validates a slug string (no empty, no traversal chars, no nulls). */
function validateSlug(slug: string, label: string): void {
  if (!slug || slug.length === 0) {
    throw safetyError(`${label} is empty`, 403);
  }
  if (slug.includes("..") || slug.includes("/") || slug.includes("\0")) {
    throw safetyError(`${label} contains illegal characters`, 403);
  }
}

/**
 * Throws a structured error with a `statusCode` property if the path is not
 * a safe write target. Call this before every file write.
 *
 * Allowed shapes:
 *   <VAULT_ROOT>/1-Projects/<slug>/tasks.md          (legacy inline)
 *   <VAULT_ROOT>/1-Projects/<slug>/tasks/<slug>.md   (entity task file)
 *   <VAULT_ROOT>/1-Projects/<slug>/README.md          (project README)
 */
export function assertSafeTasksPath(rawPath: string): void {
  if (!rawPath || typeof rawPath !== "string") {
    throw safetyError("Path must be a non-empty string", 400);
  }

  // Must be absolute
  if (!rawPath.startsWith("/")) {
    throw safetyError("Path must be absolute", 403);
  }

  // Reject null bytes early
  if (rawPath.includes("\0")) {
    throw safetyError("Path contains null bytes", 403);
  }

  // Resolve to catch any .. traversal
  const resolved = resolve(rawPath);

  // Resolve symlinks so a symlink pointing outside vault is caught.
  // If the file doesn't exist yet (e.g. creating a new entity file),
  // resolve the parent directory instead and rejoin the filename.
  let realResolved: string;
  try {
    if (existsSync(resolved)) {
      realResolved = realpathSync(resolved);
    } else {
      const parentReal = realpathSync(dirname(resolved));
      realResolved = resolve(parentReal, basename(resolved));
    }
  } catch {
    // Parent dir doesn't exist either — use string-level resolved path;
    // the startsWith(VAULT_ROOT) check below will still catch traversal attempts.
    realResolved = resolved;
  }

  // Must live under VAULT_ROOT
  if (!realResolved.startsWith(VAULT_ROOT + "/") && realResolved !== VAULT_ROOT) {
    throw safetyError("Path escapes vault root", 403);
  }

  // Reject forbidden segments (check on realResolved to catch symlinks into forbidden dirs)
  for (const seg of FORBIDDEN_SEGMENTS) {
    if (realResolved.includes("/" + seg + "/") || realResolved.endsWith("/" + seg)) {
      throw safetyError(`Path targets forbidden directory: ${seg}`, 403);
    }
  }

  // Try each allowed pattern
  const readmeMatch = README_PATH_RE.exec(realResolved);
  if (readmeMatch) {
    validateSlug(readmeMatch[1], "Project slug");
    return; // README path is valid
  }

  const entityMatch = ENTITY_TASK_PATH_RE.exec(realResolved);
  if (entityMatch) {
    validateSlug(entityMatch[1], "Project slug");
    validateSlug(entityMatch[2], "Task slug");
    return; // Entity task path is valid
  }

  const tasksMatch = TASKS_PATH_RE.exec(realResolved);
  if (tasksMatch) {
    validateSlug(tasksMatch[1], "Project slug");
    return; // Legacy tasks.md path is valid
  }

  // None matched
  throw safetyError(
    "Path must match one of: <VAULT_ROOT>/1-Projects/<slug>/tasks.md, " +
      "<VAULT_ROOT>/1-Projects/<slug>/tasks/<task-slug>.md, or " +
      "<VAULT_ROOT>/1-Projects/<slug>/README.md",
    403
  );
}

/**
 * Trims whitespace and validates task text.
 * Throws 400 if the text is invalid.
 * Returns the cleaned string.
 */
export function escapeTaskText(raw: string): string {
  if (typeof raw !== "string") {
    throw safetyError("Task text must be a string", 400);
  }

  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    throw safetyError("Task text must not be empty", 400);
  }

  if (trimmed.length > 500) {
    throw safetyError("Task text exceeds 500 character limit", 400);
  }

  if (trimmed.includes("\n") || trimmed.includes("\r")) {
    throw safetyError("Task text must not contain newlines", 400);
  }

  if (trimmed.startsWith("- [")) {
    throw safetyError(
      'Task text must not start with "- [" (would create a nested task)',
      400
    );
  }

  return trimmed;
}

/**
 * Accepts client-supplied path (vault-relative or absolute), returns an absolute
 * path under VAULT_ROOT. Call before assertSafeTasksPath.
 *
 * Caller must still call assertSafeTasksPath on the returned value — this only
 * normalizes input format; it does not validate safety.
 */
export function resolveTasksPath(input: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw safetyError("Path must be a non-empty string", 400);
  }
  if (input.startsWith("/")) return input;
  return resolve(VAULT_ROOT, input);
}

export interface SafetyError extends Error {
  statusCode: number;
}

export function safetyError(message: string, statusCode: number): SafetyError {
  const err = new Error(message) as SafetyError;
  err.statusCode = statusCode;
  return err;
}
