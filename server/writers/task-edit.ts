import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { assertSafeTasksPath, escapeTaskText, resolveTasksPath, safetyError } from "../safety.js";
import { writeFileAtomic } from "./atomic.js";
import { extractSlug } from "./slug.js";

const TASK_LINE_RE = /^(\s*- \[[ xX]\]\s+)(.+)$/;

export interface EditTaskInput {
  tasksPath: string;
  line: number;    // 1-based
  newText: string;
}

export interface EditTaskResult {
  slug: string;
  path: string;
}

/**
 * Replaces the text portion of a task line, preserving the checkbox and indent.
 * e.g. `  - [x] old text @owner(agent)` → `  - [x] new text`
 *
 * Note: any @owner annotation on the original line is NOT preserved because
 * the client sends the display text (which strips @owner). The trade-off is
 * acceptable — owner can be re-added via chat agent.
 */
export async function editTask(input: EditTaskInput): Promise<EditTaskResult> {
  const { line, newText } = input;
  const tasksPath = resolveTasksPath(input.tasksPath);

  assertSafeTasksPath(tasksPath);

  if (typeof line !== "number" || !Number.isInteger(line) || line < 1) {
    throw safetyError("line must be a positive integer", 400);
  }

  const cleanText = escapeTaskText(newText);

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

  const prefix = match[1]; // e.g. "  - [x] "
  lines[zeroIdx] = `${prefix}${cleanText}`;

  await writeFileAtomic(tasksPath, lines.join("\n"));

  const slug = extractSlug(tasksPath);
  return { slug, path: tasksPath };
}

