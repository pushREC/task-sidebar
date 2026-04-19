import { readFile } from "fs/promises";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import matter from "gray-matter";
import { assertSafeTasksPath, safetyError, VAULT_ROOT, VAULT_ROOT_SLASH } from "../safety.js";
import { writeFileAtomic } from "./atomic.js";

// Canonical project fields editable via the field-edit endpoint.
// `status` is ALSO here — project-status doesn't have a state machine yet.
// `created`, `tags`, `parent-project` stay immutable.
// `progress`, `tasks-done-count`, `tasks-not-done-count`, `tasks-overdue-count` are INFERRED.
const EDITABLE_PROJECT_FIELDS = new Set([
  "outcome",
  "status",
  "deadline",
  "target-date",
  "start-date",
  "parent-goal",
  "driver",
  "due",
  "description",
]);

const PROJECT_STATUS_ENUM = new Set([
  "backlog",
  "not-started",
  "active",        // DECISION-083
  "on-track",      // entity-schemas.md
  "at-risk",
  "off-track",
  "overdue",
  "blocked",
  "paused",
  "done",
  "cancelled",
]);

const DRIVER_ENUM = new Set(["human", "agent", "collaborative"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WIKILINK_RE = /^\[\[[^\]\n]{1,200}\]\]$/;
const MAX_STRING_LEN = 2048;

function findProjectReadme(slug: string): string | undefined {
  const projectDir = join(VAULT_ROOT, "1-Projects", slug);
  if (!existsSync(projectDir)) return undefined;
  try {
    const entries = readdirSync(projectDir);
    const readme = entries.find((f) => f === "README.md") ??
      entries.find((f) => f.endsWith("README.md") && !f.startsWith("."));
    return readme ? join(projectDir, readme) : undefined;
  } catch {
    return undefined;
  }
}

function toRelative(abs: string): string {
  return abs.startsWith(VAULT_ROOT_SLASH) ? abs.slice(VAULT_ROOT_SLASH.length) : abs;
}

function validateProjectValue(field: string, value: unknown): unknown {
  if (value === "" || value === null || value === undefined) return undefined;

  if (field === "outcome" || field === "description") {
    if (typeof value !== "string") throw safetyError(`${field} must be a string`, 400);
    if (value.length > MAX_STRING_LEN) throw safetyError(`${field} exceeds ${MAX_STRING_LEN} chars`, 400);
    return value;
  }

  if (field === "status") {
    if (typeof value !== "string" || !PROJECT_STATUS_ENUM.has(value)) {
      throw safetyError(`status must be one of: ${[...PROJECT_STATUS_ENUM].join(", ")}`, 400);
    }
    return value;
  }

  if (field === "driver") {
    if (typeof value !== "string" || !DRIVER_ENUM.has(value)) {
      throw safetyError(`driver must be one of: ${[...DRIVER_ENUM].join(", ")}`, 400);
    }
    return value;
  }

  if (field === "deadline" || field === "target-date" || field === "start-date" || field === "due") {
    if (typeof value !== "string" || !ISO_DATE_RE.test(value)) {
      throw safetyError(`${field} must be YYYY-MM-DD`, 400);
    }
    return value;
  }

  if (field === "parent-goal") {
    if (typeof value !== "string") throw safetyError("parent-goal must be a string", 400);
    if (!WIKILINK_RE.test(value)) throw safetyError("parent-goal must be a wikilink [[...]]", 400);
    return value;
  }

  throw safetyError(`${field} validation not implemented`, 500);
}

export interface ProjectFieldEditInput {
  slug: string;
  field: string;
  value: unknown;
}

export interface ProjectFieldEditResult {
  readmePath: string;  // vault-relative
}

export async function editProjectField(input: ProjectFieldEditInput): Promise<ProjectFieldEditResult> {
  const { slug, field } = input;

  if (!slug || typeof slug !== "string") {
    throw safetyError("slug must be a non-empty string", 400);
  }
  if (slug.includes("..") || slug.includes("/") || slug.includes("\0")) {
    throw safetyError("slug contains illegal characters", 403);
  }

  if (!field || typeof field !== "string") {
    throw safetyError("field must be a non-empty string", 400);
  }
  if (field.includes("\0") || field.includes("\n") || field.length > 64) {
    throw safetyError("field contains illegal characters or exceeds 64 chars", 400);
  }
  if (!EDITABLE_PROJECT_FIELDS.has(field)) {
    throw safetyError(
      `field "${field}" is not editable. Allowed: ${[...EDITABLE_PROJECT_FIELDS].join(", ")}`,
      400
    );
  }

  const validated = validateProjectValue(field, input.value);

  const readmePath = findProjectReadme(slug);
  if (!readmePath) {
    throw safetyError(`README not found for project slug "${slug}"`, 404);
  }

  assertSafeTasksPath(readmePath);

  const raw = await readFile(readmePath, "utf8");
  const parsed = matter(raw);

  if (validated === undefined) {
    delete parsed.data[field];
  } else {
    parsed.data[field] = validated;
  }

  const updated = matter.stringify(parsed.content, parsed.data);
  await writeFileAtomic(readmePath, updated);

  return { readmePath: toRelative(readmePath) };
}
