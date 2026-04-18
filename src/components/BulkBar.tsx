import { useMemo, useState } from "react";
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

  // R1 MEDIUM (Opus #1 + Gemini BULK-001) — progress state. During a
  // bulk action the count label becomes "N/M done…" and buttons disable
  // so the user sees progress + can't double-submit.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<number>(0);
  const isProcessing = progress !== null;

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
  // /api/tasks/toggle; entity tasks go through /api/tasks/status-edit
  // which queues the delayed reconcile per path.
  async function handleBulkDone() {
    if (isProcessing) return; // guard against double-click (UX-001 variant)
    const entries = selectedEntries;
    const previouslyOpen = entries.filter((e) => !e.task.done);
    if (previouslyOpen.length === 0) {
      clearSelection();
      return;
    }

    // R2 (Gemini G-1) — finally-scoped isProcessing reset so an exception
    // thrown by refreshVault / setPendingUndo / anywhere post-loop doesn't
    // leave the bulk bar permanently disabled for the session.
    try {

    // R1 UX-002 (Gemini) — capture previous status per task so revert
    // restores the EXACT prior state (not just "open"). Closure keeps
    // the snapshot alive until the undo window expires.
    const beforeSnapshot = previouslyOpen.map((e) => ({
      task: e.task,
      tasksPath: e.tasksPath,
      prevStatus: e.task.status ?? "open",
    }));

    const entityPathsQueued: string[] = [];
    setProgress({ done: 0, total: previouslyOpen.length });
    setFailures(0);
    let localFailures = 0;

    for (let i = 0; i < previouslyOpen.length; i++) {
      const { task, tasksPath } = previouslyOpen[i];
      try {
        if (task.source === "inline" && task.line !== undefined) {
          const r = await toggleTaskApi({ tasksPath, line: task.line, done: true });
          if (!r.ok) localFailures++;
        } else if (task.source === "entity" && task.entityPath) {
          const r = await editTaskStatusApi({ entityPath: task.entityPath, status: "done" });
          if (r.ok) {
            entityPathsQueued.push(task.entityPath);
          } else {
            localFailures++;
          }
        }
      } catch {
        localFailures++;
      }
      setProgress({ done: i + 1, total: previouslyOpen.length });
    }
    setFailures(localFailures);

    const successCount = previouslyOpen.length - localFailures;
    const label = localFailures > 0
      ? `${successCount}/${previouslyOpen.length} tasks done (${localFailures} failed)`
      : previouslyOpen.length === 1
      ? "Task done"
      : `${previouslyOpen.length} tasks done`;

    const undo: PendingUndo = {
      action: previouslyOpen.length === 1 ? "done" : "bulk-done",
      taskIds: previouslyOpen.map((e) => e.task.id),
      entityPaths: entityPathsQueued,
      label,
      undoneAt: Date.now(),
      revert: async () => {
        // Cancel pending reconciles first.
        for (const path of entityPathsQueued) {
          await cancelReconcileApi({ entityPath: path });
        }
        // R1 UX-002 — flip back to the EXACT previous status per task.
        for (const snap of beforeSnapshot) {
          const { task, tasksPath, prevStatus } = snap;
          if (task.source === "inline" && task.line !== undefined) {
            await toggleTaskApi({ tasksPath, line: task.line, done: false });
          } else if (task.source === "entity" && task.entityPath) {
            await editTaskStatusApi({ entityPath: task.entityPath, status: prevStatus });
          }
        }
        await refreshVault();
      },
    };

    setPendingUndo(undo);
    await refreshVault();
    clearSelection();
    } finally {
      setProgress(null);
    }
  }

  // Bulk Cancel — transition all selected entity tasks to "cancelled".
  // Inline tasks don't have a cancel concept in the checkbox syntax; we
  // promote them first (same flow as Sprint A B07 for inline→status).
  async function handleBulkCancel() {
    if (isProcessing) return;
    const entries = selectedEntries;
    if (entries.length === 0) return;

    setProgress({ done: 0, total: entries.length });
    setFailures(0);
    let localFailures = 0;

    // R2 — finally-scoped progress reset (matches handleBulkDone).
    try {
    const affected: Array<{ task: Task; tasksPath: string; prevStatus: string }> = [];
    for (let i = 0; i < entries.length; i++) {
      const { task, tasksPath } = entries[i];
      try {
        if (task.source === "inline" && task.line !== undefined) {
          const pr = await promoteTaskApi({ sourcePath: tasksPath, line: task.line });
          if (pr.ok && pr.data.path) {
            const r = await editTaskStatusApi({ entityPath: pr.data.path, status: "cancelled" });
            if (r.ok) affected.push({ task, tasksPath, prevStatus: task.status ?? "open" });
            else localFailures++;
          } else {
            localFailures++;
          }
        } else if (task.source === "entity" && task.entityPath) {
          const r = await editTaskStatusApi({ entityPath: task.entityPath, status: "cancelled" });
          if (r.ok) affected.push({ task, tasksPath, prevStatus: task.status ?? "open" });
          else localFailures++;
        }
      } catch {
        localFailures++;
      }
      setProgress({ done: i + 1, total: entries.length });
    }
    setFailures(localFailures);

    const label = localFailures > 0
      ? `${affected.length}/${entries.length} cancelled (${localFailures} failed)`
      : affected.length === 1
      ? "Task cancelled"
      : `${affected.length} tasks cancelled`;

    setPendingUndo({
      action: "cancel",
      taskIds: affected.map((e) => e.task.id),
      entityPaths: [],
      label,
      undoneAt: Date.now(),
      revert: async () => {
        for (const { task, prevStatus } of affected) {
          if (task.source === "entity" && task.entityPath) {
            await editTaskStatusApi({ entityPath: task.entityPath, status: prevStatus });
          }
          // Post-promote inline→entity: can't revert without the post-
          // promote entityPath, which only the refreshed vault has. User
          // sees the state in the refetch; SSE will propagate.
        }
        await refreshVault();
      },
    });
    await refreshVault();
    clearSelection();
    } finally {
      setProgress(null);
    }
  }

  // Bulk Delete — entity tasks unlinked, inline tasks line-removed.
  // Delete is NOT undoable (we can't restore a deleted file). The toast
  // shows but clicking Undo is a no-op; clicking Clear dismisses it.
  async function handleBulkDelete() {
    if (isProcessing) return;
    const entries = selectedEntries;
    if (entries.length === 0) return;

    setProgress({ done: 0, total: entries.length });
    setFailures(0);
    let deletedCount = 0;
    let localFailures = 0;

    try {
    for (let i = 0; i < entries.length; i++) {
      const { task, tasksPath } = entries[i];
      try {
        if (task.source === "entity" && task.entityPath) {
          const r = await deleteEntityTaskApi({ entityPath: task.entityPath });
          if (r.ok) deletedCount++;
          else localFailures++;
        } else if (task.source === "inline" && task.line !== undefined) {
          const r = await deleteInlineTaskApi({
            tasksPath,
            line: task.line,
            expectedAction: task.action,
          });
          if (r.ok) deletedCount++;
          else localFailures++;
        }
      } catch {
        localFailures++;
      }
      setProgress({ done: i + 1, total: entries.length });
    }
    setFailures(localFailures);

    await refreshVault();
    clearSelection();

    // No undo window for delete — explicit decision. The toast would be
    // misleading (revert would fail silently on the unlinked file).
    // Could surface a separate "deleted N tasks" confirmation banner in
    // a future sprint; for now the refresh is visible enough.
    if (deletedCount > 0) {
      // Flash a non-undoable pending so the user has feedback. UndoToast
      // renders the action==="delete" variant (X dismiss, no fake Undo).
      const label = deletedCount === 1 ? "Task deleted" : `${deletedCount} tasks deleted`;
      setPendingUndo({
        action: "delete",
        taskIds: [],
        entityPaths: [],
        label,
        undoneAt: Date.now(),
        revert: async () => {
          // No-op — delete is terminal. UndoToast hides the Undo button
          // for this variant; this closure never runs.
        },
      });
    }
    } finally {
      setProgress(null);
    }
  }

  const countLabel = isProcessing
    ? `${progress!.done}/${progress!.total} done…`
    : `${selectedEntries.length} selected`;

  return (
    <div className="bulk-bar" role="toolbar" aria-label={`${selectedEntries.length} selected`}>
      <span className="bulk-bar__count" aria-live="polite">
        {countLabel}
        {failures > 0 && !isProcessing && (
          <span className="bulk-bar__failures"> · {failures} failed</span>
        )}
      </span>
      <div className="bulk-bar__actions">
        <button
          type="button"
          className="bulk-bar__btn press-scale"
          onClick={() => void handleBulkDone()}
          disabled={isProcessing}
          title="Mark all done · x"
        >
          <CheckCircle2 size={12} strokeWidth={1.5} aria-hidden="true" />
          <span>Done</span>
        </button>
        <button
          type="button"
          className="bulk-bar__btn press-scale"
          onClick={() => void handleBulkCancel()}
          disabled={isProcessing}
          title="Cancel all · c"
        >
          <X size={12} strokeWidth={1.5} aria-hidden="true" />
          <span>Cancel</span>
        </button>
        <button
          type="button"
          className="bulk-bar__btn bulk-bar__btn--danger press-scale"
          onClick={() => void handleBulkDelete()}
          disabled={isProcessing}
          title="Delete all"
        >
          <Trash2 size={12} strokeWidth={1.5} aria-hidden="true" />
          <span>Delete</span>
        </button>
        <button
          type="button"
          className="bulk-bar__btn bulk-bar__btn--ghost press-scale"
          onClick={clearSelection}
          disabled={isProcessing}
          title="Clear selection · Esc"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
