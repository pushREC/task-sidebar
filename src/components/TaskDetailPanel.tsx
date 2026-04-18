import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { Task } from "../api.js";
import {
  deleteEntityTaskApi,
  deleteInlineTaskApi,
  editTaskBodyApi,
  editTaskFieldApi,
  editTaskStatusApi,
  fetchVault,
  promoteAndEditTaskApi,
  promoteTaskApi,
} from "../api.js";
import { useSidebarStore } from "../store.js";
import { ConfirmModal } from "./ConfirmModal.js";
import { relativeAge } from "../lib/format.js";

interface TaskDetailPanelProps {
  task: Task;
  tasksPath?: string;
  /**
   * Sprint E V4B — the parent project's `parent-goal` wikilink, passed in
   * by the rendering row so the breadcrumb can show the goal without the
   * detail panel needing a store selector for it.
   */
  projectGoal?: string;
  /** Sprint E V4B — the project's own wikilink for the breadcrumb chip. */
  projectWikilink?: string;
}

const STATUS_OPTIONS = ["backlog", "open", "in-progress", "blocked", "done", "cancelled"] as const;
const OWNER_OPTIONS = ["human", "agent", "either"] as const;
const ENERGY_OPTIONS = ["low", "medium", "high"] as const;
const IMPACT_URGENCY_OPTIONS = ["very-high", "high", "medium", "low", "very-low"] as const;

type SaveState = "idle" | "saving" | "error";

// ─── Wikilink chip helpers ────────────────────────────────────────────────────

function extractWikilinkLabel(raw: string): string {
  const inner = raw.replace(/^\[\[/, "").replace(/\]\]$/, "");
  const segments = inner.split("/");
  const last = segments[segments.length - 1];
  const lastLower = last.toLowerCase();

  let slug: string;
  if (lastLower === "readme" || lastLower === "readme.md") {
    slug = segments[segments.length - 2] ?? last;
  } else if (last.toUpperCase().endsWith("-README")) {
    slug = last.slice(0, -"-README".length);
  } else {
    slug = last;
  }

  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function WikilinkChip({ raw }: { raw: string }) {
  const label = extractWikilinkLabel(raw);
  return (
    <span
      className="wikilink-chip"
      title={raw}
      aria-label={`Wikilink: ${label}`}
      data-wikilink={raw}
    >
      {label}
    </span>
  );
}

// ─── Priority + due chips ─────────────────────────────────────────────────────

function RankChip({ rank }: { rank: string }) {
  const letter = rank.charAt(0).toUpperCase();
  return (
    <span className={`rank-chip rank-chip--${rank}`} aria-label={`Priority rank: ${rank}`}>
      {letter}
    </span>
  );
}

function DueChip({ due, dueToday, overdue }: { due: string; dueToday?: boolean; overdue?: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  let label: string;
  let accentClass = "";

  if (overdue) {
    const diffMs = Date.now() - new Date(due).getTime();
    const diffDays = Math.round(diffMs / 86_400_000);
    label = `overdue ${diffDays}d`;
    accentClass = "due-chip--overdue";
  } else if (dueToday || due === today) {
    label = "today";
    accentClass = "due-chip--today";
  } else {
    const diffMs = new Date(due).getTime() - Date.now();
    const diffDays = Math.round(diffMs / 86_400_000);
    label = `in ${diffDays}d`;
  }

  return (
    <span className={`due-chip ${accentClass}`} aria-label={`Due: ${label}`}>
      {label}
    </span>
  );
}

// ─── Row layout ───────────────────────────────────────────────────────────────
//
// Gemini Sprint-C DETAIL-PANEL-KEYBOARD-INACCESSIBLE — PropertyRow is a
// <button> when clickable, a <div> when read-only. Keyboard users can now
// Tab to any editable row and hit Enter/Space to enter edit mode, matching
// click affordance. Sr-only "Activate to edit" suffix on the a11y label.
//
// Non-clickable rows stay <div> because wrapping read-only content in a
// button generates noise for screen readers and fake focus targets.

interface PropertyRowProps {
  label: string;
  children: React.ReactNode;
  editing?: boolean;
  onClick?: () => void;
  readOnly?: boolean;
}

function PropertyRow({ label, children, editing, onClick, readOnly }: PropertyRowProps) {
  const clickable = onClick && !readOnly;
  const className = `prop-row${editing ? " prop-row--editing" : ""}${clickable ? " prop-row--clickable" : ""}`;

  // R1 NESTED-INTERACTIVE — when editing=true, children render a live
  // <select> / <input> / <textarea>. Nesting those inside a <button>
  // violates WHATWG (button content must be phrasing, not interactive)
  // and causes AT focus weirdness. Render as <div> during edit mode.
  // Activation still works via click (container click bubbling) + Tab
  // reaches the inner control directly.
  if (clickable && !editing) {
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        aria-label={`${label}. Activate to edit.`}
      >
        <span className="prop-label" aria-hidden="true">{label}</span>
        <span className="prop-value">{children}</span>
      </button>
    );
  }
  return (
    <div className={className}>
      <span className="prop-label">{label}</span>
      <span className="prop-value">{children}</span>
    </div>
  );
}

// ─── Click-to-edit field components ──────────────────────────────────────────

interface EditableSelectProps {
  label: string;
  value: string | undefined;
  options: readonly string[];
  placeholder?: string;
  readOnly?: boolean;
  onSave: (value: string) => void;
}

function EditableSelect({ label, value, options, placeholder, readOnly, onSave }: EditableSelectProps) {
  const [editing, setEditing] = useState(false);
  const selectRef = useRef<HTMLSelectElement | null>(null);

  function handleRowClick() {
    if (!readOnly) setEditing(true);
  }

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (e.target.value) {
      onSave(e.target.value);
    }
    setEditing(false);
  }

  function handleBlur() {
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setEditing(false);
    }
  }

  // When entering edit mode, focus the native select so keyboard users land
  // on the actual control (not the outer button, which loses focus on state
  // change).
  useEffect(() => {
    if (editing) selectRef.current?.focus();
  }, [editing]);

  return (
    <PropertyRow label={label} editing={editing} onClick={handleRowClick} readOnly={readOnly}>
      {editing ? (
        <select
          ref={selectRef}
          className="prop-input prop-select"
          value={value ?? ""}
          aria-label={label}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        >
          {!value && <option value="">—</option>}
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : value ? (
        <span className="prop-text">{value}</span>
      ) : (
        <span className="prop-placeholder">+ set {placeholder ?? label}</span>
      )}
    </PropertyRow>
  );
}

interface EditableTextProps {
  label: string;
  value: string | undefined;
  placeholder?: string;
  readOnly?: boolean;
  multiline?: boolean;
  onSave: (value: string) => void;
}

function EditableText({ label, value, placeholder, readOnly, multiline, onSave }: EditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  function handleRowClick() {
    if (!readOnly) {
      setDraft(value ?? "");
      setEditing(true);
    }
  }

  function commitIfChanged() {
    const trimmed = draft.trim();
    if (trimmed !== (value ?? "") && trimmed.length > 0) {
      onSave(trimmed);
    }
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!multiline && e.key === "Enter") {
      e.preventDefault();
      commitIfChanged();
    }
    if (e.key === "Escape") {
      setDraft(value ?? "");
      setEditing(false);
    }
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  return (
    <PropertyRow label={label} editing={editing} onClick={handleRowClick} readOnly={readOnly}>
      {editing ? (
        multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            className="prop-input prop-textarea"
            value={draft}
            aria-label={label}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitIfChanged}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            className="prop-input"
            value={draft}
            aria-label={label}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitIfChanged}
            onKeyDown={handleKeyDown}
          />
        )
      ) : value ? (
        <span className="prop-text">{value}</span>
      ) : (
        <span className="prop-placeholder">+ set {placeholder ?? label}</span>
      )}
    </PropertyRow>
  );
}

interface EditableTextAreaProps {
  label: string;
  value: string | undefined;
  placeholder?: string;
  readOnly?: boolean;
  rows?: number;
  onSave: (value: string) => void;
}

function EditableTextArea({ label, value, placeholder, readOnly, rows = 4, onSave }: EditableTextAreaProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function handleRowClick() {
    if (!readOnly) {
      setDraft(value ?? "");
      setEditing(true);
    }
  }

  // Notes commit: allow empty-string (clearing notes is a valid action).
  // Compared against `value ?? ""` to avoid spurious writes when the user
  // opens the row and tabs away without typing.
  function commitIfChanged() {
    const trimmed = draft.replace(/\s+$/g, "");
    const current = value ?? "";
    if (trimmed !== current) {
      onSave(trimmed);
    }
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setDraft(value ?? "");
      setEditing(false);
    }
    // ⌘Enter / Ctrl+Enter commits and closes — multi-line Enter inserts
    // a newline (native textarea behavior).
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      commitIfChanged();
    }
  }

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  return (
    <PropertyRow label={label} editing={editing} onClick={handleRowClick} readOnly={readOnly}>
      {editing ? (
        <textarea
          ref={textareaRef}
          className="prop-input prop-textarea prop-textarea--notes"
          value={draft}
          aria-label={label}
          rows={rows}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitIfChanged}
          onKeyDown={handleKeyDown}
        />
      ) : value ? (
        <span className="prop-text prop-text--multiline">{value}</span>
      ) : (
        <span className="prop-placeholder">+ set {placeholder ?? label}</span>
      )}
    </PropertyRow>
  );
}

interface EditableDateProps {
  label: string;
  value: string | undefined;
  placeholder?: string;
  readOnly?: boolean;
  onSave: (value: string) => void;
}

function EditableDate({ label, value, placeholder, readOnly, onSave }: EditableDateProps) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleRowClick() {
    if (!readOnly) setEditing(true);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.value) {
      onSave(e.target.value);
    }
    setEditing(false);
  }

  function handleBlur() {
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") setEditing(false);
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  return (
    <PropertyRow label={label} editing={editing} onClick={handleRowClick} readOnly={readOnly}>
      {editing ? (
        <input
          ref={inputRef}
          type="date"
          className="prop-input prop-date"
          value={value ?? ""}
          aria-label={label}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
      ) : value ? (
        <span className="prop-text prop-text--mono">{value}</span>
      ) : (
        <span className="prop-placeholder">+ set {placeholder ?? label}</span>
      )}
    </PropertyRow>
  );
}

interface EditableNumberProps {
  label: string;
  value: number | undefined;
  placeholder?: string;
  readOnly?: boolean;
  min?: number;
  onSave: (value: number) => void;
}

function EditableNumber({ label, value, placeholder, readOnly, min = 0, onSave }: EditableNumberProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value !== undefined ? String(value) : "");
  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleRowClick() {
    if (!readOnly) {
      setDraft(value !== undefined ? String(value) : "");
      setEditing(true);
    }
  }

  function commitIfChanged() {
    const parsed = parseInt(draft, 10);
    if (!isNaN(parsed) && parsed >= min && parsed !== value) {
      onSave(parsed);
    }
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitIfChanged();
    }
    if (e.key === "Escape") {
      setDraft(value !== undefined ? String(value) : "");
      setEditing(false);
    }
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  return (
    <PropertyRow label={label} editing={editing} onClick={handleRowClick} readOnly={readOnly}>
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          className="prop-input prop-number"
          value={draft}
          aria-label={label}
          min={min}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitIfChanged}
          onKeyDown={handleKeyDown}
        />
      ) : value !== undefined ? (
        <span className="prop-text prop-text--mono">{value} min</span>
      ) : (
        <span className="prop-placeholder">+ set {placeholder ?? label}</span>
      )}
    </PropertyRow>
  );
}

// ─── Save hooks ───────────────────────────────────────────────────────────────

function useSaveField(task: Task, tasksPath: string | undefined, onPromoted: () => void) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const isInline = task.source === "inline";

  const saveField = useCallback(
    async (field: string, value: string | number | null): Promise<void> => {
      if (isInline) {
        if (!tasksPath || task.line === undefined) return;
        setSaveState("saving");
        const result = await promoteAndEditTaskApi({
          tasksPath,
          line: task.line,
          field,
          value,
        });
        if (result.ok) {
          setSaveState("idle");
          onPromoted();
        } else {
          setSaveState("error");
          setTimeout(() => setSaveState("idle"), 2000);
        }
        return;
      }

      if (!task.entityPath) return;
      setSaveState("saving");
      const result = await editTaskFieldApi({ entityPath: task.entityPath, field, value });
      if (result.ok) {
        setSaveState("idle");
      } else {
        setSaveState("error");
        setTimeout(() => setSaveState("idle"), 2000);
      }
    },
    [isInline, task.entityPath, task.line, tasksPath, onPromoted]
  );

  const saveStatus = useCallback(
    async (status: string): Promise<void> => {
      // B07 — inline task status change: two-step promote → status-edit.
      if (isInline) {
        if (!tasksPath || task.line === undefined) return;
        setSaveState("saving");
        const promoteResult = await promoteTaskApi({
          sourcePath: tasksPath,
          line: task.line,
        });
        if (!promoteResult.ok) {
          setSaveState("error");
          setTimeout(() => setSaveState("idle"), 2000);
          return;
        }
        const newEntityPath = promoteResult.data.path;
        if (!newEntityPath) {
          setSaveState("error");
          setTimeout(() => setSaveState("idle"), 2000);
          return;
        }
        const statusResult = await editTaskStatusApi({
          entityPath: newEntityPath,
          status,
        });
        if (statusResult.ok) {
          setSaveState("idle");
          onPromoted();
        } else {
          setSaveState("error");
          setTimeout(() => setSaveState("idle"), 2000);
        }
        return;
      }

      if (!task.entityPath) return;
      setSaveState("saving");
      const result = await editTaskStatusApi({ entityPath: task.entityPath, status });
      if (result.ok) {
        setSaveState("idle");
      } else {
        setSaveState("error");
        setTimeout(() => setSaveState("idle"), 2000);
      }
    },
    [isInline, task.entityPath, task.line, tasksPath, onPromoted]
  );

  const saveBody = useCallback(
    async (body: string): Promise<void> => {
      // Body edits only exist for entity tasks. If the user is editing notes
      // on an inline task, the UI doesn't surface the row — this is a guard.
      if (!task.entityPath) return;
      setSaveState("saving");
      const result = await editTaskBodyApi({ entityPath: task.entityPath, body });
      if (result.ok) {
        setSaveState("idle");
      } else {
        setSaveState("error");
        setTimeout(() => setSaveState("idle"), 2000);
      }
    },
    [task.entityPath]
  );

  return { saveState, saveField, saveStatus, saveBody };
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function TaskDetailPanel({ task, tasksPath, projectGoal, projectWikilink }: TaskDetailPanelProps) {
  const setExpandedTaskId = useSidebarStore((s) => s.setExpandedTaskId);
  const panelRef = useRef<HTMLDivElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // R2 DELETE-STALE-FLICKER (Gemini) — while fetchVault runs post-delete,
  // hide the panel contents behind a "Deleting…" overlay so the user
  // doesn't see the about-to-be-gone task as still-interactive for 1-2s.
  const [isDeleting, setIsDeleting] = useState(false);

  const handlePromoted = useCallback(() => {
    setExpandedTaskId(null);
  }, [setExpandedTaskId]);

  const { saveState, saveField, saveStatus, saveBody } = useSaveField(task, tasksPath, handlePromoted);

  const isEntityTask = task.source === "entity" && !!task.entityPath;
  const isInline = task.source === "inline";
  const isDisabled = saveState === "saving";

  // Keyboard: Escape collapses panel, ⌘S closes panel.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setExpandedTaskId(null);
    }
    if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setExpandedTaskId(null);
    }
  }

  // ── Delete flow ───────────────────────────────────────────────────────────
  //
  // Opens ConfirmModal; on confirm, dispatches to entity or inline endpoint
  // based on task.source. Success collapses the panel (SSE refresh catches
  // the file-system change milliseconds later). Failure shows an inline
  // error row with the server message.

  async function handleDeleteConfirm() {
    setConfirmOpen(false);
    setDeleteError(null);

    // R1 DELETE-UNMOUNT-TIMING — refetch BEFORE collapsing the panel so
    // the ConfirmModal's focus-restore useEffect runs while the trash
    // button (returnFocusRef target) is still in the DOM.
    // R2 DELETE-STALE-FLICKER — set isDeleting true during the refetch
    // window so the panel body renders a quiet "Deleting…" placeholder
    // rather than the stale task details.
    // R2 DELETE-ERROR-INVISIBLE — on fetchVault failure, keep the panel
    // MOUNTED so the inline error is visible; only collapse on success.

    async function collapseAfterRefetch(): Promise<void> {
      setIsDeleting(true);
      let refetchFailed = false;
      try {
        const v = await fetchVault();
        useSidebarStore.getState().setVault(v);
      } catch {
        refetchFailed = true;
      }
      if (refetchFailed) {
        // Stay mounted with a visible error — user can dismiss themselves.
        setDeleteError(
          "Deleted. Vault refresh failed — SSE will sync. Close panel manually."
        );
        setIsDeleting(false);
      } else {
        // Success path: collapse the panel; React unmounts cleanly.
        setExpandedTaskId(null);
      }
    }

    if (isEntityTask && task.entityPath) {
      const r = await deleteEntityTaskApi({ entityPath: task.entityPath });
      if (r.ok) {
        await collapseAfterRefetch();
      } else {
        setDeleteError(r.error);
      }
      return;
    }
    if (isInline && tasksPath && task.line !== undefined) {
      const r = await deleteInlineTaskApi({
        tasksPath,
        line: task.line,
        expectedAction: task.action,
      });
      if (r.ok) {
        await collapseAfterRefetch();
      } else {
        setDeleteError(r.error);
      }
    }
  }

  const panelClass = `task-detail-panel${isInline ? " task-detail-panel--inline" : ""}${
    saveState === "error" ? " task-detail-panel--error" : ""
  }${isDeleting ? " task-detail-panel--deleting" : ""}`;

  // ── Breadcrumb pieces ─────────────────────────────────────────────────────
  // V4B layout (picked in Sprint 0): goal line alone, project+trash line,
  // timestamps line. Timestamps only show for entity tasks (inline has
  // neither `created` nor a meaningful `modified`).
  //
  // R1 NON-WIKILINK-GOAL — `projectGoal` may be a plain string if the
  // README's `parent-goal` frontmatter was written without wikilink
  // brackets. Show it as a muted string rather than hiding it entirely
  // so the user isn't surprised by a missing breadcrumb line.
  const hasGoalWikilink = typeof projectGoal === "string" && projectGoal.startsWith("[[");
  const hasGoalString = typeof projectGoal === "string" && projectGoal.length > 0 && !hasGoalWikilink;
  const hasGoal = hasGoalWikilink || hasGoalString;
  const hasProjectWikilink = typeof projectWikilink === "string" && projectWikilink.startsWith("[[");
  const hasTimestamps = isEntityTask && (task.created || task.modified);

  return (
    <div
      ref={panelRef}
      className={panelClass}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label={`Details for: ${task.action}`}
    >
      {/* ── V4B breadcrumb ─────────────────────────────────────────────── */}
      {(hasGoal || hasProjectWikilink || hasTimestamps) && (
        <div className="detail-breadcrumb" aria-label="Task context">
          {hasGoal && projectGoal && (
            <div className="detail-breadcrumb__goal-line">
              {hasGoalWikilink ? (
                <WikilinkChip raw={projectGoal} />
              ) : (
                <span className="detail-breadcrumb__goal-plain" title={projectGoal}>
                  {projectGoal}
                </span>
              )}
            </div>
          )}
          <div className="detail-breadcrumb__project-line">
            {hasProjectWikilink && projectWikilink ? (
              <WikilinkChip raw={projectWikilink} />
            ) : task.parentProject ? (
              <WikilinkChip raw={task.parentProject} />
            ) : (
              <span className="detail-breadcrumb__no-project">—</span>
            )}
            <button
              type="button"
              className="detail-breadcrumb__trash"
              onClick={() => setConfirmOpen(true)}
              title="Delete task"
              aria-label="Delete task"
              disabled={isDisabled}
            >
              <Trash2 size={14} strokeWidth={1.5} />
            </button>
          </div>
          {hasTimestamps && (
            <div className="detail-breadcrumb__timestamps">
              {task.created && <span>created {relativeAge(task.created)}</span>}
              {task.created && task.modified && <span aria-hidden="true"> · </span>}
              {task.modified && <span>modified {relativeAge(task.modified)}</span>}
            </div>
          )}
        </div>
      )}

      {/* Action row */}
      {isEntityTask ? (
        <EditableText
          label="Action"
          value={task.action}
          readOnly={isDisabled}
          onSave={(v) => void saveField("action", v)}
        />
      ) : (
        <PropertyRow label="Action" readOnly>
          <span className="prop-text">{task.action}</span>
        </PropertyRow>
      )}

      {/* Priority + due row */}
      {(task.priority || task.due) && (
        <div className="prop-meta-row">
          {task.priority && <RankChip rank={task.priority.rank} />}
          {task.due && (
            <DueChip
              due={task.due}
              dueToday={task.dueToday}
              overdue={task.overdue}
            />
          )}
        </div>
      )}

      {/* Property list */}
      <div className="prop-list">
        <EditableSelect
          label="Status"
          value={task.status}
          options={STATUS_OPTIONS}
          placeholder="status"
          readOnly={isDisabled}
          onSave={(v) => void saveStatus(v)}
        />

        <EditableSelect
          label="Owner"
          value={task.owner}
          options={OWNER_OPTIONS}
          placeholder="owner"
          readOnly={isDisabled}
          onSave={(v) => void saveField("owner", v)}
        />

        <EditableSelect
          label="Energy"
          value={task.energyLevel}
          options={ENERGY_OPTIONS}
          placeholder="energy level"
          readOnly={isDisabled}
          onSave={(v) => void saveField("energy-level", v)}
        />

        <EditableNumber
          label="Duration"
          value={task.estimatedDuration}
          placeholder="duration (min)"
          readOnly={isDisabled}
          min={0}
          onSave={(v) => void saveField("estimated-duration", v)}
        />

        <EditableDate
          label="Due"
          value={task.due}
          placeholder="due date"
          readOnly={isDisabled}
          onSave={(v) => void saveField("due", v)}
        />

        <EditableSelect
          label="Impact"
          value={task.impact}
          options={IMPACT_URGENCY_OPTIONS}
          placeholder="impact"
          readOnly={isDisabled}
          onSave={(v) => void saveField("impact", v)}
        />

        <EditableSelect
          label="Urgency"
          value={task.urgency}
          options={IMPACT_URGENCY_OPTIONS}
          placeholder="urgency"
          readOnly={isDisabled}
          onSave={(v) => void saveField("urgency", v)}
        />

        {task.blockedBy && task.blockedBy.length > 0 ? (
          <PropertyRow label="Blocked by" readOnly>
            <span className="prop-chips">
              {task.blockedBy.map((wl) => (
                <WikilinkChip key={wl} raw={wl} />
              ))}
            </span>
          </PropertyRow>
        ) : (
          <EditableText
            label="Blocked by"
            value={undefined}
            placeholder="blocked-by (wikilinks)"
            readOnly={isDisabled}
            onSave={(v) => void saveField("blocked-by", v)}
          />
        )}

        {/* Sprint E — Notes row (entity tasks only). Inline tasks have no
            body concept; hiding the row avoids an impossible affordance. */}
        {isEntityTask && (
          <EditableTextArea
            label="Notes"
            value={task.body ?? ""}
            placeholder="notes"
            readOnly={isDisabled}
            onSave={(v) => void saveBody(v)}
          />
        )}

        {task.parentProject && !hasProjectWikilink && (
          <PropertyRow label="Project" readOnly>
            <WikilinkChip raw={task.parentProject} />
          </PropertyRow>
        )}

        {isInline && (
          <PropertyRow label="Type" readOnly>
            <span className="prop-badge">inline</span>
          </PropertyRow>
        )}
      </div>

      {saveState === "error" && (
        <div className="prop-error-row" role="alert">
          Write failed — check server.
        </div>
      )}

      {deleteError && (
        <div className="prop-error-row" role="alert" aria-live="assertive">
          {deleteError.startsWith("Deleted")
            ? deleteError
            : `Delete failed: ${deleteError}`}
        </div>
      )}

      {isDeleting && !deleteError && (
        <div className="task-detail-panel__deleting-overlay" role="status" aria-live="polite">
          Deleting…
        </div>
      )}

      {confirmOpen && (
        <ConfirmModal
          title="Delete task?"
          body={
            isEntityTask && task.entityPath
              ? `Removes ${task.entityPath}. This cannot be undone.`
              : `Removes this task from ${tasksPath ?? "tasks.md"}. This cannot be undone.`
          }
          confirmLabel="Delete"
          variant="danger"
          onConfirm={() => void handleDeleteConfirm()}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
