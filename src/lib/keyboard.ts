import { useEffect, useRef } from "react";
import { useSidebarStore, type ActiveTab } from "../store.js";
import type { BucketName } from "./time-buckets.js";

const G_SEQUENCE_TIMEOUT_MS = 1500;

function isInputFocused(): boolean {
  const tag = document.activeElement?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

/**
 * Query all visible task row ids in DOM order.
 * Used by j/k nav and for auto-select when jumping tabs.
 */
function getVisibleTaskIds(): string[] {
  const rows = document.querySelectorAll<HTMLElement>("[data-task-row]");
  return Array.from(rows).map((el) => el.dataset.taskId ?? "");
}

/**
 * Find the bucket a given row belongs to by walking up from `[data-task-row]`
 * to the closest `section[data-bucket]` ancestor. Returns `null` when the row
 * lives outside a bucket (e.g. Projects view).
 *
 * C-1 — selector scoped to `section[data-bucket]` because BucketHeader no
 * longer emits data-bucket (removed in convergence round 1).
 */
function bucketOfRow(taskId: string): string | null {
  const row = document.querySelector<HTMLElement>(
    `[data-task-id="${taskId}"]`
  );
  if (!row) return null;
  const sec = row.closest<HTMLElement>("section[data-bucket]");
  return sec?.dataset.bucket ?? null;
}

/** Task ids belonging to a specific bucket, in DOM order. */
function getTaskIdsInBucket(bucket: string): string[] {
  const sec = document.querySelector<HTMLElement>(
    `section[data-bucket="${bucket}"]`
  );
  if (!sec) return [];
  const rows = sec.querySelectorAll<HTMLElement>("[data-task-row]");
  return Array.from(rows).map((el) => el.dataset.taskId ?? "");
}

/** All bucket names currently rendered, in DOM order. */
function getVisibleBuckets(): string[] {
  const secs = document.querySelectorAll<HTMLElement>("section[data-bucket]");
  return Array.from(secs).map((el) => el.dataset.bucket ?? "");
}

/**
 * Global keyboard navigation hook.
 * Register once at the App level — it drives all shortcut behaviour.
 *
 * Shortcut map (Sprint B):
 *   1          → Agenda tab
 *   2          → Projects tab
 *   g a        → Agenda tab (legacy mnemonic, kept for muscle memory)
 *   g p        → Projects tab
 *   g j        → next bucket (auto-expand + first row)
 *   g k        → previous bucket (auto-expand + first row)
 *   j / k      → row select within bucket (bounded)
 *   Tab        → cross bucket boundary (auto-expands collapsed buckets)
 *   Shift+Tab  → cross bucket boundary backward
 *   a          → focus quick-add
 *   e          → inline-edit selected row
 *   Enter      → toggle inline-expand detail panel on selected row
 *   x          → toggle done on selected row
 *   / (slash)  → focus search (Projects tab; Agenda has no search in v1)
 *   Esc        → collapse panel / clear selection
 *   ⌘D / Ctrl+D→ cycle theme (works even in inputs)
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
  // C-3 — pending nav-timer refs so rapid key sequences cancel stale work
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      // Tab jump — 1 Agenda / 2 Projects
      if (e.key === "1") {
        e.preventDefault();
        jumpToTab("agenda", navTimerRef);
        return;
      }
      if (e.key === "2") {
        e.preventDefault();
        jumpToTab("projects", navTimerRef);
        return;
      }

      // g-sequence initiator
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
        if (gTimerRef.current !== null) {
          clearTimeout(gTimerRef.current);
          gTimerRef.current = null;
        }
        if (e.key === "a") {
          e.preventDefault();
          jumpToTab("agenda", navTimerRef);
          return;
        }
        if (e.key === "p") {
          e.preventDefault();
          jumpToTab("projects", navTimerRef);
          return;
        }
        if (e.key === "j") {
          e.preventDefault();
          jumpBucket(1, navTimerRef);
          return;
        }
        if (e.key === "k") {
          e.preventDefault();
          jumpBucket(-1, navTimerRef);
          return;
        }
      }

      // Tab / Shift+Tab — cross bucket boundary.
      // H-1 — only hijack when the agenda itself owns focus. The listbox
      // container on .agenda-view is tabIndex=-1 and holds "virtual" focus
      // via aria-activedescendant. If any input/button/select elsewhere
      // has focus, let the browser's natural Tab order work.
      if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const ae = document.activeElement as HTMLElement | null;
        const agendaOwnsFocus =
          ae === null ||
          ae === document.body ||
          ae.closest<HTMLElement>(".agenda-view") !== null;
        if (
          state.activeTab === "agenda" &&
          state.selectedTaskId &&
          agendaOwnsFocus
        ) {
          e.preventDefault();
          jumpBucket(e.shiftKey ? -1 : 1, navTimerRef);
          return;
        }
        // Otherwise let the browser handle normal focus nav
      }

      // j / k — move selection within current bucket (D14 bucket-bounded)
      if (e.key === "j") {
        e.preventDefault();
        moveSelectionBucketBounded(state.selectedTaskId, 1);
        return;
      }
      if (e.key === "k") {
        e.preventDefault();
        moveSelectionBucketBounded(state.selectedTaskId, -1);
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

      // / — focus search (Projects view only; Agenda has no search in v1)
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
  }, [onFocusQuickAdd, onFocusSearch, onEnterEdit, onToggleSelected, onCycleTheme, onEnterExpand]);
}

type TimerRef = { current: ReturnType<typeof setTimeout> | null };

/** C-3 — cancel any pending nav timer before scheduling a new one. */
function cancelPendingNav(timerRef: TimerRef): void {
  if (timerRef.current !== null) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

function jumpToTab(tab: ActiveTab, timerRef: TimerRef): void {
  cancelPendingNav(timerRef);
  const state = useSidebarStore.getState();
  state.setActiveTab(tab);
  // O-4 — clear transient detail-panel state on tab switch so a task with
  // the same sanitized id in the new tab doesn't silently inherit expand.
  state.setExpandedTaskId(null);
  // Select the first task in the new view after a short render tick
  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    const ids = getVisibleTaskIds();
    if (ids.length > 0) {
      useSidebarStore.getState().setSelectedTaskId(ids[0]);
    }
  }, 50);
}

/**
 * D14 — j/k stay within the current bucket. Cross-bucket movement is via
 * Tab / Shift+Tab / gj / gk.
 */
function moveSelectionBucketBounded(
  currentId: string | null,
  direction: 1 | -1
): void {
  const state = useSidebarStore.getState();
  const allIds = getVisibleTaskIds();
  if (allIds.length === 0) return;

  // No selection → pick first/last visible row, regardless of bucket.
  if (currentId === null) {
    state.setSelectedTaskId(
      allIds[direction === 1 ? 0 : allIds.length - 1]
    );
    return;
  }

  const currentBucket = bucketOfRow(currentId);
  if (!currentBucket) {
    // We're on a row outside any bucket (e.g. Projects view) — fall back
    // to simple list nav across all visible rows.
    const idx = allIds.indexOf(currentId);
    if (idx === -1) {
      state.setSelectedTaskId(allIds[0]);
      return;
    }
    const next = Math.max(0, Math.min(allIds.length - 1, idx + direction));
    state.setSelectedTaskId(allIds[next]);
    return;
  }

  const ids = getTaskIdsInBucket(currentBucket);
  if (ids.length === 0) return;
  const idx = ids.indexOf(currentId);
  if (idx === -1) {
    state.setSelectedTaskId(ids[0]);
    return;
  }
  // Bucket-bounded: stop at edges (don't wrap).
  const next = Math.max(0, Math.min(ids.length - 1, idx + direction));
  state.setSelectedTaskId(ids[next]);
}

/**
 * D15 — jumping to an adjacent bucket. Skips EMPTY buckets (O-2/C-2) so
 * gj/gk and Tab/Shift+Tab always land on a bucket with selectable rows.
 * If the target bucket is collapsed but non-empty, auto-expand it first.
 * C-3 — pending timeout cancellable via timerRef.
 */
function jumpBucket(direction: 1 | -1, timerRef: TimerRef): void {
  cancelPendingNav(timerRef);
  const state = useSidebarStore.getState();
  const buckets = getVisibleBuckets();
  if (buckets.length === 0) return;

  const currentBucket =
    state.selectedTaskId !== null ? bucketOfRow(state.selectedTaskId) : null;

  // Build the candidate list in the direction we're heading, excluding the
  // current bucket. First bucket containing rendered task rows wins.
  let startIdx: number;
  let boundIdx: number;
  if (currentBucket === null) {
    // No current selection — scan from the start (direction=1) or end (-1).
    startIdx = direction === 1 ? 0 : buckets.length - 1;
    boundIdx = direction === 1 ? buckets.length : -1;
  } else {
    const cur = buckets.indexOf(currentBucket);
    if (cur === -1) {
      startIdx = direction === 1 ? 0 : buckets.length - 1;
      boundIdx = direction === 1 ? buckets.length : -1;
    } else {
      startIdx = cur + direction;
      boundIdx = direction === 1 ? buckets.length : -1;
    }
  }

  let targetBucket: string | null = null;
  for (let i = startIdx; i !== boundIdx; i += direction) {
    if (i < 0 || i >= buckets.length) break;
    const candidate = buckets[i];
    // A bucket counts as non-empty if it has rendered rows OR is collapsed
    // with a >0 count (we'll auto-expand it below). Empty-always-shown
    // buckets (Overdue/Today/Tomorrow with 0 tasks) get skipped.
    const isCollapsed = state.collapsedBuckets.has(candidate as BucketName);
    if (isCollapsed) {
      // Look up the count from the header's displayed number; >0 means
      // collapsed-non-empty, which we should auto-expand and select.
      const header = document.querySelector<HTMLElement>(
        `section[data-bucket="${candidate}"] .bucket-header .bucket-count`
      );
      const count = header ? parseInt(header.textContent ?? "0", 10) || 0 : 0;
      if (count > 0) {
        targetBucket = candidate;
        break;
      }
    } else if (getTaskIdsInBucket(candidate).length > 0) {
      targetBucket = candidate;
      break;
    }
  }

  if (targetBucket === null) return; // no non-empty bucket in that direction

  // Auto-expand if collapsed.
  if (state.collapsedBuckets.has(targetBucket as BucketName)) {
    state.setBucketCollapsed(targetBucket as BucketName, false);
  }

  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    const ids = getTaskIdsInBucket(targetBucket!);
    if (ids.length > 0) {
      useSidebarStore.getState().setSelectedTaskId(ids[0]);
    }
    // If the auto-expanded bucket turns out to be genuinely empty (race),
    // keep the previous selection rather than nulling it.
  }, 50);
}
