import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { assertSafeTasksPath, escapeTaskText, safetyError } from "../safety.js";
import { writeFileAtomic } from "./atomic.js";

const VAULT_ROOT = "/Users/robertzinke/pushrec-vault";

export interface AddTaskInput {
  slug: string;
  text: string;
  section?: "open" | "inbox";
}

export interface AddTaskResult {
  slug: string;
  path: string;
  line: number; // 1-based line number of the newly added task
}

/**
 * Appends a new `- [ ] <text>` task under the `## Open` heading in
 * `<VAULT_ROOT>/1-Projects/<slug>/tasks.md`.
 *
 * If no `## Open` heading exists, appends to the end of the file
 * with a preceding blank line.
 *
 * Returns the 1-based line number where the task was inserted.
 */
export async function addTask(input: AddTaskInput): Promise<AddTaskResult> {
  const { slug, text } = input;

  // Validate slug
  if (!slug || typeof slug !== "string") {
    throw safetyError("slug must be a non-empty string", 400);
  }
  if (slug.includes("..") || slug.includes("/") || slug.includes("\0")) {
    throw safetyError("slug contains illegal characters", 403);
  }

  // B08 — reject tasks shorter than 3 chars. Keystroke dust from global
  // shortcut bleed-through was creating single-letter tasks in the vault.
  // 3 chars matches the minimum meaningful task verb ("fix", "buy", "pay").
  if (typeof text !== "string" || text.trim().length < 3) {
    throw safetyError("action must be at least 3 characters", 400);
  }

  const cleanText = escapeTaskText(text);
  const tasksPath = join(VAULT_ROOT, "1-Projects", slug, "tasks.md");

  // Safety check on the resolved path
  assertSafeTasksPath(tasksPath);

  let lines: string[];

  if (existsSync(tasksPath)) {
    const content = await readFile(tasksPath, "utf8");
    lines = content.split("\n");
  } else {
    // Bootstrap a minimal tasks.md if it doesn't exist yet
    lines = [
      "---",
      `created: ${new Date().toISOString().slice(0, 10)}`,
      "tags: [type/task-list]",
      `parent-project: "[[1-Projects/${slug}/README]]"`,
      "---",
      "",
      `# ${slug} — Tasks`,
      "",
      "## Open",
      "",
    ];
  }

  const newTask = `- [ ] ${cleanText}`;

  // Find the `## Open` heading
  const openHeadingIdx = lines.findIndex(
    (l) => l.trim().toLowerCase() === "## open"
  );

  let insertIdx: number;

  if (openHeadingIdx !== -1) {
    // Find the next `## ` heading after the Open heading, or EOF
    let nextHeadingIdx = lines.length;
    for (let i = openHeadingIdx + 1; i < lines.length; i++) {
      if (/^## /.test(lines[i])) {
        nextHeadingIdx = i;
        break;
      }
    }

    // Insert just before the next heading (or EOF).
    // Skip trailing blank lines before the next section so we insert cleanly.
    insertIdx = nextHeadingIdx;
    // Walk backwards past blank lines to keep the section tidy
    while (insertIdx > openHeadingIdx + 1 && lines[insertIdx - 1].trim() === "") {
      insertIdx--;
    }

    lines.splice(insertIdx, 0, newTask);
  } else {
    // No ## Open heading — append with a preceding blank line
    // Ensure the file doesn't already end with two blanks
    if (lines[lines.length - 1] !== "") {
      lines.push("");
    }
    insertIdx = lines.length;
    lines.push(newTask);
  }

  await writeFileAtomic(tasksPath, lines.join("\n"));

  // insertIdx is 0-based; line numbers are 1-based
  return { slug, path: tasksPath, line: insertIdx + 1 };
}
