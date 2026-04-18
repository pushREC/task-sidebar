/**
 * Shared type contract between server (vault-index.ts, writers) and client
 * (api.ts, components, views). Sprint G C01.
 *
 * The Task type is a DISCRIMINATED UNION on `source`:
 *   - source === "inline" → has `line: number` + `tasksPath: string`
 *     (the line number inside a project's tasks.md checkbox list)
 *   - source === "entity" → has `entityPath: string`
 *     (the vault-relative path of an entity task markdown file)
 *
 * Narrowing on `source` in either branch lets TypeScript verify the
 * location fields exist at the call site, eliminating the `task.line
 * === undefined` guards that littered Sprint A-F code.
 */

// ── Primitives ────────────────────────────────────────────────────────────

export type TaskStatus =
  | "backlog"
  | "open"
  | "in-progress"
  | "blocked"
  | "done"
  | "cancelled";

export type OwnerValue = "human" | "agent" | "either";
export type EnergyValue = "low" | "medium" | "high";
export type ImpactValue = "very-high" | "high" | "medium" | "low" | "very-low";
export type UrgencyValue = ImpactValue;
export type PriorityRank = "critical" | "high" | "medium" | "low";

export interface PriorityResult {
  score: number;
  rank: PriorityRank;
  breakdown: Record<string, number>;
}

// ── Base task fields (shared by both sources) ─────────────────────────────

interface TaskBase {
  id: string;
  action: string;
  status: TaskStatus;
  done: boolean;
  owner?: OwnerValue;
  energyLevel?: EnergyValue;
  estimatedDuration?: number;
  due?: string;
  impact?: ImpactValue;
  urgency?: UrgencyValue;
  blockedBy?: string[];
  parentProject?: string;
  // Sprint E-surfaced fields (entity tasks only; optional on base for ergonomics)
  created?: string;
  modified?: string;
  body?: string;
  // Computed
  priority?: PriorityResult;
  overdue?: boolean;
  dueToday?: boolean;
  upcoming?: boolean;
  // Agenda/Projects view adornments
  projectSlug?: string;
  projectTitle?: string;
}

export interface InlineTask extends TaskBase {
  source: "inline";
  line: number;           // 1-based line in parent tasks.md
  // entityPath is undefined on inline — the property is deliberately omitted.
}

export interface EntityTask extends TaskBase {
  source: "entity";
  entityPath: string;     // vault-relative (e.g. "1-Projects/foo/tasks/bar.md")
  // line is undefined on entity — deliberately omitted.
}

export type Task = InlineTask | EntityTask;

// ── Type guards ────────────────────────────────────────────────────────────

export function isInlineTask(task: Task): task is InlineTask {
  return task.source === "inline";
}

export function isEntityTask(task: Task): task is EntityTask {
  return task.source === "entity";
}

// ── Project ────────────────────────────────────────────────────────────────

export interface Project {
  slug: string;
  title: string;
  status: string;
  driver?: string;
  due?: string;
  parentGoal?: string;
  tasksPath: string;
  readmePath?: string;
  tasks: Task[];
  outcome?: string;
  deadline?: string;
  targetDate?: string;
  startDate?: string;
  progress?: number;
  tasksDoneCount?: number;
  tasksNotDoneCount?: number;
  tasksOverdueCount?: number;
}

// ── Vault index response ──────────────────────────────────────────────────

export interface VaultResponse {
  projects: Project[];
  today: (Task & { projectSlug: string; projectTitle: string })[];
  generatedAt: string;
}
