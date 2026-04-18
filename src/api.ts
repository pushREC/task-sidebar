export interface Task {
  id: string;
  action: string;
  done: boolean;
  owner?: "human" | "agent" | "either";
  line?: number;
  projectSlug?: string;
  projectTitle?: string;
  // v2.0 canonical fields
  source?: "inline" | "entity";
  entityPath?: string;
  energyLevel?: "low" | "medium" | "high";
  estimatedDuration?: number;
  due?: string;
  impact?: "very-high" | "high" | "medium" | "low" | "very-low";
  urgency?: "very-high" | "high" | "medium" | "low" | "very-low";
  blockedBy?: string[];
  parentProject?: string;
  // P1-1 — server can return "critical" rank when score ≥250
  priority?: { score: number; rank: "critical" | "high" | "medium" | "low"; breakdown: Record<string, number> };
  overdue?: boolean;
  dueToday?: boolean;
  upcoming?: boolean;
  status?: "backlog" | "open" | "in-progress" | "blocked" | "done" | "cancelled";
}

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
  // v2.0 project detail fields
  outcome?: string;
  deadline?: string;
  targetDate?: string;
  startDate?: string;
  progress?: number;
  tasksDoneCount?: number;
  tasksNotDoneCount?: number;
  tasksOverdueCount?: number;
}

export interface VaultResponse {
  projects: Project[];
  today: Task[];
  generatedAt: string;
}

// ─── Write API response shape ─────────────────────────────────────────────

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function postJson<T>(
  path: string,
  body: unknown
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const json = await response.json() as Record<string, unknown>;
    if (response.ok && json["ok"] === true) {
      return { ok: true, data: json as T };
    }
    return { ok: false, error: String(json["error"] ?? response.statusText) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Write wrappers ───────────────────────────────────────────────────────

export interface ToggleResult { ok: boolean; slug?: string; path?: string }
export function toggleTaskApi(args: {
  tasksPath: string;
  line: number;
  done: boolean;
}): Promise<ApiResult<ToggleResult>> {
  return postJson<ToggleResult>("/api/tasks/toggle", args);
}

export interface AddResult { ok: boolean; slug?: string; path?: string; line?: number }
export function addTaskApi(args: {
  slug: string;
  text: string;
  section?: "open" | "inbox";
}): Promise<ApiResult<AddResult>> {
  return postJson<AddResult>("/api/tasks/add", args);
}

export interface EditResult { ok: boolean; slug?: string; path?: string }
export function editTaskApi(args: {
  tasksPath: string;
  line: number;
  newText: string;
}): Promise<ApiResult<EditResult>> {
  return postJson<EditResult>("/api/tasks/edit", args);
}

export interface MoveResult { ok: boolean; sourceSlug?: string; targetSlug?: string }
export function moveTaskApi(args: {
  sourcePath: string;
  line: number;
  targetSlug: string;
}): Promise<ApiResult<MoveResult>> {
  return postJson<MoveResult>("/api/tasks/move", args);
}

// ─── v2.0 Write wrappers ──────────────────────────────────────────────────

export interface FieldEditResult { ok: boolean }

export function editTaskFieldApi(args: {
  entityPath: string;
  field: string;
  value: string | number | null;
}): Promise<ApiResult<FieldEditResult>> {
  return postJson<FieldEditResult>("/api/tasks/field-edit", args);
}

export function editTaskStatusApi(args: {
  entityPath: string;
  status: string;
}): Promise<ApiResult<FieldEditResult>> {
  return postJson<FieldEditResult>("/api/tasks/status-edit", args);
}

export interface CreateEntityResult { ok: boolean; path?: string }
export function createEntityTaskApi(args: {
  slug: string;
  action: string;
  impact?: string;
  urgency?: string;
  energyLevel?: string;
  estimatedDuration?: number;
  due?: string;
  parentGoal?: string;
}): Promise<ApiResult<CreateEntityResult>> {
  return postJson<CreateEntityResult>("/api/tasks/create-entity", args);
}

export interface PromoteResult { ok: boolean; path?: string }
export function promoteTaskApi(args: {
  sourcePath: string;
  line: number;
}): Promise<ApiResult<PromoteResult>> {
  return postJson<PromoteResult>("/api/tasks/promote", args);
}

export interface PromoteAndEditResult { ok: boolean; entityPath?: string; taskSlug?: string }
export function promoteAndEditTaskApi(args: {
  tasksPath: string;
  line: number;
  field: string;
  value: string | number | null;
}): Promise<ApiResult<PromoteAndEditResult>> {
  return postJson<PromoteAndEditResult>("/api/tasks/promote-and-edit", args);
}

export interface ProjectFieldEditResult { ok: boolean }
export function editProjectFieldApi(args: {
  slug: string;
  field: string;
  value: string | number | null;
}): Promise<ApiResult<ProjectFieldEditResult>> {
  return postJson<ProjectFieldEditResult>("/api/projects/field-edit", args);
}

// ─── Read API ─────────────────────────────────────────────────────────────

export async function fetchVault(): Promise<VaultResponse> {
  const response = await fetch("/api/vault", { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`/api/vault ${response.status}`);
  return response.json() as Promise<VaultResponse>;
}

/**
 * Subscribe to vault file-change events via SSE.
 * Returns a cleanup function that closes the EventSource.
 * EventSource handles reconnect automatically; we log after 3 consecutive errors.
 */
export function subscribeVaultEvents(onChange: () => void): () => void {
  const source = new EventSource("/api/events");

  source.addEventListener("vault-changed", () => {
    onChange();
  });

  // A1 — no dev-log on SSE reconnect; Sprint F E02 will surface an offline
  // banner by subscribing to readyState changes here. For now, the browser's
  // built-in EventSource reconnect handles transient failures silently.

  return () => {
    source.close();
  };
}
