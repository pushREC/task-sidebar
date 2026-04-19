import { create } from "zustand";
import { persist, type PersistStorage } from "zustand/middleware";
import type { VaultResponse } from "./api.js";
import {
  ALL_BUCKETS,
  DEFAULT_COLLAPSED,
  type BucketName,
} from "./lib/time-buckets.js";

/**
 * Sidebar store — Zustand with `persist` middleware.
 *
 * Persistence strategy (Sprint B D13, matching pushrec-dashboard's view-store):
 *   - Only serialize structural view state (activeTab, collapsedBuckets,
 *     expandedProjects).
 *   - Transient selection/editor state is deliberately EXCLUDED from
 *     persistence to avoid staleness across sessions.
 *   - Version bumps handled via `migrate` to survive schema changes.
 */

// Sprint B D16 — tabs became Agenda · Projects. Old "tasks"/"today" values
// are migrated to "agenda" in the migrate() function below.
export type ActiveTab = "agenda" | "projects";

export interface EntityFields {
  action?: string;
  status?: "backlog" | "open" | "in-progress" | "blocked" | "done" | "cancelled";
  owner?: "human" | "agent" | "either";
  energyLevel?: "low" | "medium" | "high";
  estimatedDuration?: number;
  due?: string;
  impact?: "very-high" | "high" | "medium" | "low" | "very-low";
  urgency?: "very-high" | "high" | "medium" | "low" | "very-low";
  blockedBy?: string;
  parentGoal?: string;
}

/**
 * Sprint G — Bulk selection + undo toast.
 * `pendingUndo` is ONE window at a time (keyed by action+taskIds);
 * clicking Undo or ⌘Z within 5s fires the reverter. After 5s the window
 * expires (UndoToast unmounts + server-side reconcile commits).
 */
export type UndoAction = "done" | "cancel" | "delete" | "bulk-done";

export interface PendingUndo {
  action: UndoAction;
  taskIds: string[];
  // entityPaths for tasks that were done → server holds a 5s delayed
  // reconcile for each path; we call /api/tasks/undo-reconcile on each
  // to cancel them if the user undoes.
  entityPaths: string[];
  // label shown in the toast (e.g. "3 tasks done" / "Task deleted")
  label: string;
  undoneAt: number;  // Date.now() captured at queue-time
  revert: () => Promise<void>;  // caller-provided reverter
}

interface SidebarState {
  // ── Live vault data (NOT persisted) ─────────────────────────────────────
  vault: VaultResponse | null;
  errorTaskIds: Set<string>;
  /** Sprint H R2 D2 — per-task error message for hover-tooltip specificity.
   *  Populated via markTaskError(taskId, message?). Keyed by taskId; only
   *  populated when the caller supplies a message. TaskRow reads from this
   *  Map and falls back to the generic "Write failed" string when unset. */
  taskErrorMessages: Map<string, string>;
  /** Legacy single-selection pointer for backward-compat with j/k nav.
   *  Sprint G adds `selectedTaskIds` as the authoritative multi-select.
   *  When one item is in selectedTaskIds, both reflect the same id. */
  selectedTaskId: string | null;
  /** Sprint G — multi-selection. Superset of selectedTaskId. Empty when no
   *  rows are selected. All actions that needed the single id now also
   *  consult this set first and fall back to selectedTaskId. */
  selectedTaskIds: Set<string>;
  /** Sprint G — one pending undo window at a time. `null` = no toast. */
  pendingUndo: PendingUndo | null;
  /** Sprint H R2 D3 — monotonic seq of the most-recently-applied fetchVault
   *  response. setVault(vault, seq) drops any write whose seq ≤ this value,
   *  preventing stale concurrent fetches from clobbering newer state. */
  maxAppliedVaultSeq: number;

  // ── Persisted view state ────────────────────────────────────────────────
  activeTab: ActiveTab;
  collapsedBuckets: Set<BucketName>;
  expandedProjects: Set<string>;

  // ── Inline-expand detail state (NOT persisted — too transient) ──────────
  expandedTaskId: string | null;
  expandedProjectSlug: string | null;

  // ── Entity create modal (NOT persisted) ─────────────────────────────────
  entityCreateMode: boolean;
  entityCreateDefaults: Partial<EntityFields> | null;

  // ── Sprint D — command palette (NOT persisted) ──────────────────────────
  paletteOpen: boolean;

  // ── Actions ─────────────────────────────────────────────────────────────
  /** Sprint H R2 D3 — optional `seq` routes concurrent-fetch ordering.
   *  When provided and ≤ maxAppliedVaultSeq, the update is silently
   *  dropped (newer state already applied). When omitted (SSE/legacy
   *  callers), the update always applies. */
  setVault: (vault: VaultResponse, seq?: number) => void;
  optimisticToggle: (taskId: string) => void;
  /** Sprint H R2 D2 — optional `message` argument routes to taskErrorMessages. */
  markTaskError: (taskId: string, message?: string) => void;
  clearTaskError: (taskId: string) => void;
  setSelectedTaskId: (id: string | null) => void;
  // Sprint G actions
  addSelection: (id: string) => void;
  removeSelection: (id: string) => void;
  toggleSelection: (id: string) => void;
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;
  setPendingUndo: (undo: PendingUndo | null) => void;
  setActiveTab: (tab: ActiveTab) => void;
  toggleProjectExpanded: (slug: string) => void;
  toggleBucketCollapsed: (bucket: BucketName) => void;
  setBucketCollapsed: (bucket: BucketName, collapsed: boolean) => void;
  setExpandedTaskId: (id: string | null) => void;
  setExpandedProjectSlug: (slug: string | null) => void;
  setEntityCreateMode: (enabled: boolean) => void;
  setEntityCreateDefaults: (defaults: Partial<EntityFields> | null) => void;
  setPaletteOpen: (open: boolean) => void;
}

// ─── Persisted shape (disk format) ──────────────────────────────────────────
// Keep this narrow and stable: adding fields is backwards-compatible but
// renaming any existing field requires a `migrate` bump.
interface PersistedState {
  activeTab: ActiveTab;
  collapsedBucketsArr: BucketName[];
  expandedProjectsArr: string[];
}

// ─── Storage adapter with Set↔Array + version migrate ───────────────────────
const LOCAL_STORAGE_KEY = "vault-sidebar-state";
const STORE_VERSION = 2;

const storage: PersistStorage<PersistedState> = {
  getItem(name) {
    try {
      const raw = localStorage.getItem(name);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        state?: PersistedState;
        version?: number;
      };
      if (!parsed.state) return null;
      return { state: parsed.state, version: parsed.version ?? 0 };
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    try {
      localStorage.setItem(
        name,
        JSON.stringify({ state: value.state, version: value.version })
      );
    } catch {
      // quota exceeded / safari-private — silent; in-memory state still works
    }
  },
  removeItem(name) {
    try {
      localStorage.removeItem(name);
    } catch {
      // noop
    }
  },
};

/**
 * v1 → v2 migration:
 *   - v1 had `activeTab: "today" | "projects" | "tasks"` under a different
 *     localStorage key (`vault-sidebar-tab`). v2 introduces `collapsedBuckets`
 *     and renames `"tasks"` → `"agenda"`. Kill Today tab → `"today"` also
 *     maps to `"agenda"`.
 *   - Unknown bucket names from future versions are dropped defensively.
 */
function migrate(persisted: unknown, version: number): PersistedState {
  const safe = (persisted ?? {}) as Partial<PersistedState> & {
    activeTab?: string;
    collapsedBucketsArr?: unknown;
    expandedProjectsArr?: unknown;
  };

  // Map legacy tab values to the v2 Agenda+Projects world
  const rawTab = String(safe.activeTab ?? "");
  const activeTab: ActiveTab =
    rawTab === "projects" ? "projects" : "agenda"; // tasks / today / anything → agenda

  // Filter bucket names through the allowlist to survive version drift
  const incomingBuckets = Array.isArray(safe.collapsedBucketsArr)
    ? (safe.collapsedBucketsArr as unknown[])
    : [];
  const allowed = new Set<string>(ALL_BUCKETS);
  const collapsedBucketsArr = incomingBuckets
    .filter((b): b is BucketName => typeof b === "string" && allowed.has(b))
    .map((b) => b as BucketName);

  // Defaults on first hydrate or missing field
  const expandedProjectsArr = Array.isArray(safe.expandedProjectsArr)
    ? (safe.expandedProjectsArr as unknown[]).filter(
        (s): s is string => typeof s === "string"
      )
    : [];

  // Fresh install (version 0) or legacy (v1 pre-persist-middleware) → seed
  // with DEFAULT_COLLAPSED so non-urgent buckets start out closed.
  const finalCollapsed =
    version < STORE_VERSION && collapsedBucketsArr.length === 0
      ? [...DEFAULT_COLLAPSED]
      : collapsedBucketsArr;

  return {
    activeTab,
    collapsedBucketsArr: finalCollapsed,
    expandedProjectsArr,
  };
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set, get) => ({
      // ── Initial state ─────────────────────────────────────────────────────
      vault: null,
      errorTaskIds: new Set(),
      taskErrorMessages: new Map(),
      selectedTaskId: null,
      selectedTaskIds: new Set(),
      pendingUndo: null,
      maxAppliedVaultSeq: 0,
      activeTab: "agenda",
      collapsedBuckets: new Set<BucketName>(DEFAULT_COLLAPSED),
      expandedProjects: new Set<string>(),
      expandedTaskId: null,
      expandedProjectSlug: null,
      entityCreateMode: false,
      entityCreateDefaults: null,
      paletteOpen: false,

      // ── Actions ───────────────────────────────────────────────────────────
      setVault(vault, seq) {
        // Sprint C R3-C-2 (Codex) — inline task ids are line-based
        // (`inline:{slug}:{lineNumber}` in vault-index.ts). After a
        // promote+refetch the ids shift, so any errorTaskIds kept from
        // the pre-refetch snapshot would attach to whatever inline task
        // inherited that line number. Clear on every vault update; it's
        // transient state (2s auto-clear anyway) and clearing avoids
        // the subtle mis-attach.
        //
        // Sprint H R2 D3 — if caller supplied a seq token, reject stale
        // writes. Omitted seq → legacy code path (SSE trigger, initial
        // fetch on boot) — always apply.
        set((state) => {
          if (seq !== undefined && seq <= state.maxAppliedVaultSeq) {
            // Silently drop — a newer fetch already applied to store.
            return state;
          }
          return {
            ...state,
            vault,
            errorTaskIds: new Set(),
            taskErrorMessages: new Map(),
            maxAppliedVaultSeq: seq !== undefined ? seq : state.maxAppliedVaultSeq,
          };
        });
      },

      optimisticToggle(taskId) {
        const { vault } = get();
        if (!vault) return;

        // B09 — flip done + status together; preserve richer states.
        const flipInList = <T extends { id: string; done: boolean; status?: string }>(
          list: T[]
        ): T[] =>
          list.map((t) => {
            if (t.id !== taskId) return t;
            const nextDone = !t.done;
            const nextStatus =
              t.status === "open" || t.status === "done" || t.status === undefined
                ? nextDone
                  ? "done"
                  : "open"
                : t.status;
            return { ...t, done: nextDone, status: nextStatus as typeof t.status };
          });

        set({
          vault: {
            ...vault,
            today: flipInList(vault.today),
            projects: vault.projects.map((p) => ({
              ...p,
              tasks: flipInList(p.tasks),
            })),
          },
        });
      },

      markTaskError(taskId, message) {
        set((state) => {
          const nextIds = new Set([...state.errorTaskIds, taskId]);
          if (message === undefined) {
            return { errorTaskIds: nextIds };
          }
          const nextMsgs = new Map(state.taskErrorMessages);
          nextMsgs.set(taskId, message);
          return { errorTaskIds: nextIds, taskErrorMessages: nextMsgs };
        });
      },

      clearTaskError(taskId) {
        set((state) => {
          const nextIds = new Set(state.errorTaskIds);
          nextIds.delete(taskId);
          const nextMsgs = state.taskErrorMessages.has(taskId)
            ? (() => {
                const m = new Map(state.taskErrorMessages);
                m.delete(taskId);
                return m;
              })()
            : state.taskErrorMessages;
          return { errorTaskIds: nextIds, taskErrorMessages: nextMsgs };
        });
      },

      setSelectedTaskId(id) {
        // Single-select also seeds the multi-set (single→multi transition).
        if (id === null) {
          set({ selectedTaskId: null, selectedTaskIds: new Set() });
        } else {
          set({ selectedTaskId: id, selectedTaskIds: new Set([id]) });
        }
      },

      addSelection(id) {
        set((state) => {
          const next = new Set(state.selectedTaskIds);
          next.add(id);
          return { selectedTaskIds: next, selectedTaskId: id };
        });
      },
      removeSelection(id) {
        set((state) => {
          const next = new Set(state.selectedTaskIds);
          next.delete(id);
          // If we just cleared the anchor, promote another member (or null).
          const nextAnchor = state.selectedTaskId === id
            ? (next.size > 0 ? [...next][next.size - 1] : null)
            : state.selectedTaskId;
          return { selectedTaskIds: next, selectedTaskId: nextAnchor };
        });
      },
      toggleSelection(id) {
        const current = get().selectedTaskIds;
        if (current.has(id)) {
          get().removeSelection(id);
        } else {
          get().addSelection(id);
        }
      },
      setSelection(ids) {
        const next = new Set(ids);
        set({
          selectedTaskIds: next,
          // Anchor = last element (becomes the j/k cursor)
          selectedTaskId: ids.length > 0 ? ids[ids.length - 1] : null,
        });
      },
      clearSelection() {
        set({ selectedTaskIds: new Set(), selectedTaskId: null });
      },

      setPendingUndo(undo) {
        set({ pendingUndo: undo });
      },

      setActiveTab(tab) {
        set({ activeTab: tab, selectedTaskId: null });
      },

      toggleProjectExpanded(slug) {
        set((state) => {
          const next = new Set(state.expandedProjects);
          const collapsing = next.has(slug);
          if (collapsing) next.delete(slug);
          else next.add(slug);
          // R4-3 (Gemini) — mirror the bucket-collapse pattern: clear
          // selectedTaskId if it lives inside the project being collapsed.
          // Otherwise j/k next-press jumps to the top of the list.
          const patch: Partial<SidebarState> = { expandedProjects: next };
          if (collapsing && state.selectedTaskId) {
            const sel = document.querySelector<HTMLElement>(
              `[data-task-id="${state.selectedTaskId}"]`
            );
            const group = sel?.closest<HTMLElement>("[data-project-slug]");
            if (group?.dataset.projectSlug === slug) {
              patch.selectedTaskId = null;
            }
          }
          return patch;
        });
      },

      toggleBucketCollapsed(bucket) {
        set((state) => {
          const next = new Set(state.collapsedBuckets);
          const collapsing = !next.has(bucket);
          if (collapsing) next.add(bucket);
          else next.delete(bucket);
          // Clear selectedTaskId if the user just collapsed the bucket that
          // owns it — otherwise j/k nav no-ops against a now-hidden row.
          // (Pairs with keyboard.ts's getVisibleTaskIds hidden-ancestor
          // guard; both added in Sprint B round 3.)
          const patch: Partial<SidebarState> = { collapsedBuckets: next };
          if (collapsing && state.selectedTaskId) {
            const sel = document.querySelector<HTMLElement>(
              `[data-task-id="${state.selectedTaskId}"]`
            );
            const sec = sel?.closest<HTMLElement>("section[data-bucket]");
            if (sec?.dataset.bucket === bucket) {
              patch.selectedTaskId = null;
            }
          }
          return patch;
        });
      },

      setBucketCollapsed(bucket, collapsed) {
        set((state) => {
          const next = new Set(state.collapsedBuckets);
          if (collapsed) next.add(bucket);
          else next.delete(bucket);
          return { collapsedBuckets: next };
        });
      },

      setExpandedTaskId(id) {
        set({ expandedTaskId: id });
      },

      setExpandedProjectSlug(slug) {
        set({ expandedProjectSlug: slug });
      },

      setEntityCreateMode(enabled) {
        set({ entityCreateMode: enabled });
        if (!enabled) {
          set({ entityCreateDefaults: null });
        }
      },

      setEntityCreateDefaults(defaults) {
        set({ entityCreateDefaults: defaults });
      },

      setPaletteOpen(open) {
        set({ paletteOpen: open });
      },
    }),
    {
      name: LOCAL_STORAGE_KEY,
      version: STORE_VERSION,
      storage,
      // Only persist structural view state; hydrate Sets from arrays.
      partialize: (state): PersistedState => ({
        activeTab: state.activeTab,
        collapsedBucketsArr: Array.from(state.collapsedBuckets),
        expandedProjectsArr: Array.from(state.expandedProjects),
      }),
      migrate: (persisted, version) => migrate(persisted, version),
      merge: (persistedUnknown, current) => {
        // Rehydrate Sets from the persisted arrays.
        const persisted = persistedUnknown as PersistedState | undefined;
        if (!persisted) return current;
        const allowed = new Set<string>(ALL_BUCKETS);
        return {
          ...current,
          activeTab: persisted.activeTab === "projects" ? "projects" : "agenda",
          collapsedBuckets: new Set<BucketName>(
            (persisted.collapsedBucketsArr ?? []).filter((b): b is BucketName =>
              typeof b === "string" && allowed.has(b)
            )
          ),
          expandedProjects: new Set<string>(
            (persisted.expandedProjectsArr ?? []).filter(
              (s): s is string => typeof s === "string"
            )
          ),
        } as SidebarState;
      },
    }
  )
);

// One-shot legacy cleanup: older versions wrote to a raw key
// "vault-sidebar-tab"; remove it if present so we don't leave dead data.
try {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.removeItem("vault-sidebar-tab");
  }
} catch {
  // noop
}
