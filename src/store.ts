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

interface SidebarState {
  // ── Live vault data (NOT persisted) ─────────────────────────────────────
  vault: VaultResponse | null;
  errorTaskIds: Set<string>;
  selectedTaskId: string | null;

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

  // ── Actions ─────────────────────────────────────────────────────────────
  setVault: (vault: VaultResponse) => void;
  optimisticToggle: (taskId: string) => void;
  markTaskError: (taskId: string) => void;
  clearTaskError: (taskId: string) => void;
  setSelectedTaskId: (id: string | null) => void;
  setActiveTab: (tab: ActiveTab) => void;
  toggleProjectExpanded: (slug: string) => void;
  toggleBucketCollapsed: (bucket: BucketName) => void;
  setBucketCollapsed: (bucket: BucketName, collapsed: boolean) => void;
  setExpandedTaskId: (id: string | null) => void;
  setExpandedProjectSlug: (slug: string | null) => void;
  setEntityCreateMode: (enabled: boolean) => void;
  setEntityCreateDefaults: (defaults: Partial<EntityFields> | null) => void;
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
      selectedTaskId: null,
      activeTab: "agenda",
      collapsedBuckets: new Set<BucketName>(DEFAULT_COLLAPSED),
      expandedProjects: new Set<string>(),
      expandedTaskId: null,
      expandedProjectSlug: null,
      entityCreateMode: false,
      entityCreateDefaults: null,

      // ── Actions ───────────────────────────────────────────────────────────
      setVault(vault) {
        set({ vault });
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

      markTaskError(taskId) {
        set((state) => ({
          errorTaskIds: new Set([...state.errorTaskIds, taskId]),
        }));
      },

      clearTaskError(taskId) {
        set((state) => {
          const next = new Set(state.errorTaskIds);
          next.delete(taskId);
          return { errorTaskIds: next };
        });
      },

      setSelectedTaskId(id) {
        set({ selectedTaskId: id });
      },

      setActiveTab(tab) {
        set({ activeTab: tab, selectedTaskId: null });
      },

      toggleProjectExpanded(slug) {
        set((state) => {
          const next = new Set(state.expandedProjects);
          if (next.has(slug)) next.delete(slug);
          else next.add(slug);
          return { expandedProjects: next };
        });
      },

      toggleBucketCollapsed(bucket) {
        set((state) => {
          const next = new Set(state.collapsedBuckets);
          if (next.has(bucket)) next.delete(bucket);
          else next.add(bucket);
          return { collapsedBuckets: next };
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
