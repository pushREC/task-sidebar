import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { assertSafeTasksPath, resolveTasksPath, safetyError } from "../safety.js";
import { writeFileAtomic } from "./atomic.js";
import { extractSlug } from "./slug.js";

// Matches [ ], [x], [X], [/]
const TASK_LINE_RE = /^(\s*)- \[([ xX/])\](\s+.+)$/;

/**
 * Input contract for toggleTask:
 *
 * Binary mode (legacy, preserved):
 *   { tasksPath, line, done: boolean }
 *   done=true  → writes [x]
 *   done=false → writes [ ]
 *
 * Tri-state cycle mode:
 *   { tasksPath, line, done: "next" }
 *   Cycles: [ ] → [/] → [x] → [ ]
 *   This allows the UI to step through the three states in sequence.
 */
export interface ToggleTaskInput {
  tasksPath: string;
  line: number;             // 1-based line number
  done: boolean | "next";  // boolean = binary mode; "next" = tri-state cycle
}

export interface ToggleTaskResult {
  slug: string;
  path: string;
  newCheckbox: string;  // the character that was written: " ", "/", or "x"
}

/**
 * Advances the tri-state checkbox cycle:
 *   [ ] (space) → [/] → [x] → [ ] (back to start)
 */
function cycleCheckbox(current: string): string {
  const lower = current.toLowerCase();
  if (lower === " ") return "/";
  if (lower === "/") return "x";
  return " "; // [x] → [ ]
}

/**
 * Flips the checkbox on a single task line.
 *
 * Binary mode: done=true → [x], done=false → [ ]
 * Tri-state:   done="next" → cycles [ ] → [/] → [x] → [ ]
 */
export async function toggleTask(input: ToggleTaskInput): Promise<ToggleTaskResult> {
  const { line, done } = input;
  const tasksPath = resolveTasksPath(input.tasksPath);

  assertSafeTasksPath(tasksPath);

  if (typeof line !== "number" || !Number.isInteger(line) || line < 1) {
    throw safetyError("line must be a positive integer", 400);
  }

  if (done !== true && done !== false && done !== "next") {
    throw safetyError('done must be a boolean or the string "next"', 400);
  }

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

  const indent = match[1];
  const currentCheckbox = match[2];
  const rest = match[3]; // space + task text (including @owner etc.)

  let newCheckbox: string;
  if (done === "next") {
    newCheckbox = cycleCheckbox(currentCheckbox);
  } else {
    // Binary mode: preserve existing [/] as-is if no change is needed
    newCheckbox = done ? "x" : " ";
  }

  lines[zeroIdx] = `${indent}- [${newCheckbox}]${rest}`;

  await writeFileAtomic(tasksPath, lines.join("\n"));

  const slug = extractSlug(tasksPath);
  return { slug, path: tasksPath, newCheckbox };
}
