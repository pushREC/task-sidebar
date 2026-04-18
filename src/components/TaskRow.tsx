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

interface TaskRowProps {
  task: Task;
  isFirst?: boolean;
  tasksPath?: string;
  projects?: Project[];
  indent?: boolean;
}

const ERROR_DOT_DURATION_MS = 2000;

// Map priority rank to a short display label
const RANK_LABEL: Record<string, string> = { high: "H", medium: "M", low: "L" };

export function TaskRow({ task, isFirst, tasksPath, projects, indent }: TaskRowProps) {
  const taskId = task.id.replace(/[^a-zA-Z0-9-_]/g, "_");
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

    const newDone = !task.done;
    optimisticToggle(task.id);

    toggleTaskApi({ tasksPath, line: task.line, done: newDone }).then((result) => {
      if (!result.ok) {
        optimisticToggle(task.id);
        showError();
        console.error("[toggle] failed:", result.error);
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
    const trimmed = editText.trim();
    if (!trimmed || trimmed === task.action) { cancelEditing(); return; }

    editTaskApi({ tasksPath, line: task.line, newText: trimmed }).then((result) => {
      if (!result.ok) {
        console.error("[edit] failed:", result.error);
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

    moveTaskApi({ sourcePath: tasksPath, line: task.line, targetSlug }).then(
      (result) => {
        if (!result.ok) {
          console.error("[move] failed:", result.error);
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

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      setSelectedTaskId(taskId);
      setExpandedTaskId(isExpanded ? null : taskId);
    }
    if (e.key === "Escape" && isExpanded) {
      e.preventDefault();
      setExpandedTaskId(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const rowClasses = [
    "task-row",
    indent ? "task-row--indent" : "",
    hasError ? "task-row--error" : "",
    isSelected ? "task-row--selected" : "",
    isEditing ? "task-row--editing" : "",
    isExpanded ? "task-row--expanded" : "",
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
    >
      <div
        className={rowClasses}
        data-task-row
        data-task-id={taskId}
        {...(isFirst ? { "data-task-first": "" } : {})}
        onClick={handleRowClick}
        onDoubleClick={startEditing}
        onKeyDown={handleRowKeyDown}
        tabIndex={isSelected ? 0 : -1}
        role="button"
        aria-expanded={isExpanded}
      >
        {/* H8 / M21 — button with aria-pressed + aria-label; padding gives ≥24×24 hit region */}
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
          <div className="task-title" title={task.action}>{task.action}</div>
          <div className="task-meta">
            {task.projectTitle && (
              <span className="task-project">{task.projectTitle}</span>
            )}
            {!task.done && task.projectSlug && (
              <span className="task-due">today</span>
            )}
            {task.priority && (
              <span
                className={`task-rank-badge task-rank-badge--${task.priority.rank}`}
                title={`Priority score: ${task.priority.score}`}
              >
                {RANK_LABEL[task.priority.rank] ?? task.priority.rank.charAt(0).toUpperCase()}
              </span>
            )}
            {task.overdue && (
              <span className="task-overdue-chip">overdue</span>
            )}
            {!task.overdue && task.dueToday && (
              <span className="task-due">due today</span>
            )}
            {task.source === "entity" && (
              <span className="task-source-chip">entity</span>
            )}
            {hasError && <span className="task-error-dot" title="Write failed" />}
          </div>
        </div>
      </div>
      {isExpanded && (
        <TaskDetailPanel task={task} tasksPath={tasksPath} />
      )}
    </div>
  );
}
