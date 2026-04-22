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
  isEntityTask,
  isInlineTask,
  nextVaultSeq,
  promoteAndEditTaskApi,
  promoteTaskApi,
  restoreTombstoneApi,
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
  // Sprint H.2.5 — task.modified captured on every render; Editable*
  // snapshots it to a ref at edit-open to pass through onSave.
  modified?: string;
  onSave: (value: string, expectedModified?: string) => void;
}

function EditableSelect({ label, value, options, placeholder, readOnly, modified, onSave }: EditableSelectProps) {
  const [editing, setEditing] = useState(false);
  const selectRef = useRef<HTMLSelectElement | null>(null);
  // Sprint H.2.5 — snapshot task.modified when the user starts editing.
  // Preserves the "state the edit was built on" for the mtime check,
  // even if SSE refetches and updates task.modified mid-edit.
  const editOpenModifiedRef = useRef<string | undefined>(undefined);

  function handleRowClick() {
    if (!readOnly) {
      editOpenModifiedRef.current = modified;
      setEditing(true);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (e.target.value) {
      onSave(e.target.value, editOpenModifiedRef.current);
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
  modified?: string;
  onSave: (value: string, expectedModified?: string) => void;
}

function EditableText({ label, value, placeholder, readOnly, multiline, modified, onSave }: EditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const editOpenModifiedRef = useRef<string | undefined>(undefined);

  function handleRowClick() {
    if (!readOnly) {
      setDraft(value ?? "");
      editOpenModifiedRef.current = modified;
      setEditing(true);
    }
  }

  function commitIfChanged() {
    const trimmed = draft.trim();
    if (trimmed !== (value ?? "") && trimmed.length > 0) {
      onSave(trimmed, editOpenModifiedRef.current);
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
  modified?: string;
  onSave: (value: string, expectedModified?: string) => void;
}

function EditableTextArea({ label, value, placeholder, readOnly, rows = 4, modified, onSave }: EditableTextAreaProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editOpenModifiedRef = useRef<string | undefined>(undefined);

  function handleRowClick() {
    if (!readOnly) {
      setDraft(value ?? "");
      editOpenModifiedRef.current = modified;
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
      onSave(trimmed, editOpenModifiedRef.current);
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
  modified?: string;
  onSave: (value: string, expectedModified?: string) => void;
}

function EditableDate({ label, value, placeholder, readOnly, modified, onSave }: EditableDateProps) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editOpenModifiedRef = useRef<string | undefined>(undefined);

  function handleRowClick() {
    if (!readOnly) {
      editOpenModifiedRef.current = modified;
      setEditing(true);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.value) {
      onSave(e.target.value, editOpenModifiedRef.current);
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
  modified?: string;
  onSave: (value: number, expectedModified?: string) => void;
}

function EditableNumber({ label, value, placeholder, readOnly, min = 0, modified, onSave }: EditableNumberProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value !== undefined ? String(value) : "");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editOpenModifiedRef = useRef<string | undefined>(undefined);

  function handleRowClick() {
    if (!readOnly) {
      setDraft(value !== undefined ? String(value) : "");
      editOpenModifiedRef.current = modified;
      setEditing(true);
    }
  }

  function commitIfChanged() {
    const parsed = parseInt(draft, 10);
    if (!isNaN(parsed) && parsed >= min && parsed !== value) {
      onSave(parsed, editOpenModifiedRef.current);
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

function useSaveField(task: Task, tasksPath: string | undefined, onPromoted: () => void, onMtimeConflict: () => void) {
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Sprint I.9 R1 — Gemini TASKDETAIL-USECALLBACK-OVERBIND (MEDIUM):
  // previously the three callbacks had `task` in deps, so every SSE-driven
  // vault refetch (which creates a new `task` object even if all fields are
  // byte-identical) re-bound all three functions. Editable* child components
  // that receive these as props then re-rendered unnecessarily on every tick.
  //
  // Fix: read `task` through a ref kept fresh via useEffect. Callbacks close
  // over the ref (stable) instead of `task` (changes every render). Deps
  // narrow to only the stable external props. Stale-closure safety is
  // preserved because the ref is mutated on every render BEFORE any event
  // handler could fire — React guarantees render → commit → effect flush →
  // user interaction. A save click always reads the freshest task state.
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  });

  const saveField = useCallback(
    async (field: string, value: string | number | null, expectedModified?: string): Promise<void> => {
      const t = taskRef.current;
      if (isInlineTask(t)) {
        if (!tasksPath) return;
        setSaveState("saving");
        // Inline path: promote-and-edit — the entity file doesn't exist
        // yet, so mtime-lock doesn't apply on this first call. After
        // promote, subsequent saves go via entity path below.
        const result = await promoteAndEditTaskApi({
          tasksPath,
          line: t.line,
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

      if (!isEntityTask(t)) return;
      setSaveState("saving");
      const result = await editTaskFieldApi({
        entityPath: t.entityPath,
        field,
        value,
        expectedModified,
      });
      if (result.ok) {
        setSaveState("idle");
      } else {
        // Sprint H.2.6 — dedicated handling for mtime-mismatch (409).
        // The error string is exactly "mtime-mismatch" per mtime-lock.ts.
        if (result.error === "mtime-mismatch") {
          onMtimeConflict();
          // Keep the editing state active at the call site (Editable*
          // already closed its own editing state on commit, but the
          // parent panel will show the conflict toast + refetch). The
          // user can re-open the row and re-apply their edit on fresh
          // state.
          setSaveState("idle");
          return;
        }
        setSaveState("error");
        setTimeout(() => setSaveState("idle"), 2000);
      }
    },
    // Narrowed deps (I.9 R1): only stable callables + tasksPath. `task` is
    // read through taskRef.current so it's always fresh without triggering
    // re-binds on identity-only changes.
    [tasksPath, onPromoted, onMtimeConflict]
  );

  const saveStatus = useCallback(
    async (status: string): Promise<void> => {
      const t = taskRef.current;
      // B07 — inline task status change: two-step promote → status-edit.
      if (isInlineTask(t)) {
        if (!tasksPath) return;
        setSaveState("saving");
        const promoteResult = await promoteTaskApi({
          sourcePath: tasksPath,
          line: t.line,
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

      if (!isEntityTask(t)) return;
      setSaveState("saving");
      const result = await editTaskStatusApi({ entityPath: t.entityPath, status });
      if (result.ok) {
        setSaveState("idle");
      } else {
        setSaveState("error");
        setTimeout(() => setSaveState("idle"), 2000);
      }
    },
    // Narrowed deps (I.9 R1): taskRef.current gives fresh reads without
    // dep churn on every SSE refetch.
    [tasksPath, onPromoted]
  );

  const saveBody = useCallback(
    async (body: string, expectedModified?: string): Promise<void> => {
      const t = taskRef.current;
      // Body edits only exist for entity tasks. If the user is editing notes
      // on an inline task, the UI doesn't surface the row — this is a guard.
      if (!isEntityTask(t)) return;
      setSaveState("saving");
      const result = await editTaskBodyApi({
        entityPath: t.entityPath,
        body,
        expectedModified,
      });
      if (result.ok) {
        setSaveState("idle");
      } else {
        if (result.error === "mtime-mismatch") {
          onMtimeConflict();
          setSaveState("idle");
          return;
        }
        setSaveState("error");
        setTimeout(() => setSaveState("idle"), 2000);
      }
    },
    // Narrowed deps (I.9 R1): same pattern — taskRef for fresh reads.
    [onMtimeConflict]
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
  // Sprint H.2.6 — mtime-conflict banner state. Set by the save hooks
  // when the server returns 409 mtime-mismatch. Auto-clears after 6s
  // (long enough to read; short enough to not clutter). Triggers a
  // vault refetch so the panel shows fresh frontmatter + body.
  const [mtimeConflict, setMtimeConflict] = useState(false);
  const mtimeConflictTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sprint H R2 critic-fix (Gemini MTIME-BANNER-A11Y-FOCUS MEDIUM) —
  // ref on the banner so we can pull keyboard focus to the actionable
  // instruction when the 409 lands. Screen readers get aria-live; keyboard
  // users get programmatic focus too.
  const mtimeConflictBannerRef = useRef<HTMLDivElement | null>(null);

  const handlePromoted = useCallback(() => {
    setExpandedTaskId(null);
  }, [setExpandedTaskId]);

  const handleMtimeConflict = useCallback(() => {
    setMtimeConflict(true);
    if (mtimeConflictTimerRef.current !== null) clearTimeout(mtimeConflictTimerRef.current);
    mtimeConflictTimerRef.current = setTimeout(() => {
      setMtimeConflict(false);
      mtimeConflictTimerRef.current = null;
    }, 6000);
    // R2 critic-fix (Gemini MTIME-BANNER-A11Y-FOCUS) — next paint,
    // pull focus to the banner so keyboard-only users are informed of
    // the conflict. requestAnimationFrame defers past the render commit
    // so the ref is populated.
    requestAnimationFrame(() => {
      mtimeConflictBannerRef.current?.focus();
    });
    // Refetch so the panel shows fresh disk state. User's draft text
    // in any open Editable* is PRESERVED (state lives in the child).
    // R2 D3 — pair with monotonic seq so a concurrent restore/delete
    // refetch can't race us and apply stale vault data after ours.
    const mtimeRefetchSeq = nextVaultSeq();
    void (async () => {
      try {
        const v = await fetchVault();
        useSidebarStore.getState().setVault(v, mtimeRefetchSeq);
      } catch { /* SSE will catch up */ }
    })();
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (mtimeConflictTimerRef.current !== null) clearTimeout(mtimeConflictTimerRef.current);
    };
  }, []);

  const { saveState, saveField, saveStatus, saveBody } = useSaveField(task, tasksPath, handlePromoted, handleMtimeConflict);

  const isEntityTask = task.source === "entity" && !!task.entityPath;
  const isInline = task.source === "inline";
  // R3 DELETE-DOUBLE-SUBMIT (Gemini) — property rows also freeze during
  // the delete flow; an in-flight delete must lock all edit affordances.
  const isDisabled = saveState === "saving" || isDeleting;

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
    // R3 DELETE-DOUBLE-SUBMIT (Gemini) — lock the whole panel immediately
    // so the trash button + property rows + Notes textarea are all
    // disabled for the entire delete→refetch window. Unlock only if
    // refetch fails (panel stays open with error visible).
    setIsDeleting(true);

    // R1 DELETE-UNMOUNT-TIMING — refetch BEFORE collapsing the panel so
    // the ConfirmModal's focus-restore useEffect runs while the trash
    // button (returnFocusRef target) is still in the DOM.
    // R2 DELETE-STALE-FLICKER — set isDeleting true during the refetch
    // window so the panel body renders a quiet "Deleting…" placeholder
    // rather than the stale task details.
    // R2 DELETE-ERROR-INVISIBLE — on fetchVault failure, keep the panel
    // MOUNTED so the inline error is visible; only collapse on success.

    async function collapseAfterRefetch(): Promise<void> {
      // isDeleting was already set true at function entry — don't flip again.
      // R2 D3 — seq-paired fetch so a concurrent refetch can't clobber us.
      const collapseSeq = nextVaultSeq();
      let refetchFailed = false;
      try {
        const v = await fetchVault();
        useSidebarStore.getState().setVault(v, collapseSeq);
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

    // Sprint H.3.9 — single-task delete: capture tombstoneId AND queue a
    // real-undo PendingUndo (same pattern as BulkBar H.3.7). User can
    // click Undo in the toast OR hit ⌘Z within 5s to restore.
    const storeSetPendingUndo = useSidebarStore.getState().setPendingUndo;
    const taskLabel = task.action.length > 40 ? `${task.action.slice(0, 37)}…` : task.action;

    function queueRestoreUndo(tombstoneId: string | undefined) {
      if (!tombstoneId) return;
      storeSetPendingUndo({
        action: "delete",
        taskIds: [task.id],
        entityPaths: [],
        label: `Deleted: ${taskLabel}`,
        undoneAt: Date.now(),
        revert: async () => {
          try {
            const r = await restoreTombstoneApi({ tombstoneId });
            if (!r.ok) {
              // Restore failed (tombstone swept, target re-occupied, etc.)
              // Emit a terminal-label toast so user sees why.
              // R2 critic-fix (Gemini UNDO-TOAST-TERMINAL-BTNS) —
              // terminal:true causes UndoToast to omit the Undo button.
              storeSetPendingUndo({
                action: "delete",
                taskIds: [],
                entityPaths: [],
                label: "Restore failed — tombstone expired or target exists",
                undoneAt: Date.now(),
                revert: async () => { /* terminal feedback */ },
                terminal: true,
              });
            }
          } catch {
            /* network/server error — silent; SSE will reconcile */
          }
          // R2 D3 — seq-paired fetch inside revert closure.
          const restoreSeq = nextVaultSeq();
          try {
            const v = await fetchVault();
            useSidebarStore.getState().setVault(v, restoreSeq);
          } catch { /* ignore */ }
        },
      });
    }

    // Sprint H R2 supremacy-audit fix (Agent 3 P6 HIGH) — wrap delete
    // flow in try/catch so any thrown error (fetch timeout, network
    // failure, JSON parse error) unlocks isDeleting. Without this, a
    // thrown error propagates into React's async-event black hole and
    // isDeleting stays true forever → panel becomes screen-reader-
    // invisible (aria-hidden) + user-interaction-locked indefinitely.
    // Return paths via collapseAfterRefetch manage isDeleting themselves
    // (success → unmount; failure → unlock + show error). The catch here
    // covers only the delete API throw itself.
    try {
      if (isEntityTask && task.entityPath) {
        const r = await deleteEntityTaskApi({ entityPath: task.entityPath });
        if (r.ok) {
          queueRestoreUndo(r.data.tombstoneId);
          await collapseAfterRefetch();
        } else {
          setDeleteError(r.error);
          setIsDeleting(false);   // R3 — unlock on delete failure too
        }
        return;
      }
      if (tasksPath && isInlineTask(task)) {
        const r = await deleteInlineTaskApi({
          tasksPath,
          line: task.line,
          expectedAction: task.action,
        });
        if (r.ok) {
          queueRestoreUndo(r.data.tombstoneId);
          await collapseAfterRefetch();
        } else {
          setDeleteError(r.error);
          setIsDeleting(false);   // R3 — unlock on delete failure too
        }
      }
    } catch (err) {
      // Delete API threw (timeout, network, parse error). Unlock the
      // panel + surface a visible message so the user can retry.
      const msg = err instanceof Error ? err.message : "Delete request failed";
      setDeleteError(`Delete failed: ${msg}`);
      setIsDeleting(false);
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
      // Sprint H R2 critic-fix (Gemini TASK-DETAIL-DEL-OVERLAY-SR MEDIUM) —
      // while deleting, the underlying panel body DOM is still present
      // (pointer-events disabled by CSS) but screen readers could still
      // navigate to interactive children. aria-hidden hides the whole
      // subtree from AT. The "Deleting…" overlay below has its own
      // aria-live region so users still get the status announcement.
      aria-hidden={isDeleting ? true : undefined}
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
          modified={task.modified}
          onSave={(v, em) => void saveField("action", v, em)}
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
          modified={task.modified}
          onSave={(v, em) => void saveField("owner", v, em)}
        />

        <EditableSelect
          label="Energy"
          value={task.energyLevel}
          options={ENERGY_OPTIONS}
          placeholder="energy level"
          readOnly={isDisabled}
          modified={task.modified}
          onSave={(v, em) => void saveField("energy-level", v, em)}
        />

        <EditableNumber
          label="Duration"
          value={task.estimatedDuration}
          placeholder="duration (min)"
          readOnly={isDisabled}
          min={0}
          modified={task.modified}
          onSave={(v, em) => void saveField("estimated-duration", v, em)}
        />

        <EditableDate
          label="Due"
          value={task.due}
          placeholder="due date"
          readOnly={isDisabled}
          modified={task.modified}
          onSave={(v, em) => void saveField("due", v, em)}
        />

        <EditableSelect
          label="Impact"
          value={task.impact}
          options={IMPACT_URGENCY_OPTIONS}
          placeholder="impact"
          readOnly={isDisabled}
          modified={task.modified}
          onSave={(v, em) => void saveField("impact", v, em)}
        />

        <EditableSelect
          label="Urgency"
          value={task.urgency}
          options={IMPACT_URGENCY_OPTIONS}
          placeholder="urgency"
          readOnly={isDisabled}
          modified={task.modified}
          onSave={(v, em) => void saveField("urgency", v, em)}
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
            modified={task.modified}
            onSave={(v, em) => void saveField("blocked-by", v, em)}
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
            modified={task.modified}
            onSave={(v, em) => void saveBody(v, em)}
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

      {mtimeConflict && (
        <div
          ref={mtimeConflictBannerRef}
          tabIndex={-1}
          className="prop-error-row prop-error-row--conflict"
          role="alert"
          aria-live="assertive"
        >
          File was edited elsewhere. Row refreshed with latest — re-apply your change to save.
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
