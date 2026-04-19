import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";
import { assertSafeTasksPath, escapeTaskText, safetyError, VAULT_ROOT } from "../safety.js";
import { writeFileExclusive } from "./atomic.js";

/**
 * Slugify an action string into a valid filename slug.
 * Lowercases, replaces spaces and special chars with hyphens, collapses repeats.
 */
function slugifyAction(action: string): string {
  return action
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export interface TaskCreateEntityInput {
  slug: string;                   // project slug
  action: string;                 // task action text
  impact?: string;
  urgency?: string;
  "energy-level"?: string;
  "estimated-duration"?: number;
  due?: string;                   // YYYY-MM-DD
  parentGoal?: string;            // wikilink string
  owner?: string;
}

export interface TaskCreateEntityResult {
  path: string;        // absolute path to the created file
  entityPath: string;  // vault-relative path
  taskSlug: string;
}

/**
 * Creates a canonical entity task file at:
 *   <VAULT_ROOT>/1-Projects/<slug>/tasks/<task-slug>.md
 *
 * Generates frontmatter from the Template/task.md pattern. Creates the tasks/
 * subdirectory if it doesn't exist. Fails if the file already exists.
 */
export async function createEntityTask(input: TaskCreateEntityInput): Promise<TaskCreateEntityResult> {
  const { slug } = input;

  // Validate project slug
  if (!slug || typeof slug !== "string") {
    throw safetyError("slug must be a non-empty string", 400);
  }
  if (slug.includes("..") || slug.includes("/") || slug.includes("\0")) {
    throw safetyError("slug contains illegal characters", 403);
  }

  const cleanAction = escapeTaskText(input.action);
  const taskSlug = slugifyAction(cleanAction);

  if (!taskSlug || taskSlug.length === 0) {
    throw safetyError("action text could not be slugified to a valid filename", 400);
  }

  const tasksDir = join(VAULT_ROOT, "1-Projects", slug, "tasks");
  const entityFilePath = join(tasksDir, `${taskSlug}.md`);
  const entityRelPath = `1-Projects/${slug}/tasks/${taskSlug}.md`;

  // Safety check on the resolved path
  assertSafeTasksPath(entityFilePath);

  // Early-exit check for a friendlier error; O_EXCL in writeFileExclusive
  // still provides the atomic guarantee under concurrent creates.
  if (existsSync(entityFilePath)) {
    throw safetyError(`Entity task file already exists: ${entityRelPath}`, 409);
  }

  // Validate optional enum fields
  const validImpact = new Set(["very-high", "high", "medium", "low", "very-low"]);
  const validUrgency = new Set(["very-high", "high", "medium", "low", "very-low"]);
  const validEnergyLevel = new Set(["low", "medium", "high"]);

  const impact = input.impact && validImpact.has(input.impact) ? input.impact : undefined;
  const urgency = input.urgency && validUrgency.has(input.urgency) ? input.urgency : undefined;
  const energyLevel = input["energy-level"] && validEnergyLevel.has(input["energy-level"])
    ? input["energy-level"]
    : undefined;
  const estimatedDuration = typeof input["estimated-duration"] === "number" && input["estimated-duration"] >= 0
    ? input["estimated-duration"]
    : undefined;
  const due = typeof input.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.due)
    ? input.due
    : undefined;

  const today = new Date().toISOString().slice(0, 10);
  const parentProject = `[[1-Projects/${slug}/README]]`;

  // Build frontmatter object
  const frontmatter: Record<string, unknown> = {
    created: today,
    tags: ["type/task"],
    action: cleanAction,
    "parent-project": parentProject,
    status: "open",
    "energy-level": energyLevel ?? "",
    "estimated-duration": estimatedDuration ?? "",
    due: due ?? "",
    impact: impact ?? "",
    urgency: urgency ?? "",
    "blocked-by": [],
    "related-resources": [],
  };

  // Build content body following the template pattern
  const statusAnchor = "[[3-Resources/anchors/status-open]]";
  const body = `${statusAnchor}\n\n# ${cleanAction}\n\n## Description\n<!-- What needs to be done? -->\n\n\n## Subtasks\n- [ ]\n\n## Notes\n\n\n## Links\n- ${parentProject}\n`;

  // Serialize using YAML front matter
  const yamlLines = buildYamlFrontmatter(frontmatter);
  const fileContent = `---\n${yamlLines}\n---\n\n${body}`;

  // Create tasks directory if it doesn't exist
  if (!existsSync(tasksDir)) {
    await mkdir(tasksDir, { recursive: true });
  }

  await writeFileExclusive(entityFilePath, fileContent);

  return {
    path: entityFilePath,
    entityPath: entityRelPath,
    taskSlug,
  };
}

/** Simple YAML serializer for flat frontmatter (no deep nesting needed). */
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
      // Quote strings that contain special YAML chars
      const needsQuotes = /[:#\[\]{},|>&*!'"?%@`]/.test(value) || value.trim() !== value;
      lines.push(needsQuotes ? `${key}: "${value.replace(/"/g, '\\"')}"` : `${key}: ${value}`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  return lines.join("\n");
}
