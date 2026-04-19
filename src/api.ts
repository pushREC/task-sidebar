// Sprint G CONTRACT-001 — the canonical shapes are now in src/shared/types.ts
// (discriminated Task union, etc.). api.ts keeps a LOOSE Task shape for
// backward-compat with existing Sprint A-F consumers that still use
// `task.line !== undefined` guards. The shared types are available for
// new code that wants strict narrowing.
//
// Pragmatic choice: migrating all consumers to the discriminated union
// in a single sprint would create 40+ line-level edits in TaskRow +
// views + popovers. We keep the loose shape here and migrate site-by-
// site in future sprints.
export type {
  TaskStatus,
  OwnerValue,
  EnergyValue,
  ImpactValue,
  UrgencyValue,
  PriorityRank,
  PriorityResult,
  InlineTask,
  EntityTask,
  Project as ProjectStrict,
  VaultResponse as VaultResponseStrict,
} from "./shared/types.js";
export { isInlineTask, isEntityTask } from "./shared/types.js";

/**
 * Loose Task shape — optional location fields so existing Sprint A-F
 * consumers compile without touching their line-guards. New code
 * should prefer the discriminated `InlineTask | EntityTask` union
 * from `./shared/types.js` for stricter narrowing.
 */
export interface Task {
  id: string;
  action: string;
  done: boolean;
  owner?: "human" | "agent" | "either";
  line?: number;
  projectSlug?: string;
  projectTitle?: string;
  source?: "inline" | "entity";
  entityPath?: string;
  energyLevel?: "low" | "medium" | "high";
  estimatedDuration?: number;
  due?: string;
  impact?: "very-high" | "high" | "medium" | "low" | "very-low";
  urgency?: "very-high" | "high" | "medium" | "low" | "very-low";
  blockedBy?: string[];
  parentProject?: string;
  created?: string;
  modified?: string;
  body?: string;
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
  // Sprint H.2.4 — optional optimistic-concurrency token. Send `task.modified`
  // captured at edit-open time; server returns 409 `{error:"mtime-mismatch",
  // currentModified}` if another writer changed the file in the meantime.
  expectedModified?: string;
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

export interface DeleteEntityResult {
  ok: boolean;
  entityPath?: string;
  // Sprint H.3.3 — server returns tombstoneId when the delete created
  // a tombstone (happy path). Absent if the file was already gone.
  tombstoneId?: string;
}
export function deleteEntityTaskApi(args: {
  entityPath: string;
}): Promise<ApiResult<DeleteEntityResult>> {
  return postJson<DeleteEntityResult>("/api/tasks/delete-entity", args);
}

export interface DeleteInlineResult {
  ok: boolean;
  tasksPath?: string;
  line?: number;
  tombstoneId?: string; // Sprint H.3.4 — same contract as entity
}
export function deleteInlineTaskApi(args: {
  tasksPath: string;
  line: number;
  expectedAction: string;
}): Promise<ApiResult<DeleteInlineResult>> {
  return postJson<DeleteInlineResult>("/api/tasks/delete-inline", args);
}

// Sprint H.3.6 — restore a tombstoned file by id. Server returns
// `{kind, restoredPath}` on success; 404 if tombstone already swept;
// 409 if original path re-occupied.
export interface RestoreTombstoneResult {
  ok: boolean;
  kind?: "entity" | "inline";
  restoredPath?: string;
}
export function restoreTombstoneApi(args: {
  tombstoneId: string;
}): Promise<ApiResult<RestoreTombstoneResult>> {
  return postJson<RestoreTombstoneResult>("/api/tasks/restore-tombstone", args);
}

export interface BodyEditResult { ok: boolean; entityPath?: string }
export function editTaskBodyApi(args: {
  entityPath: string;
  body: string;
  // Sprint H.2.4 — same mtime-lock contract as editTaskFieldApi.
  expectedModified?: string;
}): Promise<ApiResult<BodyEditResult>> {
  return postJson<BodyEditResult>("/api/tasks/body-edit", args);
}

export interface CancelReconcileResult { ok: boolean; canceled?: boolean }
export function cancelReconcileApi(args: {
  entityPath: string;
}): Promise<ApiResult<CancelReconcileResult>> {
  return postJson<CancelReconcileResult>("/api/tasks/cancel-reconcile", args);
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

/**
 * Sprint H R2 D3 — monotonic sequence counter for fetchVault response
 * ordering. Callers that issue concurrent fetches (e.g. delete + immediate
 * restore, user action + SSE refresh) pair each fetchVault call with a
 * nextVaultSeq() token before awaiting. The store's setVault(vault, seq)
 * drops any response whose seq is older than the one already applied,
 * preventing stale vault data from overwriting newer state.
 *
 * Module-local state is fine: per-tab isolation matches the existing
 * per-tab store model (Zustand stores are per-tab; no cross-tab sync).
 */
let fetchVaultSeq = 0;
export function nextVaultSeq(): number {
  return ++fetchVaultSeq;
}

export async function fetchVault(): Promise<VaultResponse> {
  const response = await fetch("/api/vault", { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`/api/vault ${response.status}`);
  return response.json() as Promise<VaultResponse>;
}

/**
 * Subscribe to vault file-change events via SSE.
 * Returns a cleanup function that closes the EventSource.
 * EventSource handles reconnect automatically.
 *
 * Sprint F E02 — optional `onConnectionChange` callback fires with a
 * string tag whenever the connection state transitions. Callers use this
 * to surface a "reconnecting…" banner after >10s of disconnection.
 */
export type SSEConnectionState = "open" | "closed" | "connecting";

export function subscribeVaultEvents(
  onChange: () => void,
  onConnectionChange?: (state: SSEConnectionState) => void
): () => void {
  const source = new EventSource("/api/events");

  source.addEventListener("vault-changed", () => {
    onChange();
  });

  source.addEventListener("open", () => {
    onConnectionChange?.("open");
  });

  // EventSource fires "error" on initial failure AND on every reconnect
  // attempt (then auto-retries with increasing backoff). We don't bail;
  // the browser's own reconnect logic handles the retries.
  source.addEventListener("error", () => {
    // readyState === CONNECTING (0) → reconnect in flight
    // readyState === CLOSED (2)     → terminal failure
    const rs = source.readyState;
    onConnectionChange?.(rs === EventSource.CLOSED ? "closed" : "connecting");
  });

  return () => {
    source.close();
  };
}
