import { readFileSync, existsSync } from "fs";
import { join, dirname, basename } from "path";
import glob from "fast-glob";
import matter from "gray-matter";
import { computePriority, type PriorityResult } from "./priority.js";

const VAULT_ROOT = "/Users/robertzinke/pushrec-vault";

/** Strips the VAULT_ROOT prefix to produce a vault-relative path. */
function toRelativePath(absolutePath: string): string {
  if (absolutePath.startsWith(VAULT_ROOT + "/")) {
    return absolutePath.slice(VAULT_ROOT.length + 1);
  }
  return absolutePath;
}

// Inline checkbox regex: handles [ ], [x], [X], [/]
const TASK_RE = /^(\s*)- \[([ xX/])\]\s+(.+)$/;
const OWNER_RE = /@owner\((human|agent|either)\)/;

const SKIP_STATUSES = new Set(["done", "cancelled", "archived"]);

export interface Task {
  id: string;
  source: "inline" | "entity";
  action: string;
  status: "backlog" | "open" | "in-progress" | "blocked" | "done" | "cancelled";
  done: boolean;
  line?: number;           // inline tasks only
  entityPath?: string;     // entity tasks only (vault-relative)
  // Canonical fields (entity only; undefined for inline):
  owner?: "human" | "agent" | "either";
  energyLevel?: "low" | "medium" | "high";
  estimatedDuration?: number;    // minutes
  due?: string;                  // YYYY-MM-DD
  impact?: "very-high" | "high" | "medium" | "low" | "very-low";
  urgency?: "very-high" | "high" | "medium" | "low" | "very-low";
  blockedBy?: string[];          // wikilinks
  parentProject?: string;        // wikilink or derived from path
  // Computed:
  priority?: PriorityResult;
  overdue?: boolean;
  dueToday?: boolean;
  upcoming?: boolean;            // due within 7 days
}

export interface Project {
  slug: string;
  title: string;
  status: string;
  driver?: string;
  due?: string;
  parentGoal?: string;
  tasksPath: string;       // vault-relative; server resolves via VAULT_ROOT + safety guard
  readmePath: string;      // vault-relative path to the README file
  tasks: Task[];
  // Canonical project frontmatter (optional, parsed from README if present):
  outcome?: string;
  deadline?: string;       // YYYY-MM-DD
  targetDate?: string;     // YYYY-MM-DD
  startDate?: string;      // YYYY-MM-DD
  // Inferred counts (computed from tasks after full parse):
  progress?: number;         // 0–100 (done / (done + notDone) * 100)
  tasksDoneCount?: number;
  tasksNotDoneCount?: number;
  tasksOverdueCount?: number;
}

export interface VaultIndex {
  projects: Project[];
  today: (Task & { projectSlug: string; projectTitle: string })[];
  generatedAt: string;
}

function extractTitle(content: string, slug: string): string {
  const h1 = /^#\s+(.+)$/m.exec(content);
  return h1 ? h1[1].trim() : slug;
}

/** Derive status string from inline checkbox character. */
function checkboxToStatus(char: string): Task["status"] {
  const lower = char.toLowerCase();
  if (lower === "x") return "done";
  if (lower === "/") return "in-progress";
  return "open";
}

/** Parse inline checkbox tasks from a tasks.md file. */
function parseInlineTasks(tasksPath: string, slug: string): Task[] {
  if (!existsSync(tasksPath)) return [];
  const lines = readFileSync(tasksPath, "utf8").split("\n");
  const tasks: Task[] = [];
  lines.forEach((line, idx) => {
    const match = TASK_RE.exec(line);
    if (!match) return;
    const charInBox = match[2];
    const rawText = match[3].trim();
    const ownerMatch = OWNER_RE.exec(rawText);
    const actionText = rawText.replace(OWNER_RE, "").trim();
    const status = checkboxToStatus(charInBox);
    tasks.push({
      id: `${slug}:${idx + 1}`,
      source: "inline",
      action: actionText,
      status,
      done: status === "done",
      owner: ownerMatch ? (ownerMatch[1] as Task["owner"]) : undefined,
      line: idx + 1,
      parentProject: `[[1-Projects/${slug}/README]]`,
    });
  });
  return tasks;
}

/** Parse entity task files from 1-Projects/<slug>/tasks/*.md */
async function parseEntityTasks(
  projectSlug: string,
  projectDir: string,
  todayStr: string
): Promise<Task[]> {
  const tasksDir = join(projectDir, "tasks");
  if (!existsSync(tasksDir)) return [];

  const entityFiles = await glob("*.md", {
    cwd: tasksDir,
    absolute: true,
  });

  const tasks: Task[] = [];
  const sevenDaysOut = new Date();
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  const upcomingCutoff = sevenDaysOut.toISOString().slice(0, 10);

  for (const entityFile of entityFiles) {
    try {
      const raw = readFileSync(entityFile, "utf8");
      const { data } = matter(raw);

      const action = typeof data.action === "string" ? data.action.trim() : basename(entityFile, ".md");
      const rawStatus = typeof data.status === "string" ? data.status.toLowerCase() : "open";
      // Map raw status to canonical Task status
      const status = normalizeTaskStatus(rawStatus);
      const done = status === "done" || status === "cancelled";

      // Compute temporal booleans
      const dueStr = typeof data.due === "string" && data.due ? data.due : undefined;
      const overdue = dueStr !== undefined && dueStr < todayStr && !done;
      const dueToday = dueStr !== undefined && dueStr === todayStr && !done;
      const upcoming = dueStr !== undefined && dueStr > todayStr && dueStr <= upcomingCutoff && !done;

      // Parse blocked-by: supports string, string[], or undefined
      let blockedBy: string[] | undefined;
      if (Array.isArray(data["blocked-by"])) {
        blockedBy = data["blocked-by"].filter((v: unknown) => typeof v === "string");
      } else if (typeof data["blocked-by"] === "string" && data["blocked-by"]) {
        blockedBy = [data["blocked-by"]];
      }

      // Parse estimated-duration — stored as number (minutes)
      const estimatedDuration =
        typeof data["estimated-duration"] === "number"
          ? data["estimated-duration"]
          : typeof data["estimated-duration"] === "string"
          ? parseInt(data["estimated-duration"], 10) || undefined
          : undefined;

      const entityPath = toRelativePath(entityFile);
      const taskSlug = basename(entityFile, ".md");

      const task: Task = {
        id: `${projectSlug}:entity:${taskSlug}`,
        source: "entity",
        action,
        status,
        done,
        entityPath,
        owner: isOwnerValue(data.owner) ? data.owner : undefined,
        energyLevel: isEnergyLevel(data["energy-level"]) ? data["energy-level"] : undefined,
        estimatedDuration: Number.isFinite(estimatedDuration) ? estimatedDuration : undefined,
        due: dueStr,
        impact: isImpactValue(data.impact) ? data.impact : undefined,
        urgency: isUrgencyValue(data.urgency) ? data.urgency : undefined,
        blockedBy,
        parentProject:
          typeof data["parent-project"] === "string" ? data["parent-project"] : `[[1-Projects/${projectSlug}/README]]`,
        overdue,
        dueToday,
        upcoming,
      };

      tasks.push(task);
    } catch (err) {
      process.stderr.write(`vault-index: failed to parse entity ${entityFile}: ${err}\n`);
    }
  }

  return tasks;
}

/** Normalize raw status string to canonical Task status enum. */
function normalizeTaskStatus(raw: string): Task["status"] {
  switch (raw) {
    case "done": return "done";
    case "cancelled": return "cancelled";
    case "in-progress": return "in-progress";
    case "blocked": return "blocked";
    case "open": return "open";
    case "backlog": return "backlog";
    default: return "open";
  }
}

function isOwnerValue(v: unknown): v is "human" | "agent" | "either" {
  return v === "human" || v === "agent" || v === "either";
}

function isEnergyLevel(v: unknown): v is "low" | "medium" | "high" {
  return v === "low" || v === "medium" || v === "high";
}

function isImpactValue(v: unknown): v is "very-high" | "high" | "medium" | "low" | "very-low" {
  return v === "very-high" || v === "high" || v === "medium" || v === "low" || v === "very-low";
}

function isUrgencyValue(v: unknown): v is "very-high" | "high" | "medium" | "low" | "very-low" {
  return v === "very-high" || v === "high" || v === "medium" || v === "low" || v === "very-low";
}

/**
 * Resolve the `timeframe` field from a goal wikilink.
 *
 * Goal wikilinks look like: [[2-Areas/goals/build-the-machine]]
 * or [[2-Areas/goals/build-the-machine.md]]
 *
 * Returns the timeframe string (e.g. "q2") or undefined if not found.
 * Cache is per-index-build (passed in as a Map).
 */
function resolveGoalTimeframe(
  goalWikilink: string,
  cache: Map<string, string | undefined>
): string | undefined {
  if (cache.has(goalWikilink)) return cache.get(goalWikilink);

  // Strip [[ ]] and extract path segment
  const inner = goalWikilink.replace(/^\[\[/, "").replace(/\]\]$/, "");
  // Build candidate paths: with and without .md suffix
  const candidatePaths = inner.endsWith(".md")
    ? [join(VAULT_ROOT, inner)]
    : [join(VAULT_ROOT, `${inner}.md`), join(VAULT_ROOT, inner)];

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, "utf8");
        const { data } = matter(raw);
        const timeframe = typeof data.timeframe === "string" ? data.timeframe : undefined;
        cache.set(goalWikilink, timeframe);
        return timeframe;
      } catch {
        // Skip unreadable goal files gracefully
      }
    }
  }

  cache.set(goalWikilink, undefined);
  return undefined;
}

/**
 * Build the vault index: parse all active projects, merge inline + entity tasks,
 * compute priority for entity tasks with sufficient signal, build today[] view.
 */
export async function buildVaultIndex(): Promise<VaultIndex> {
  // Match both README.md and <SLUG>-README.md naming conventions used in the vault
  const readmePaths = await glob("1-Projects/*/*README.md", {
    cwd: VAULT_ROOT,
    absolute: true,
    ignore: ["**/node_modules/**"],
  });

  // Deduplicate: if a project has both README.md and <SLUG>-README.md, keep only one per project dir
  const seenProjectDirs = new Set<string>();
  const dedupedReadmePaths = readmePaths.filter((p) => {
    const projectDir = dirname(p);
    if (seenProjectDirs.has(projectDir)) return false;
    seenProjectDirs.add(projectDir);
    return true;
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const today: VaultIndex["today"] = [];
  const projects: Project[] = [];
  // Cache goal-wikilink → timeframe resolutions across the whole index build
  const goalTimeframeCache = new Map<string, string | undefined>();

  for (const readmePath of dedupedReadmePaths) {
    try {
      const raw = readFileSync(readmePath, "utf8");
      const { data, content } = matter(raw);
      const status: string = (data.status ?? "backlog").toLowerCase();

      if (SKIP_STATUSES.has(status)) continue;

      const slug = readmePath.split("/").slice(-2, -1)[0];
      const projectDir = dirname(readmePath);
      const title = extractTitle(content, slug);
      const tasksPath = join(projectDir, "tasks.md");

      // Parse both inline and entity tasks
      const inlineTasks = parseInlineTasks(tasksPath, slug);
      const entityTasksRaw = await parseEntityTasks(slug, projectDir, todayStr);

      // Resolve parent-goal → timeframe once per project (all tasks share it)
      const parentGoalTimeframe =
        typeof data["parent-goal"] === "string"
          ? await resolveGoalTimeframe(data["parent-goal"], goalTimeframeCache)
          : undefined;

      // Compute priority for entity tasks that have enough signal
      const entityTasks = await Promise.all(
        entityTasksRaw.map(async (task) => {
          if (!task.impact && !task.urgency && !task.due) {
            return task;
          }
          const priority = await computePriority({
            impact: task.impact,
            urgency: task.urgency,
            due: task.due,
            parentGoalTimeframe,
          });
          return priority ? { ...task, priority } : task;
        })
      );

      // Merge: entity tasks first, then inline (entity tasks are canonical)
      const allTasks: Task[] = [...entityTasks, ...inlineTasks];

      // Inferred project-level counts (DECISION-042)
      const tasksDoneCount = allTasks.filter((t) => t.status === "done").length;
      const tasksNotDoneCount = allTasks.filter(
        (t) => t.status !== "done" && t.status !== "cancelled"
      ).length;
      const tasksOverdueCount = allTasks.filter((t) => t.overdue === true).length;
      const totalRelevant = tasksDoneCount + tasksNotDoneCount;
      const progress = totalRelevant > 0
        ? Math.round((tasksDoneCount / totalRelevant) * 100)
        : 0;

      const project: Project = {
        slug,
        title,
        status,
        driver: data.driver,
        due: data.due,
        parentGoal: data["parent-goal"],
        outcome: typeof data.outcome === "string" ? data.outcome : undefined,
        deadline: typeof data.deadline === "string" ? data.deadline : undefined,
        targetDate: typeof data["target-date"] === "string" ? data["target-date"] : undefined,
        startDate: typeof data["start-date"] === "string" ? data["start-date"] : undefined,
        tasksPath: toRelativePath(tasksPath),
        readmePath: toRelativePath(readmePath),
        tasks: allTasks,
        progress,
        tasksDoneCount,
        tasksNotDoneCount,
        tasksOverdueCount,
      };
      projects.push(project);

      // TODAY algorithm: include tasks that are active/in-progress/overdue/due-today/high-priority
      const isProjectActive = status === "active";

      for (const task of allTasks) {
        // Skip completed tasks for today view
        if (task.done || task.status === "cancelled") continue;

        const isInProgress = task.status === "in-progress";
        const isHighPriority = task.priority?.rank === "high" || task.priority?.rank === "critical";

        if (
          isProjectActive &&
          (isInProgress || task.overdue || task.dueToday || isHighPriority)
        ) {
          today.push({ ...task, projectSlug: slug, projectTitle: title });
        }
      }
    } catch (err) {
      process.stderr.write(`vault-index: failed to parse ${readmePath}: ${err}\n`);
    }
  }

  return { projects, today, generatedAt: new Date().toISOString() };
}
