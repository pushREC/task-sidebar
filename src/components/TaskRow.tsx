import { useEffect, useRef, useState } from "react";
import { Circle, CheckCircle2 } from "lucide-react";
import type { Task, Project } from "../api.js";
import {
  toggleTaskApi,
  editTaskApi,
  moveTaskApi,
} from "../api.js";
import { useSidebarStore } from "../store.js";
import { TaskDetailPanel } from "./TaskDetailPanel.js";
import { relativeDue, parseISODate, diffDays } from "../lib/format.js";

interface TaskRowProps {
  task: Task;
  isFirst?: boolean;
  tasksPath?: string;
  projects?: Project[];
  indent?: boolean;
  /**
   * O-1 — shared "now" from the parent (AgendaView). Falls back to
   * `new Date()` when rendered outside a bucketed context (e.g. the
   * Projects view) so the parent ProjectsView doesn't have to plumb it.
   */
  now?: Date;
}

const ERROR_DOT_DURATION_MS = 2000;

// Map priority rank to a short display label
const RANK_LABEL: Record<string, string> = { high: "H", medium: "M", low: "L" };

export function TaskRow({ task, isFirst, tasksPath, projects, indent, now }: TaskRowProps) {
  const taskId = task.id.replace(/[^a-zA-Z0-9-_]/g, "_");
  const nowStamp = now ?? new Date();
  const optimisticToggle = useSidebarStore((s) => s.optimisticToggle);
  const markTaskError = useSidebarStore((s) => s.markTaskError);
  const clearTaskError = useSidebarStore((s) => s.clearTaskError);
  const errorTaskIds = useSidebarStore((s) => s.errorTaskIds);
  const selectedTaskId = useSidebarStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useSidebarStore((s) => s.setSelectedTaskId);
  const expandedTaskId = useSidebarStore((s) => s.expandedTaskId);
  const setExpandedTaskId = useSidebarStore((s) => s.setExpandedTaskId);

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(task.action);
  const [moveSlug, setMoveSlug] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasError = errorTaskIds.has(task.id);
  const isSelected = selectedTaskId === taskId;
  const isExpanded = expandedTaskId === taskId;

  // M16 — clear pending error timer on unmount to avoid setState on unmounted component
  useEffect(() => {
    return () => {
      if (errorTimerRef.current !== null) clearTimeout(errorTimerRef.current);
    };
  }, []);

  // ── Toggle ────────────────────────────────────────────────────────────────

  function handleToggleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!tasksPath) return;
    // B11 — entity tasks lack `line`; their toggle goes through status-edit,
    // not the inline-line toggle endpoint. Fail closed until Sprint E wires
    // a toggle→status-edit path for entities.
    if (task.line === undefined) return;
    const taskLine = task.line;

    const newDone = !task.done;
    optimisticToggle(task.id);

    toggleTaskApi({ tasksPath, line: taskLine, done: newDone }).then((result) => {
      if (!result.ok) {
        optimisticToggle(task.id);
        showError();
      }
    });
  }

  function showError() {
    markTaskError(task.id);
    if (errorTimerRef.current !== null) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => {
      clearTaskError(task.id);
      errorTimerRef.current = null;
    }, ERROR_DOT_DURATION_MS);
  }

  // ── Inline edit ───────────────────────────────────────────────────────────

  function startEditing() {
    setEditText(task.action);
    setMoveSlug("");
    setIsEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function cancelEditing() {
    setIsEditing(false);
    setEditText(task.action);
    setMoveSlug("");
  }

  function commitEdit() {
    if (!tasksPath) { cancelEditing(); return; }
    if (task.line === undefined) { cancelEditing(); return; }
    const taskLine = task.line;
    const trimmed = editText.trim();
    if (!trimmed || trimmed === task.action) { cancelEditing(); return; }

    editTaskApi({ tasksPath, line: taskLine, newText: trimmed }).then((result) => {
      if (!result.ok) {
        showError();
      }
    });
    setIsEditing(false);
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
    if (e.key === "Escape") { e.preventDefault(); cancelEditing(); }
  }

  // ── Move ──────────────────────────────────────────────────────────────────

  function handleMoveChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const targetSlug = e.target.value;
    if (!targetSlug || !tasksPath) return;
    if (task.line === undefined) return;
    const taskLine = task.line;

    moveTaskApi({ sourcePath: tasksPath, line: taskLine, targetSlug }).then(
      (result) => {
        if (!result.ok) {
          showError();
        }
      }
    );
    setIsEditing(false);
    setMoveSlug("");
  }

  // ── Expand toggle ─────────────────────────────────────────────────────────

  function handleRowClick() {
    setSelectedTaskId(taskId);
    // Toggle inline-expand detail panel
    setExpandedTaskId(isExpanded ? null : taskId);
  }

  // Note: Enter/Escape for row expand handled globally in useKeyboardNav
  // via dispatched click events. No onKeyDown here so the row is NOT a
  // focusable interactive ARIA control (see B04 comment in JSX).

  // ── Render ────────────────────────────────────────────────────────────────

  // Sprint B state flags — V1A in-progress stripe, blocked, done strikethrough.
  const isInProgress = task.status === "in-progress";
  const isBlocked = task.status === "blocked";
  const isDone = task.done || task.status === "done";

  // C-4 — derive due-chip styling from the SAME local time reference used
  // for bucketing. The server also emits `task.overdue`/`task.dueToday`,
  // but those can disagree with local timezone near UTC boundaries. Trust
  // our local calculation here for visual consistency with the Agenda
  // bucket assignment.
  let isOverdueLocal = false;
  let isDueTodayLocal = false;
  if (task.due) {
    const dueDate = parseISODate(task.due);
    if (dueDate) {
      const d = diffDays(nowStamp, dueDate);
      if (d < 0) isOverdueLocal = true;
      else if (d === 0) isDueTodayLocal = true;
    }
  }

  const rowClasses = [
    "task-row",
    indent ? "task-row--indent" : "",
    hasError ? "task-row--error" : "",
    isSelected ? "task-row--selected" : "",
    isEditing ? "task-row--editing" : "",
    isExpanded ? "task-row--expanded" : "",
    isInProgress ? "task-row--in-progress" : "",
    isBlocked ? "task-row--blocked" : "",
    isDone ? "task-row--done" : "",
  ].filter(Boolean).join(" ");

  if (isEditing) {
    return (
      <div
        className={rowClasses}
        data-task-row
        data-task-id={taskId}
        {...(isFirst ? { "data-task-first": "" } : {})}
      >
        {/* H8 — task-circle is a <button> in editing mode too */}
        <button
          type="button"
          className={`task-circle${task.done ? " done" : ""}`}
          onClick={handleToggleClick}
          aria-pressed={task.done}
          aria-label={task.done ? "Mark open" : "Mark done"}
        >
          {task.done
            ? <CheckCircle2 size={16} strokeWidth={1.5} />
            : <Circle size={16} strokeWidth={1.5} />}
        </button>
        <div className="task-content">
          <input
            ref={inputRef}
            className="task-edit-input"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={commitEdit}
            autoFocus
            maxLength={500}
            aria-label="Edit task text"
          />
          {projects && projects.length > 1 && (
            <select
              className="task-move-select"
              value={moveSlug}
              onChange={handleMoveChange}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Move task to project"
            >
              <option value="">Move to...</option>
              {projects
                .filter((p) => {
                  const currentSlug = tasksPath?.split("/").slice(-2, -1)[0];
                  return p.slug !== currentSlug;
                })
                .map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.title}
                  </option>
                ))}
            </select>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`task-row-wrapper${isExpanded ? " task-row-wrapper--expanded" : ""}`}
      data-task-wrapper
      role="option"
      aria-selected={isSelected}
      id={`agenda-row-${taskId}`}
    >
      <div
        className={rowClasses}
        data-task-row
        data-task-id={taskId}
        {...(isFirst ? { "data-task-first": "" } : {})}
        onClick={handleRowClick}
        onDoubleClick={startEditing}
      >
        {/* B04 — circle is the only interactive control inside the row; the row
            itself is a clickable region (no role="button") so we avoid
            button-in-button ARIA nesting. Keyboard expand goes through
            useKeyboardNav → Enter → dispatch click on the row. */}
        <button
          type="button"
          className={`task-circle${task.done ? " done" : ""}`}
          onClick={handleToggleClick}
          aria-pressed={task.done}
          aria-label={task.done ? "Mark open" : "Mark done"}
        >
          {task.done
            ? <CheckCircle2 size={16} strokeWidth={1.5} />
            : <Circle size={16} strokeWidth={1.5} />}
        </button>
        <div className="task-content">
          {/* H12 — title attribute shows full text on truncation */}
          <div className="task-title" title={task.action}>
            {task.action}
            {isBlocked && (
              <span className="task-blocked-glyph" aria-label="Blocked" title="Blocked">
                {" \u29D6"}
              </span>
            )}
          </div>
          <div className="task-meta">
            {task.projectTitle && (
              <span className="task-project">{task.projectTitle}</span>
            )}
            {task.due && (
              <span
                className={`task-due${isOverdueLocal ? " task-due--overdue" : isDueTodayLocal ? " task-due--today" : ""}`}
                title={task.due}
              >
                {relativeDue(task.due, nowStamp)}
              </span>
            )}
            {task.priority && (
              <span
                className={`task-rank-badge task-rank-badge--${task.priority.rank}`}
                title={`Priority score: ${task.priority.score}`}
              >
                {RANK_LABEL[task.priority.rank] ?? task.priority.rank.charAt(0).toUpperCase()}
              </span>
            )}
            {hasError && (
              <>
                <span className="task-error-dot" title="Write failed" aria-hidden="true" />
                {/* M-5 — screen-reader announcement for the write failure */}
                <span role="alert" className="sr-only">Write failed.</span>
              </>
            )}
          </div>
        </div>
      </div>
      {isExpanded && (
        <TaskDetailPanel task={task} tasksPath={tasksPath} />
      )}
    </div>
  );
}
