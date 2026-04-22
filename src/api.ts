// Sprint I.1.4 — api.ts re-exports the strict discriminated types from
// src/shared/types.ts as the SINGLE SOURCE OF TRUTH. The prior loose
// Task/Project/VaultResponse interfaces have been removed; all consumers
// now narrow via `isInlineTask(task)` / `isEntityTask(task)` before
// accessing location fields.
//
// Strict contract:
//   - Task = InlineTask | EntityTask (discriminated on `source`)
//   - InlineTask has `line: number` + `tasksPath: string`
//   - EntityTask has `entityPath: string`
//
// Cascade sites narrowed during I.1.4: TaskRow.tsx, TaskDetailPanel.tsx,
// AgendaView.tsx (Enriched<T> generic), ProjectsView.tsx, BulkBar.tsx.
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
  Task,
  Project,
  VaultResponse,
} from "./shared/types.js";
export { isInlineTask, isEntityTask } from "./shared/types.js";

// Convenience re-export aliases for any legacy import sites. Kept for
// one sprint then removed in Sprint L polish if no consumers reference.
export type { Project as ProjectStrict, VaultResponse as VaultResponseStrict } from "./shared/types.js";

// Internal import used below for Task-typed fields in wrapper response shapes.
import type { Task, VaultResponse } from "./shared/types.js";

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

// Sprint I.6.2 — Bulk Move entity wrapper.
//
// Posts to the same `/api/tasks/move` endpoint as `moveTaskApi`, but the
// server route dispatches on presence of `entityPath` (inline uses
// `sourcePath`+`line`). Response carries the new vault-relative `moved`
// path and optional `renamedFrom`/`renamedTo` stems when collision
// auto-suffix fires at target.
//
// All callers (BulkBar bulk-move loop, future single-task move UI) MUST
// thread `renamedFrom`/`renamedTo` into their undo/toast surfaces so the
// user sees transparency about any auto-suffix (plan §0.3 D5).
//
// Timeout is inherited from `postJson` (AbortSignal.timeout(10000)).
export interface MoveEntityResult {
  ok: boolean;
  sourceSlug?: string;
  targetSlug?: string;
  moved?: string;         // vault-relative final path, e.g. "1-Projects/<slug>/tasks/<stem>.md"
  renamedFrom?: string;   // original stem (only when collision auto-suffix applied)
  renamedTo?: string;     // suffixed stem (e.g. "foo-2")
}

export function moveEntityTaskApi(args: {
  entityPath: string;
  targetSlug: string;
}): Promise<ApiResult<MoveEntityResult>> {
  return postJson<MoveEntityResult>("/api/tasks/move", args);
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
 *
 * Sprint H R2 critic-fix (Codex R2-HMR-SEQ-RESET MEDIUM) — Vite HMR
 * can reload this module (resetting fetchVaultSeq to 0) while leaving
 * the Zustand store alive with a high maxAppliedVaultSeq. Without a
 * reseed, post-HMR fetches would silently drop for several ticks
 * until the counter climbs past the stored max. On module init we
 * persist the counter on globalThis + seed from the store's current
 * maxAppliedVaultSeq. Result: monotonic across both HMR and cold
 * reload.
 */
type GlobalWithCounter = typeof globalThis & { __fetchVaultSeq?: number };
const g = globalThis as GlobalWithCounter;
let fetchVaultSeq: number = g.__fetchVaultSeq ?? 0;
export function nextVaultSeq(): number {
  // Lazy-seed from the store if the counter is behind the store's max
  // (defensive — handles HMR where the counter reset but store didn't).
  // Avoid circular import by reading dynamically via string-keyed global.
  const storeMax = (globalThis as unknown as {
    __maxAppliedVaultSeq?: number;
  }).__maxAppliedVaultSeq ?? 0;
  if (fetchVaultSeq < storeMax) fetchVaultSeq = storeMax;
  fetchVaultSeq += 1;
  g.__fetchVaultSeq = fetchVaultSeq;
  return fetchVaultSeq;
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

/**
 * Sprint I.8 — return both close + reconnect handles. `close` tears down
 * the EventSource on unmount. `reconnect` explicitly closes + reopens
 * the connection when the user clicks the Retry button in the SSE banner.
 * The EventSource's own auto-reconnect keeps going in the background;
 * manual reconnect forces a fresh attempt with a clean state transition
 * instead of waiting for the next browser-driven backoff tick.
 */
export function subscribeVaultEvents(
  onChange: () => void,
  onConnectionChange?: (state: SSEConnectionState) => void,
): { close: () => void; reconnect: () => void } {
  let source: EventSource | null = null;

  function attach(): void {
    source = new EventSource("/api/events");
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
      if (!source) return;
      const rs = source.readyState;
      onConnectionChange?.(rs === EventSource.CLOSED ? "closed" : "connecting");
    });
  }

  attach();

  return {
    close: () => {
      source?.close();
      source = null;
    },
    reconnect: () => {
      source?.close();
      source = null;
      onConnectionChange?.("connecting");
      attach();
    },
  };
}
