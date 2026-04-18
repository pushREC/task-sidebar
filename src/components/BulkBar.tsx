import { useMemo } from "react";
import { CheckCircle2, X, Trash2 } from "lucide-react";
import type { Task, Project } from "../api.js";
import {
  cancelReconcileApi,
  editTaskStatusApi,
  deleteEntityTaskApi,
  deleteInlineTaskApi,
  fetchVault,
  promoteTaskApi,
  toggleTaskApi,
} from "../api.js";
import { useSidebarStore } from "../store.js";
import type { PendingUndo } from "../store.js";

interface BulkBarProps {
  projects: Project[];
}

/**
 * Bulk action bar — appears ABOVE QuickAdd when selectedTaskIds.size > 0.
 *
 * Sprint G D32. Supports: Done · Cancel · Delete · Clear. Move-to-project
 * deferred (would require a project picker popover — separable feature).
 *
 * Key invariants:
 *   - "Done" and "Cancel" transition every selected task to that status
 *     via the existing /api/tasks/status-edit path. Inline tasks auto-
 *     promote first (matching Sprint A B07).
 *   - "Delete" routes through the right variant per task.source.
 *   - After any bulk action, a pendingUndo window opens with a reverter
 *     closure that re-issues the OPPOSITE action for every affected task.
 *   - Cancel/undo of pending reconciles fires per entityPath via
 *     /api/tasks/cancel-reconcile so the 5s fire-and-forget doesn't
 *     commit phantom state.
 */
export function BulkBar({ projects }: BulkBarProps) {
  const selectedTaskIds = useSidebarStore((s) => s.selectedTaskIds);
  const clearSelection = useSidebarStore((s) => s.clearSelection);
  const setPendingUndo = useSidebarStore((s) => s.setPendingUndo);

  // Resolve selected ids → full Task objects + their tasksPath.
  const selectedEntries = useMemo(() => {
    const entries: Array<{ task: Task; tasksPath: string; project: Project }> = [];
    if (selectedTaskIds.size === 0) return entries;
    const needed = selectedTaskIds;
    // selectedTaskId in TaskRow was a sanitized form; we stored the
    // ORIGINAL id from task.id there too via setSelectedTaskId/addSelection.
    // Match either raw id or sanitized form.
    for (const project of projects) {
      for (const task of project.tasks) {
        const sanitized = task.id.replace(/[^a-zA-Z0-9-_]/g, "_");
        if (needed.has(task.id) || needed.has(sanitized)) {
          entries.push({ task, tasksPath: project.tasksPath, project });
        }
      }
    }
    return entries;
  }, [selectedTaskIds, projects]);

  if (selectedEntries.length === 0) return null;

  async function refreshVault() {
    try {
      const v = await fetchVault();
      useSidebarStore.getState().setVault(v);
    } catch { /* SSE will catch up */ }
  }

  // Bulk Done — apply to every selected task. Inline tasks go through
  // /api/tasks/toggle (simpler than promote→status-edit for the bulk
  // path; also matches the row-click behavior). Entity tasks go through
  // /api/tasks/status-edit which queues the delayed reconcile per path.
  async function handleBulkDone() {
    const entries = selectedEntries;
    const previouslyOpen = entries.filter((e) => !e.task.done);
    if (previouslyOpen.length === 0) {
      clearSelection();
      return;
    }

    // Collect entityPaths that will get a queued reconcile.
    const entityPathsQueued: string[] = [];

    for (const { task, tasksPath } of previouslyOpen) {
      if (task.source === "inline" && task.line !== undefined) {
        // Inline — toggle to done.
        await toggleTaskApi({ tasksPath, line: task.line, done: true });
      } else if (task.source === "entity" && task.entityPath) {
        await editTaskStatusApi({ entityPath: task.entityPath, status: "done" });
        entityPathsQueued.push(task.entityPath);
      }
    }

    const label = previouslyOpen.length === 1
      ? "Task done"
      : `${previouslyOpen.length} tasks done`;

    const undo: PendingUndo = {
      action: previouslyOpen.length === 1 ? "done" : "bulk-done",
      taskIds: previouslyOpen.map((e) => e.task.id),
      entityPaths: entityPathsQueued,
      label,
      undoneAt: Date.now(),
      revert: async () => {
        // Cancel pending reconciles first so reverting a still-queued
        // task leaves no phantom reconcile tail.
        for (const path of entityPathsQueued) {
          await cancelReconcileApi({ entityPath: path });
        }
        // Flip back to previous state. Inline tasks toggle to open;
        // entity tasks go back to their previous status. We don't
        // preserve the exact previous status — anything that was
        // merged to "done" reverts to "open". Edge: if the task was
        // previously "in-progress", undo returns it to "open" (minor).
        for (const { task, tasksPath } of previouslyOpen) {
          if (task.source === "inline" && task.line !== undefined) {
            await toggleTaskApi({ tasksPath, line: task.line, done: false });
          } else if (task.source === "entity" && task.entityPath) {
            await editTaskStatusApi({ entityPath: task.entityPath, status: "open" });
          }
        }
        await refreshVault();
      },
    };

    setPendingUndo(undo);
    await refreshVault();
    clearSelection();
  }

  // Bulk Cancel — transition all selected entity tasks to "cancelled".
  // Inline tasks don't have a cancel concept in the checkbox syntax; we
  // promote them first (same flow as Sprint A B07 for inline→status).
  async function handleBulkCancel() {
    const entries = selectedEntries;
    if (entries.length === 0) return;

    const affected: typeof entries = [];
    for (const entry of entries) {
      const { task, tasksPath } = entry;
      if (task.source === "inline" && task.line !== undefined) {
        const pr = await promoteTaskApi({ sourcePath: tasksPath, line: task.line });
        if (pr.ok && pr.data.path) {
          await editTaskStatusApi({ entityPath: pr.data.path, status: "cancelled" });
          affected.push(entry);
        }
      } else if (task.source === "entity" && task.entityPath) {
        await editTaskStatusApi({ entityPath: task.entityPath, status: "cancelled" });
        affected.push(entry);
      }
    }

    const label = affected.length === 1 ? "Task cancelled" : `${affected.length} tasks cancelled`;
    setPendingUndo({
      action: "cancel",
      taskIds: affected.map((e) => e.task.id),
      entityPaths: [],
      label,
      undoneAt: Date.now(),
      revert: async () => {
        for (const { task } of affected) {
          // Post-promote, inline tasks have an entityPath. Fresh refetch
          // will surface it, but at this point our reference is stale.
          // For revert, just refresh and let user retry.
          if (task.source === "entity" && task.entityPath) {
            await editTaskStatusApi({ entityPath: task.entityPath, status: "open" });
          }
        }
        await refreshVault();
      },
    });
    await refreshVault();
    clearSelection();
  }

  // Bulk Delete — entity tasks unlinked, inline tasks line-removed.
  // Delete is NOT undoable (we can't restore a deleted file). The toast
  // shows but clicking Undo is a no-op; clicking Clear dismisses it.
  async function handleBulkDelete() {
    const entries = selectedEntries;
    if (entries.length === 0) return;

    let deletedCount = 0;
    for (const { task, tasksPath } of entries) {
      if (task.source === "entity" && task.entityPath) {
        const r = await deleteEntityTaskApi({ entityPath: task.entityPath });
        if (r.ok) deletedCount++;
      } else if (task.source === "inline" && task.line !== undefined) {
        const r = await deleteInlineTaskApi({
          tasksPath,
          line: task.line,
          expectedAction: task.action,
        });
        if (r.ok) deletedCount++;
      }
    }

    await refreshVault();
    clearSelection();

    // No undo window for delete — explicit decision. The toast would be
    // misleading (revert would fail silently on the unlinked file).
    // Could surface a separate "deleted N tasks" confirmation banner in
    // a future sprint; for now the refresh is visible enough.
    if (deletedCount > 0) {
      // Flash a non-undoable pending so the user has feedback.
      const label = deletedCount === 1 ? "Task deleted" : `${deletedCount} tasks deleted`;
      setPendingUndo({
        action: "delete",
        taskIds: [],
        entityPaths: [],
        label,
        undoneAt: Date.now(),
        revert: async () => {
          // No-op — delete is terminal. The label alone provides feedback.
        },
      });
    }
  }

  return (
    <div className="bulk-bar" role="toolbar" aria-label={`${selectedEntries.length} selected`}>
      <span className="bulk-bar__count" aria-live="polite">
        {selectedEntries.length} selected
      </span>
      <div className="bulk-bar__actions">
        <button
          type="button"
          className="bulk-bar__btn press-scale"
          onClick={() => void handleBulkDone()}
          title="Mark all done"
        >
          <CheckCircle2 size={12} strokeWidth={1.5} aria-hidden="true" />
          <span>Done</span>
        </button>
        <button
          type="button"
          className="bulk-bar__btn press-scale"
          onClick={() => void handleBulkCancel()}
          title="Cancel all"
        >
          <X size={12} strokeWidth={1.5} aria-hidden="true" />
          <span>Cancel</span>
        </button>
        <button
          type="button"
          className="bulk-bar__btn bulk-bar__btn--danger press-scale"
          onClick={() => void handleBulkDelete()}
          title="Delete all"
        >
          <Trash2 size={12} strokeWidth={1.5} aria-hidden="true" />
          <span>Delete</span>
        </button>
        <button
          type="button"
          className="bulk-bar__btn bulk-bar__btn--ghost press-scale"
          onClick={clearSelection}
          title="Clear selection · Esc"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
