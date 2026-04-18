import { useRef, useState, useCallback } from "react";
import type { Task } from "../api.js";
import {
  editTaskFieldApi,
  editTaskStatusApi,
  promoteAndEditTaskApi,
} from "../api.js";
import { useSidebarStore } from "../store.js";

interface TaskDetailPanelProps {
  task: Task;
  tasksPath?: string;
}

const STATUS_OPTIONS = ["backlog", "open", "in-progress", "blocked", "done"] as const;
const OWNER_OPTIONS = ["human", "agent", "either"] as const;
const ENERGY_OPTIONS = ["low", "medium", "high"] as const;
const IMPACT_URGENCY_OPTIONS = ["very-high", "high", "medium", "low", "very-low"] as const;

type SaveState = "idle" | "saving" | "error";

// ─── Wikilink chip helpers ────────────────────────────────────────────────────

/**
 * Extracts a display name from a wikilink such as [[1-Projects/foo/README]]
 * or [[1-Projects/foo/FOO-README]].
 *
 * Rules (applied in order):
 *   1. Plain "README" or "README.md" → use the parent directory slug
 *   2. Segment ending in "-README" (e.g. "E2E-TEST-PROJECT-README") → strip suffix
 *   3. Anything else → use the last segment as-is
 *
 * Result is dashes-to-spaces + title-cased. Raw wikilink stays in title attr.
 */
function extractWikilinkLabel(raw: string): string {
  const inner = raw.replace(/^\[\[/, "").replace(/\]\]$/, "");
  const segments = inner.split("/");
  const last = segments[segments.length - 1];
  const lastLower = last.toLowerCase();

  let slug: string;
  if (lastLower === "readme" || lastLower === "readme.md") {
    // Plain README → fall back to parent slug
    slug = segments[segments.length - 2] ?? last;
  } else if (last.toUpperCase().endsWith("-README")) {
    // e.g. "E2E-TEST-PROJECT-README" → strip "-README"
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

interface PropertyRowProps {
  label: string;
  children: React.ReactNode;
  editing?: boolean;
  onClick?: () => void;
  readOnly?: boolean;
}

function PropertyRow({ label, children, editing, onClick, readOnly }: PropertyRowProps) {
  return (
    <div
      className={`prop-row${editing ? " prop-row--editing" : ""}${onClick && !readOnly ? " prop-row--clickable" : ""}`}
      onClick={onClick && !readOnly ? onClick : undefined}
    >
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

  return (
    <PropertyRow label={label} editing={editing} onClick={handleRowClick} readOnly={readOnly}>
      {editing ? (
        <select
          className="prop-input prop-select"
          autoFocus
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
        <span className="prop-placeholder" aria-label={`Set ${label}`}>+ set {placeholder ?? label}</span>
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

  return (
    <PropertyRow label={label} editing={editing} onClick={handleRowClick} readOnly={readOnly}>
      {editing ? (
        multiline ? (
          <textarea
            className="prop-input prop-textarea"
            autoFocus
            value={draft}
            aria-label={label}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitIfChanged}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <input
            type="text"
            className="prop-input"
            autoFocus
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
        <span className="prop-placeholder" aria-label={`Set ${label}`}>+ set {placeholder ?? label}</span>
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

  return (
    <PropertyRow label={label} editing={editing} onClick={handleRowClick} readOnly={readOnly}>
      {editing ? (
        <input
          type="date"
          className="prop-input prop-date"
          autoFocus
          value={value ?? ""}
          aria-label={label}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
      ) : value ? (
        <span className="prop-text prop-text--mono">{value}</span>
      ) : (
        <span className="prop-placeholder" aria-label={`Set ${label}`}>+ set {placeholder ?? label}</span>
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

  return (
    <PropertyRow label={label} editing={editing} onClick={handleRowClick} readOnly={readOnly}>
      {editing ? (
        <input
          type="number"
          className="prop-input prop-number"
          autoFocus
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
        <span className="prop-placeholder" aria-label={`Set ${label}`}>+ set {placeholder ?? label}</span>
      )}
    </PropertyRow>
  );
}

// ─── Save hook — handles both entity and inline (promote-and-edit) paths ─────

function useSaveField(task: Task, tasksPath: string | undefined, onPromoted: () => void) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const isInline = task.source === "inline";

  const saveField = useCallback(
    async (field: string, value: string | number | null): Promise<void> => {
      if (isInline) {
        // Inline task: must auto-promote first, then set field
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
    [task.entityPath]
  );

  return { saveState, saveField, saveStatus };
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function TaskDetailPanel({ task, tasksPath }: TaskDetailPanelProps) {
  const setExpandedTaskId = useSidebarStore((s) => s.setExpandedTaskId);
  const panelRef = useRef<HTMLDivElement>(null);

  // When an inline task is promoted, collapse the panel — vault watcher will refetch
  const handlePromoted = useCallback(() => {
    setExpandedTaskId(null);
  }, [setExpandedTaskId]);

  const { saveState, saveField, saveStatus } = useSaveField(task, tasksPath, handlePromoted);

  const isEntityTask = task.source === "entity" && !!task.entityPath;
  const isInline = task.source === "inline";
  const isDisabled = saveState === "saving";

  // Keyboard: Escape collapses panel, ⌘S closes panel
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

  const panelClass = `task-detail-panel${isInline ? " task-detail-panel--inline" : ""}${
    saveState === "error" ? " task-detail-panel--error" : ""
  }`;

  return (
    <div
      ref={panelRef}
      className={panelClass}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label={`Details for: ${task.action}`}
    >
      {/* Action row — always visible at top, editable for entity tasks */}
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

      {/* Priority + due row — shown inline under action */}
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
        {/* Status — entity only (inline tasks have no status yet) */}
        {(isEntityTask || isInline) && (
          <EditableSelect
            label="Status"
            value={task.status}
            options={STATUS_OPTIONS}
            placeholder="status"
            readOnly={isDisabled || isInline}
            onSave={(v) => void saveStatus(v)}
          />
        )}

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

        {/* Blocked-by — wikilink chips if populated, else editable text */}
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

        {/* Parent project — read-only wikilink chip */}
        {task.parentProject && (
          <PropertyRow label="Project" readOnly>
            <WikilinkChip raw={task.parentProject} />
          </PropertyRow>
        )}

        {/* Source badge */}
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
    </div>
  );
}
