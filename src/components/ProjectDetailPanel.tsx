import { useState, useCallback } from "react";
import type { Project } from "../api.js";
import { editProjectFieldApi } from "../api.js";
import { useSidebarStore } from "../store.js";

interface ProjectDetailPanelProps {
  project: Project;
}

const PROJECT_STATUS_OPTIONS = [
  "backlog", "active", "blocked", "paused", "done", "cancelled",
] as const;

type SaveState = "idle" | "saving" | "error";

// ─── Wikilink chip helpers ────────────────────────────────────────────────────

/**
 * Extracts a display name from a wikilink such as [[1-Projects/foo/README]]
 * or [[1-Projects/foo/FOO-README]].
 *
 * Rules (applied in order):
 *   1. Plain "README" or "README.md" → use the parent directory slug
 *   2. Segment ending in "-README" (e.g. "AGENT-HARNESS-TEMPLATE-README") → strip suffix
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
      data-wikilink={raw}
    >
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
  // Sprint E — keyboard-accessible clickable rows: render as <button> so
  // Tab can reach them and Enter/Space activates. Read-only rows stay
  // <div> (no false focusable targets for AT).
  const clickable = onClick && !readOnly;
  const className = `prop-row${editing ? " prop-row--editing" : ""}${clickable ? " prop-row--clickable" : ""}`;
  if (clickable) {
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

  function handleRowClick() {
    if (!readOnly) setEditing(true);
  }

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (e.target.value) {
      onSave(e.target.value);
    }
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") setEditing(false);
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
          onBlur={() => setEditing(false)}
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

interface EditableTextAreaProps {
  label: string;
  value: string | undefined;
  placeholder?: string;
  readOnly?: boolean;
  onSave: (value: string) => void;
}

function EditableTextArea({ label, value, placeholder, readOnly, onSave }: EditableTextAreaProps) {
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
    if (trimmed !== (value ?? "")) {
      onSave(trimmed);
    }
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setDraft(value ?? "");
      setEditing(false);
    }
  }

  return (
    <PropertyRow label={label} editing={editing} onClick={handleRowClick} readOnly={readOnly}>
      {editing ? (
        <textarea
          className="prop-input prop-textarea"
          autoFocus
          value={draft}
          aria-label={label}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitIfChanged}
          onKeyDown={handleKeyDown}
        />
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
    if (e.target.value) onSave(e.target.value);
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
          onBlur={() => setEditing(false)}
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

interface EditableTextInputProps {
  label: string;
  value: string | undefined;
  placeholder?: string;
  readOnly?: boolean;
  onSave: (value: string) => void;
}

function EditableTextInput({ label, value, placeholder, readOnly, onSave }: EditableTextInputProps) {
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
    if (trimmed !== (value ?? "")) {
      onSave(trimmed);
    }
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
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
      ) : value ? (
        <span className="prop-text">{value}</span>
      ) : (
        <span className="prop-placeholder" aria-label={`Set ${label}`}>+ set {placeholder ?? label}</span>
      )}
    </PropertyRow>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ProjectDetailPanel({ project }: ProjectDetailPanelProps) {
  const setExpandedProjectSlug = useSidebarStore((s) => s.setExpandedProjectSlug);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const isDisabled = saveState === "saving";

  const saveField = useCallback(
    async (field: string, value: string | number | null): Promise<void> => {
      setSaveState("saving");
      const result = await editProjectFieldApi({ slug: project.slug, field, value });
      if (result.ok) {
        setSaveState("idle");
      } else {
        setSaveState("error");
        setTimeout(() => setSaveState("idle"), 2000);
      }
    },
    [project.slug]
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setExpandedProjectSlug(null);
    }
    if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setExpandedProjectSlug(null);
    }
  }

  return (
    <div
      className="task-detail-panel project-detail-panel"
      onKeyDown={handleKeyDown}
      role="region"
      aria-label={`Details for project: ${project.title}`}
    >
      <div className="prop-list">
        <EditableTextArea
          label="Outcome"
          value={project.outcome}
          placeholder="desired outcome"
          readOnly={isDisabled}
          onSave={(v) => void saveField("outcome", v)}
        />

        <EditableSelect
          label="Status"
          value={project.status}
          options={PROJECT_STATUS_OPTIONS}
          placeholder="status"
          readOnly={isDisabled}
          onSave={(v) => void saveField("status", v)}
        />

        <EditableDate
          label="Due"
          value={project.due}
          placeholder="due date"
          readOnly={isDisabled}
          onSave={(v) => void saveField("due", v)}
        />

        <EditableDate
          label="Target"
          value={project.targetDate}
          placeholder="target date"
          readOnly={isDisabled}
          onSave={(v) => void saveField("target-date", v)}
        />

        <EditableDate
          label="Start"
          value={project.startDate}
          placeholder="start date"
          readOnly={isDisabled}
          onSave={(v) => void saveField("start-date", v)}
        />

        {/* Parent goal — wikilink chip if looks like one, else editable text */}
        {project.parentGoal && project.parentGoal.startsWith("[[") ? (
          <PropertyRow label="Goal" readOnly>
            <WikilinkChip raw={project.parentGoal} />
          </PropertyRow>
        ) : (
          <EditableTextInput
            label="Goal"
            value={project.parentGoal}
            placeholder="parent goal"
            readOnly={isDisabled}
            onSave={(v) => void saveField("parent-goal", v)}
          />
        )}

        {/* Computed read-only fields */}
        {project.progress !== undefined && (
          <PropertyRow label="Progress" readOnly>
            <span className="prop-badge">{project.progress}%</span>
          </PropertyRow>
        )}

        {project.tasksDoneCount !== undefined && (
          <PropertyRow label="Done" readOnly>
            <span className="prop-badge">{project.tasksDoneCount}</span>
          </PropertyRow>
        )}

        {project.tasksNotDoneCount !== undefined && (
          <PropertyRow label="Open" readOnly>
            <span className="prop-badge">{project.tasksNotDoneCount}</span>
          </PropertyRow>
        )}

        {project.tasksOverdueCount !== undefined && project.tasksOverdueCount > 0 && (
          <PropertyRow label="Overdue" readOnly>
            <span className="prop-badge prop-badge--overdue">{project.tasksOverdueCount}</span>
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
