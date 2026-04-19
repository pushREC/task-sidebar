import { readFile } from "fs/promises";
import { existsSync } from "fs";
import matter from "gray-matter";
import { assertSafeTasksPath, resolveTasksPath, safetyError, VAULT_ROOT_SLASH } from "../safety.js";
import { writeFileAtomic } from "./atomic.js";
import { assertMtimeMatch } from "./mtime-lock.js";

/**
 * Updates a single frontmatter field on a canonical entity task file.
 *
 * Field + value are validated against a strict allowlist before the write.
 * Fields outside the allowlist are rejected; `status` must route through
 * `editTaskStatus` so state-machine enforcement + reconcile hook fire.
 */
export interface TaskFieldEditInput {
  entityPath: string;
  field: string;
  value: unknown;
  // Sprint H.2.3 — optional optimistic-concurrency token. Same semantics
  // as task-body-edit: if present, server stats the file + compares
  // mtime ISO strings; mismatch → 409 with currentModified.
  expectedModified?: string;
}

export interface TaskFieldEditResult {
  entityPath: string;  // vault-relative — absolute paths never leak
}

const VAULT_ROOT = VAULT_ROOT_SLASH;

// Canonical task fields the client may edit directly via field-edit.
// `status` is deliberately absent — use editTaskStatus instead.
// `priority` is deliberately absent — DECISION-037 says it MUST be inferred, never stored.
// `created`, `tags`, `parent-project` are immutable via this endpoint.
const EDITABLE_FIELDS = new Set([
  "action",
  "owner",
  "energy-level",
  "estimated-duration",
  "due",
  "impact",
  "urgency",
  "blocked-by",
]);

const ENUM_VALUES: Record<string, Set<string>> = {
  owner: new Set(["human", "agent", "either"]),
  "energy-level": new Set(["low", "medium", "high"]),
  impact: new Set(["very-high", "high", "medium", "low", "very-low"]),
  urgency: new Set(["very-high", "high", "medium", "low", "very-low"]),
};

const MAX_STRING_LEN = 2048;
const MAX_DURATION_MIN = 60 * 24 * 30;  // 30 days ceiling
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WIKILINK_RE = /^\[\[[^\]\n]{1,200}\]\]$/;

function toRelative(abs: string): string {
  return abs.startsWith(VAULT_ROOT) ? abs.slice(VAULT_ROOT.length) : abs;
}

function validateValue(field: string, value: unknown): unknown {
  if (field === "action") {
    if (typeof value !== "string") throw safetyError("action must be a string", 400);
    const trimmed = value.trim();
    if (!trimmed) throw safetyError("action must not be empty", 400);
    if (trimmed.length > 500) throw safetyError("action must be <= 500 chars", 400);
    if (trimmed.includes("\n") || trimmed.includes("\r")) {
      throw safetyError("action must not contain newlines", 400);
    }
    return trimmed;
  }

  if (field === "estimated-duration") {
    const n = typeof value === "number" ? value : typeof value === "string" ? parseInt(value, 10) : NaN;
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > MAX_DURATION_MIN) {
      throw safetyError(`estimated-duration must be integer 0..${MAX_DURATION_MIN}`, 400);
    }
    return n;
  }

  if (field === "due") {
    if (value === "" || value === null || value === undefined) return undefined;
    if (typeof value !== "string" || !ISO_DATE_RE.test(value)) {
      throw safetyError("due must be YYYY-MM-DD", 400);
    }
    return value;
  }

  if (field === "blocked-by") {
    if (value === "" || value === null || value === undefined) return [];
    if (typeof value !== "string") throw safetyError("blocked-by must be a string", 400);
    if (value.length > MAX_STRING_LEN) throw safetyError("blocked-by too long", 400);
    const items = value.split(",").map((s) => s.trim()).filter(Boolean);
    for (const item of items) {
      if (!WIKILINK_RE.test(item)) {
        throw safetyError(`blocked-by entry must be a wikilink [[...]]: ${item}`, 400);
      }
    }
    return items;
  }

  const enumSet = ENUM_VALUES[field];
  if (enumSet) {
    if (value === "" || value === null || value === undefined) return undefined;
    if (typeof value !== "string" || !enumSet.has(value)) {
      throw safetyError(`${field} must be one of: ${[...enumSet].join(", ")}`, 400);
    }
    return value;
  }

  throw safetyError(`${field} validation not implemented`, 500);
}

export async function editTaskField(input: TaskFieldEditInput): Promise<TaskFieldEditResult> {
  const { field } = input;

  if (!field || typeof field !== "string") {
    throw safetyError("field must be a non-empty string", 400);
  }
  if (field.includes("\0") || field.includes("\n") || field.length > 64) {
    throw safetyError("field contains illegal characters or exceeds 64 chars", 400);
  }
  if (field === "status") {
    throw safetyError("use /api/tasks/status-edit to change status (enforces transitions + reconcile)", 400);
  }
  if (!EDITABLE_FIELDS.has(field)) {
    throw safetyError(
      `field "${field}" is not editable via field-edit. Allowed: ${[...EDITABLE_FIELDS].join(", ")}`,
      400
    );
  }

  const validated = validateValue(field, input.value);

  const resolvedPath = resolveTasksPath(input.entityPath);
  assertSafeTasksPath(resolvedPath);

  if (!existsSync(resolvedPath)) {
    throw safetyError(`Entity task file not found: ${toRelative(resolvedPath)}`, 404);
  }

  // Sprint H.2.3 — optimistic-lock BEFORE readFile. No-op when
  // expectedModified is undefined (backward-compat).
  await assertMtimeMatch(resolvedPath, input.expectedModified);

  const raw = await readFile(resolvedPath, "utf8");
  const parsed = matter(raw);

  if (validated === undefined) {
    delete parsed.data[field];
  } else {
    parsed.data[field] = validated;
  }

  const updated = matter.stringify(parsed.content, parsed.data);
  await writeFileAtomic(resolvedPath, updated);

  return { entityPath: toRelative(resolvedPath) };
}
