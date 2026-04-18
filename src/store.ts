import { create } from "zustand";
import type { VaultResponse } from "./api.js";

export type ActiveTab = "today" | "projects" | "tasks";

export interface EntityFields {
  action?: string;
  status?: "backlog" | "open" | "in-progress" | "blocked" | "done";
  owner?: "human" | "agent" | "either";
  energyLevel?: "low" | "medium" | "high";
  estimatedDuration?: number;
  due?: string;
  impact?: "very-high" | "high" | "medium" | "low" | "very-low";
  urgency?: "very-high" | "high" | "medium" | "low" | "very-low";
  blockedBy?: string;
  parentGoal?: string;
}

function readStoredTab(): ActiveTab {
  try {
    const stored = localStorage.getItem("vault-sidebar-tab");
    if (stored === "today" || stored === "projects" || stored === "tasks") return stored;
  } catch {
    // ignore
  }
  return "today";
}

interface SidebarState {
  vault: VaultResponse | null;
  errorTaskIds: Set<string>;
  selectedTaskId: string | null;
  activeTab: ActiveTab;
  expandedProjects: Set<string>;
  // v2.0 — inline-expand detail view
  expandedTaskId: string | null;
  expandedProjectSlug: string | null;
  // v2.0 — entity create mode
  entityCreateMode: boolean;
  entityCreateDefaults: Partial<EntityFields> | null;

  setVault: (vault: VaultResponse) => void;
  optimisticToggle: (taskId: string) => void;
  markTaskError: (taskId: string) => void;
  clearTaskError: (taskId: string) => void;
  setSelectedTaskId: (id: string | null) => void;
  setActiveTab: (tab: ActiveTab) => void;
  toggleProjectExpanded: (slug: string) => void;
  // v2.0 actions
  setExpandedTaskId: (id: string | null) => void;
  setExpandedProjectSlug: (slug: string | null) => void;
  setEntityCreateMode: (enabled: boolean) => void;
  setEntityCreateDefaults: (defaults: Partial<EntityFields> | null) => void;
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  vault: null,
  errorTaskIds: new Set(),
  selectedTaskId: null,
  activeTab: readStoredTab(),
  expandedProjects: new Set(),
  expandedTaskId: null,
  expandedProjectSlug: null,
  entityCreateMode: false,
  entityCreateDefaults: null,

  setVault(vault) {
    set({ vault });
  },

  optimisticToggle(taskId) {
    const { vault } = get();
    if (!vault) return;

    // B09 — flip both `done` and `status`. Only rewrite status for the simple
    // open⇄done pair; leave `in-progress` / `blocked` / `cancelled` / `backlog`
    // untouched so toggling a circle never silently overwrites a richer state.
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
    try {
      localStorage.setItem("vault-sidebar-tab", tab);
    } catch {
      // ignore
    }
  },

  toggleProjectExpanded(slug) {
    set((state) => {
      const next = new Set(state.expandedProjects);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return { expandedProjects: next };
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
}));
