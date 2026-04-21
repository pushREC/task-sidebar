import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { join, dirname } from "path";
import { assertSafeTasksPath, resolveTasksPath, safetyError, VAULT_ROOT } from "../safety.js";
import { writeFileAtomic } from "./atomic.js";
import { invalidateFile } from "../vault-cache.js";

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
      lines.push(value.length === 0 ? `${key}: []` : `${key}:\n${value.map((v) => `  - ${String(v)}`).join("\n")}`);
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

export interface TaskPromoteInput {
  sourcePath: string;   // vault-relative or absolute path to tasks.md
  line: number;         // 1-based line number of the inline task to promote
}

export interface TaskPromoteResult {
  entityPath: string;   // vault-relative path to newly created entity file
  removedLine: number;  // 1-based line number that was removed
  taskSlug: string;
}

/**
 * Promotes an inline checkbox task to a canonical entity file.
 *
 * Order of operations (fail-safe):
 *   1. Read and parse the inline task line
 *   2. Create the entity file (if this fails, tasks.md is untouched)
 *   3. Remove the inline line from tasks.md
 *
 * If the tasks/ directory doesn't exist, it is created.
 */
export async function promoteTask(input: TaskPromoteInput): Promise<TaskPromoteResult> {
  const { line } = input;

  if (typeof line !== "number" || !Number.isInteger(line) || line < 1) {
    throw safetyError("line must be a positive integer", 400);
  }

  const tasksPath = resolveTasksPath(input.sourcePath);
  assertSafeTasksPath(tasksPath);

  if (!existsSync(tasksPath)) {
    throw safetyError(`tasks.md not found: ${tasksPath}`, 404);
  }

  const content = await readFile(tasksPath, "utf8");
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

  // STEP 1: Create entity file first. If this fails, tasks.md is untouched.
  if (!existsSync(tasksDir)) {
    await mkdir(tasksDir, { recursive: true });
  }
  await writeFileAtomic(entityFilePath, fileContent);

  // STEP 2: Remove the inline line from tasks.md
  const newLines = [...lines];
  newLines.splice(zeroIdx, 1);
  await writeFileAtomic(tasksPath, newLines.join("\n"));

  // Sprint I.4.10 — invalidate-before-return (plan §0.4 Decision 7).
  // Both entityFilePath and tasksPath live under the same project slug;
  // one invalidate covers both (v1 full-rebuild semantics).
  await invalidateFile(tasksPath);

  return {
    entityPath: entityRelPath,
    removedLine: line,
    taskSlug,
  };
}
