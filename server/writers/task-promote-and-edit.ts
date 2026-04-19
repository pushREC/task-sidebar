import { readFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { join, dirname } from "path";
import { assertSafeTasksPath, resolveTasksPath, safetyError, VAULT_ROOT } from "../safety.js";
import { writeFileExclusive, writeFileAtomic } from "./atomic.js";
import { editTaskField } from "./task-field-edit.js";

// Matches inline checkbox tasks including [/]
const TASK_LINE_RE = /^(\s*)- \[([ xX/])\]\s+(.+)$/;
const OWNER_RE = /@owner\((human|agent|either)\)/;

function slugifyAction(action: string): string {
  return action
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function checkboxToStatus(char: string): string {
  const lower = char.toLowerCase();
  if (lower === "x") return "done";
  if (lower === "/") return "in-progress";
  return "open";
}

/** Simple YAML serializer for flat frontmatter. */
function buildYamlFrontmatter(data: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${String(item)}`);
        }
      }
    } else if (value === null || value === undefined || value === "") {
      lines.push(`${key}:`);
    } else if (typeof value === "string") {
      const needsQuotes = /[:#\[\]{},|>&*!'"?%@`]/.test(value) || value.trim() !== value;
      lines.push(needsQuotes ? `${key}: "${value.replace(/"/g, '\\"')}"` : `${key}: ${value}`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  return lines.join("\n");
}

export interface TaskPromoteAndEditInput {
  tasksPath: string;  // vault-relative or absolute path to tasks.md
  line: number;       // 1-based line number of the inline task
  field: string;      // field to set on the created entity file
  value: unknown;     // value for that field
}

export interface TaskPromoteAndEditResult {
  entityPath: string;  // vault-relative path to newly created entity file
  taskSlug: string;
}

/**
 * Atomically promotes an inline task to an entity file AND sets a field on it.
 *
 * Order of operations (fail-safe):
 *   1. Validate `field` and `value` against task-field-edit allowlist BEFORE any writes
 *   2. Read and parse the inline task line
 *   3. Create the entity file via writeFileExclusive (O_EXCL)
 *   4. Set the field on the entity file via editTaskField
 *   5. Remove line N from tasks.md via writeFileAtomic
 *
 * On failure at step 3 or 4 (before tasks.md is touched), entity file is cleaned up.
 * On failure at step 5 (tasks.md write), entity file remains but we report the error.
 */
export async function promoteAndEditTask(
  input: TaskPromoteAndEditInput
): Promise<TaskPromoteAndEditResult> {
  const { line, field, value } = input;

  // Step 1: Validate field + value BEFORE any writes
  // Reuse the same validation logic from task-field-edit; safetyError throws 400
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

  if (!field || typeof field !== "string") {
    throw safetyError("field must be a non-empty string", 400);
  }
  if (field === "status") {
    throw safetyError(
      "use /api/tasks/status-edit to change status (enforces transitions + reconcile)",
      400
    );
  }
  if (!EDITABLE_FIELDS.has(field)) {
    throw safetyError(
      `field "${field}" is not editable via field-edit. Allowed: ${[...EDITABLE_FIELDS].join(", ")}`,
      400
    );
  }

  if (typeof line !== "number" || !Number.isInteger(line) || line < 1) {
    throw safetyError("line must be a positive integer", 400);
  }

  const tasksPath = resolveTasksPath(input.tasksPath);
  assertSafeTasksPath(tasksPath);

  if (!existsSync(tasksPath)) {
    throw safetyError(`tasks.md not found: ${tasksPath}`, 404);
  }

  // Step 2: Read and parse the inline task line
  const content = await readFile(tasksPath, "utf8");
  const lines = content.split("\n");
  const zeroIdx = line - 1;

  if (zeroIdx < 0 || zeroIdx >= lines.length) {
    throw safetyError(`Line ${line} out of range (file has ${lines.length} lines)`, 409);
  }

  const targetLine = lines[zeroIdx];
  const match = TASK_LINE_RE.exec(targetLine);
  if (!match) {
    throw safetyError(
      `Line ${line} is not a task checkbox: ${targetLine.slice(0, 80)}`,
      409
    );
  }

  const checkboxChar = match[2];
  const rawText = match[3].trim();
  const ownerMatch = OWNER_RE.exec(rawText);
  const owner = ownerMatch ? ownerMatch[1] : undefined;
  const actionText = rawText.replace(OWNER_RE, "").trim();
  const status = checkboxToStatus(checkboxChar);
  const taskSlug = slugifyAction(actionText);

  if (!taskSlug || taskSlug.length === 0) {
    throw safetyError("Inline task text could not be slugified to a valid filename", 400);
  }

  // Derive project slug from tasks.md path
  const projectDir = dirname(tasksPath);
  const projectSlug = projectDir.split("/").pop() ?? "unknown";
  const tasksDir = join(projectDir, "tasks");
  const entityFilePath = join(tasksDir, `${taskSlug}.md`);
  const entityRelPath = `1-Projects/${projectSlug}/tasks/${taskSlug}.md`;

  // Safety check on entity path
  assertSafeTasksPath(entityFilePath);

  if (existsSync(entityFilePath)) {
    throw safetyError(`Entity task file already exists: ${entityRelPath}`, 409);
  }

  const today = new Date().toISOString().slice(0, 10);
  const parentProject = `[[1-Projects/${projectSlug}/README]]`;

  // Build entity file content
  const frontmatter: Record<string, unknown> = {
    created: today,
    tags: ["type/task"],
    action: actionText,
    "parent-project": parentProject,
    status,
    owner: owner ?? "",
    "energy-level": "",
    "estimated-duration": "",
    due: "",
    impact: "",
    urgency: "",
    "blocked-by": [],
    "related-resources": [],
  };

  const statusAnchor = `[[3-Resources/anchors/status-${status}]]`;
  const body = `${statusAnchor}\n\n# ${actionText}\n\n## Description\n<!-- Promoted from inline task -->\n\n\n## Subtasks\n- [ ]\n\n## Notes\n\n\n## Links\n- ${parentProject}\n`;
  const yamlLines = buildYamlFrontmatter(frontmatter);
  const fileContent = `---\n${yamlLines}\n---\n\n${body}`;

  // Step 3: Create entity file (O_EXCL — fails if exists)
  if (!existsSync(tasksDir)) {
    await mkdir(tasksDir, { recursive: true });
  }
  await writeFileExclusive(entityFilePath, fileContent);

  // Step 4: Set the field on the entity file — if this fails, clean up
  let fieldEditSucceeded = false;
  try {
    await editTaskField({ entityPath: entityFilePath, field, value });
    fieldEditSucceeded = true;
  } catch (err) {
    // Best-effort cleanup: remove the entity file we just created
    try {
      await unlink(entityFilePath);
    } catch {
      // Ignore cleanup failure — entity file may linger but tasks.md is untouched
    }
    throw err;
  }

  // Step 5: Remove the inline line from tasks.md (only after entity file is fully written)
  if (fieldEditSucceeded) {
    const newLines = [...lines];
    newLines.splice(zeroIdx, 1);
    await writeFileAtomic(tasksPath, newLines.join("\n"));
  }

  return {
    entityPath: entityRelPath,
    taskSlug,
  };
}
