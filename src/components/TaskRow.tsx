import { useEffect, useRef, useState } from "react";
import { Circle, CheckCircle2, Pencil } from "lucide-react";
import type { Task, Project } from "../api.js";
import {
  toggleTaskApi,
  editTaskApi,
  moveTaskApi,
  editTaskFieldApi,
  promoteAndEditTaskApi,
} from "../api.js";
import { useSidebarStore } from "../store.js";
import { TaskDetailPanel } from "./TaskDetailPanel.js";
import { relativeDue, parseISODate, diffDays } from "../lib/format.js";
import { DuePopover } from "./DuePopover.js";
import { PriorityPopover } from "./PriorityPopover.js";

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

// Sprint C D19/V2B — rank → P1/P2/P3/P4 pill mapping.
const RANK_PILL_LABEL: Record<string, string> = {
  critical: "P1",
  high: "P2",
  medium: "P3",
  low: "P4",
};
const RANK_PILL_VARIANT: Record<string, string> = {
  critical: "p1",
  high: "p2",
  medium: "p3",
  low: "p4",
};

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

  // Sprint C — popover state + anchor refs for due / priority / pencil.
  const [openPopover, setOpenPopover] = useState<"due" | "priority" | null>(null);
  const dueBtnRef = useRef<HTMLButtonElement | null>(null);
  const priorityBtnRef = useRef<HTMLButtonElement | null>(null);

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

  // ── Sprint C: inline field edit (due / impact / urgency) ─────────────────
  //
  // Inline task → first edit promotes to entity via promote-and-edit, then
  //               any follow-up edits use editTaskFieldApi against the new
  //               entityPath returned.
  // Entity task → editTaskFieldApi against task.entityPath.
  //
  // Round-1 convergence:
  //   - C1-1 — on mid-chain failure of a multi-field write, best-effort
  //     ROLLBACK the first (previous-value) so the task doesn't settle
  //     into a half-updated state. "Best-effort" because the rollback
  //     itself could fail — if so, error-dot fires and user can retry.
  //   - C1-3 — in-flight guard (`applyingRef`) prevents a rapid second
  //     click from re-entering promote-and-edit against the stale
  //     `source === "inline"` prop before SSE has refreshed it.
  const applyingRef = useRef(false);
  async function applyFieldEdits(
    edits: Array<{ field: string; value: string | number | null; rollbackValue: string | number | null }>
  ): Promise<void> {
    if (edits.length === 0) return;
    if (applyingRef.current) return; // C1-3 drop rapid re-entry
    applyingRef.current = true;
    try {
      clearTaskError(task.id);

      // Inline → promote-and-edit for the FIRST field, capture new entityPath
      if (task.source === "inline") {
        if (!tasksPath || task.line === undefined) return;
        const first = edits[0];
        const r = await promoteAndEditTaskApi({
          tasksPath,
          line: task.line,
          field: first.field,
          value: first.value,
        });
        if (!r.ok) {
          showError();
          return;
        }
        const newEntityPath = r.data.entityPath;
        if (!newEntityPath) return;
        // Remaining edits go to the new entity path.
        for (let i = 1; i < edits.length; i++) {
          const e = edits[i];
          const r2 = await editTaskFieldApi({ entityPath: newEntityPath, field: e.field, value: e.value });
          if (!r2.ok) {
            // C1-1 — best-effort rollback of the already-committed field.
            await editTaskFieldApi({
              entityPath: newEntityPath,
              field: edits[0].field,
              value: edits[0].rollbackValue,
            });
            showError();
            return;
          }
        }
        return;
      }

      // Entity path: sequential field-edit calls with rollback of prior
      // commits on any mid-chain failure.
      const entityPath = task.entityPath;
      if (!entityPath) return;
      const committed: Array<{ field: string; rollbackValue: string | number | null }> = [];
      for (const e of edits) {
        const r = await editTaskFieldApi({ entityPath, field: e.field, value: e.value });
        if (!r.ok) {
          // C1-1 — roll back previously-committed fields in reverse order.
          for (let i = committed.length - 1; i >= 0; i--) {
            const c = committed[i];
            await editTaskFieldApi({ entityPath, field: c.field, value: c.rollbackValue });
          }
          showError();
          return;
        }
        committed.push({ field: e.field, rollbackValue: e.rollbackValue });
      }
    } finally {
      applyingRef.current = false;
    }
  }

  function handleDuePick(iso: string | null) {
    void applyFieldEdits([{ field: "due", value: iso, rollbackValue: task.due ?? null }]);
  }
  function handlePriorityPick(impact: string | null, urgency: string | null) {
    void applyFieldEdits([
      { field: "impact",  value: impact,  rollbackValue: task.impact ?? null  },
      { field: "urgency", value: urgency, rollbackValue: task.urgency ?? null },
    ]);
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

  // Note: Enter for row expand handled globally in useKeyboardNav — it
  // calls `onEnterExpand` on the selected row directly (not a dispatched
  // click). No onKeyDown here because the row is a semantic listitem,
  // not a focusable ARIA control (see B04 comment in JSX).

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
  // C-R2 — suppress the accent classes on done tasks so strikethrough +
  // muted opacity don't fight a red "overdue" coloring. Done wins visually.
  let isOverdueLocal = false;
  let isDueTodayLocal = false;
  if (task.due && !isDone) {
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
    // Round-3: `aria-current="true"` announces the j/k visual selection to
    // assistive tech (Gemini M-2). We dropped the agenda-row-{id} attribute
    // that was only used by the removed aria-activedescendant pattern
    // (Opus M2). `role="listitem"` is the semantic row.
    <div
      className={`task-row-wrapper${isExpanded ? " task-row-wrapper--expanded" : ""}${isSelected ? " task-row-wrapper--selected" : ""}`}
      data-task-wrapper
      role="listitem"
      aria-current={isSelected ? "true" : undefined}
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
            {/* Sprint C F04 — due chip is a button opening DuePopover.
                Renders even when unset so users can quickly assign a date;
                the "—" label + hover border cue affordance. */}
            <button
              ref={dueBtnRef}
              type="button"
              className={`task-due${isOverdueLocal ? " task-due--overdue" : isDueTodayLocal ? " task-due--today" : ""}`}
              title={task.due ?? "Set due date"}
              aria-label={task.due ? `Due ${task.due}` : "Set due date"}
              aria-haspopup="menu"
              aria-expanded={openPopover === "due"}
              onClick={(e) => {
                e.stopPropagation();
                setOpenPopover((p) => (p === "due" ? null : "due"));
              }}
            >
              {task.due ? relativeDue(task.due, nowStamp) : "—"}
            </button>
            {/* Sprint C F05 + D19/V2B — priority pill is a button opening
                PriorityPopover. Rank-to-Pn mapping:
                  critical→P1, high→P2, medium→P3, low→P4, null→none */}
            <button
              ref={priorityBtnRef}
              type="button"
              className={`priority-pill priority-pill--${task.priority ? RANK_PILL_VARIANT[task.priority.rank] ?? "p4" : "none"}`}
              title={task.priority ? `Priority score: ${task.priority.score}` : "Set priority"}
              aria-label={task.priority ? `Priority ${RANK_PILL_LABEL[task.priority.rank] ?? "?"}` : "Set priority"}
              aria-haspopup="menu"
              aria-expanded={openPopover === "priority"}
              onClick={(e) => {
                e.stopPropagation();
                setOpenPopover((p) => (p === "priority" ? null : "priority"));
              }}
            >
              {task.priority ? RANK_PILL_LABEL[task.priority.rank] ?? "?" : ""}
            </button>
            {hasError && (
              <>
                <span className="task-error-dot" title="Write failed" aria-hidden="true" />
                {/* M-5 — screen-reader announcement for the write failure.
                    Round-2 M-4 — `aria-live="polite"` (not role=alert) so
                    cascading failures don't storm AT users with assertive
                    interruptions. Polite still queues each announcement. */}
                <span aria-live="polite" className="sr-only">Write failed.</span>
              </>
            )}
            {/* Sprint C F10 — pencil on hover/selected. Keyboard `E` also
                triggers edit via useKeyboardNav → onEnterEdit. The icon
                is visually hidden by default (opacity 0) and only becomes
                focusable on hover, so Tab order is uncluttered. */}
            <button
              type="button"
              className="task-edit-affordance"
              aria-label="Edit task text"
              tabIndex={isSelected ? 0 : -1}
              onClick={(e) => {
                e.stopPropagation();
                startEditing();
              }}
            >
              <Pencil size={12} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>
      {/* Sprint C F04/F05 — popovers render outside the row surface so
          they can spill below the row without clipping the row layout. */}
      {openPopover === "due" && (
        <DuePopover
          anchorRef={dueBtnRef}
          currentDue={task.due}
          onClose={() => setOpenPopover(null)}
          onPick={handleDuePick}
        />
      )}
      {openPopover === "priority" && (
        <PriorityPopover
          anchorRef={priorityBtnRef}
          currentRank={task.priority?.rank ?? null}
          onClose={() => setOpenPopover(null)}
          onPick={handlePriorityPick}
        />
      )}
      {isExpanded && (
        <TaskDetailPanel task={task} tasksPath={tasksPath} />
      )}
    </div>
  );
}
