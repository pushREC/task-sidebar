import { useEffect, useRef } from "react";
import { useSidebarStore, type ActiveTab } from "../store.js";

const G_SEQUENCE_TIMEOUT_MS = 1500;

function isInputFocused(): boolean {
  const tag = document.activeElement?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function getVisibleTaskIds(): string[] {
  const rows = document.querySelectorAll<HTMLElement>("[data-task-row]");
  return Array.from(rows).map((el) => el.dataset.taskId ?? "");
}

/**
 * Global keyboard navigation hook.
 * Register once at the App level — it drives all shortcut behaviour.
 */
export function useKeyboardNav(
  onFocusQuickAdd: () => void,
  onFocusSearch: () => void,
  onEnterEdit: () => void,
  onToggleSelected: () => void,
  onCycleTheme: () => void,
  onEnterExpand?: () => void
) {
  const gPendingRef = useRef(false);
  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const store = useSidebarStore;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // ⌘D / Ctrl+D — cycle theme (fires even when input focused)
      if (e.key === "d" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onCycleTheme();
        return;
      }

      // All other shortcuts require focus to NOT be in an input
      if (isInputFocused()) return;

      const state = store.getState();

      // Tab jump — 1/2/3
      if (e.key === "1") { e.preventDefault(); jumpToTab("today"); return; }
      if (e.key === "2") { e.preventDefault(); jumpToTab("projects"); return; }
      if (e.key === "3") { e.preventDefault(); jumpToTab("tasks"); return; }

      // g-sequence: g t / g p / g a
      if (e.key === "g" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        gPendingRef.current = true;
        if (gTimerRef.current !== null) clearTimeout(gTimerRef.current);
        gTimerRef.current = setTimeout(() => {
          gPendingRef.current = false;
          gTimerRef.current = null;
        }, G_SEQUENCE_TIMEOUT_MS);
        return;
      }

      if (gPendingRef.current) {
        gPendingRef.current = false;
        if (gTimerRef.current !== null) { clearTimeout(gTimerRef.current); gTimerRef.current = null; }
        if (e.key === "t") { e.preventDefault(); jumpToTab("today"); return; }
        if (e.key === "p") { e.preventDefault(); jumpToTab("projects"); return; }
        if (e.key === "a") { e.preventDefault(); jumpToTab("tasks"); return; }
      }

      // j / k — move selection down / up
      if (e.key === "j") {
        e.preventDefault();
        moveSelection(state.selectedTaskId, 1);
        return;
      }
      if (e.key === "k") {
        e.preventDefault();
        moveSelection(state.selectedTaskId, -1);
        return;
      }

      // x — toggle selected task
      if (e.key === "x") {
        e.preventDefault();
        onToggleSelected();
        return;
      }

      // a — focus quick-add
      if (e.key === "a") {
        e.preventDefault();
        onFocusQuickAdd();
        return;
      }

      // e — inline-edit selected
      if (e.key === "e") {
        e.preventDefault();
        onEnterEdit();
        return;
      }

      // Enter — toggle inline-expand detail panel on selected task
      if (e.key === "Enter") {
        e.preventDefault();
        onEnterExpand?.();
        return;
      }

      // / — focus search
      if (e.key === "/") {
        e.preventDefault();
        onFocusSearch();
        return;
      }

      // Escape — collapse expanded task panel first, then clear selection
      if (e.key === "Escape") {
        e.preventDefault();
        const currentState = store.getState();
        if ("expandedTaskId" in currentState && currentState.expandedTaskId) {
          (currentState as { setExpandedTaskId: (id: null) => void }).setExpandedTaskId(null);
        } else {
          currentState.setSelectedTaskId(null);
        }
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onFocusQuickAdd, onFocusSearch, onEnterEdit, onToggleSelected, onCycleTheme]);
}

function jumpToTab(tab: ActiveTab): void {
  const state = useSidebarStore.getState();
  state.setActiveTab(tab);
  // Select the first task in the new view after a short render tick
  setTimeout(() => {
    const ids = getVisibleTaskIds();
    if (ids.length > 0) {
      useSidebarStore.getState().setSelectedTaskId(ids[0]);
    }
  }, 50);
}

function moveSelection(currentId: string | null, direction: 1 | -1): void {
  const ids = getVisibleTaskIds();
  if (ids.length === 0) return;

  const state = useSidebarStore.getState();

  if (currentId === null) {
    state.setSelectedTaskId(ids[direction === 1 ? 0 : ids.length - 1]);
    return;
  }

  const idx = ids.indexOf(currentId);
  if (idx === -1) {
    state.setSelectedTaskId(ids[0]);
    return;
  }

  const nextIdx = Math.max(0, Math.min(ids.length - 1, idx + direction));
  state.setSelectedTaskId(ids[nextIdx]);
}
