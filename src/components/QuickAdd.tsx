import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, FileText } from "lucide-react";
import type { Project } from "../api.js";
import { addTaskApi } from "../api.js";
import { EntityCreateForm } from "./EntityCreateForm.js";
import { useSidebarStore } from "../store.js";
import { fuzzyFilter } from "../lib/fuzzy.js";

interface QuickAddProps {
  projects: Project[];
  defaultSlug: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function QuickAdd({ projects, defaultSlug, inputRef }: QuickAddProps) {
  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === "active" || p.status === "backlog"),
    [projects]
  );

  // F09 — smart default target: the currently-expanded project (if user
  // is viewing one), else last-used, else the passed defaultSlug.
  const expandedProjectSlug = useSidebarStore((s) => s.expandedProjectSlug);
  const lastQuickAddSlug = useRef<string | null>(null);

  const smartDefault = useMemo(() => {
    if (expandedProjectSlug && activeProjects.some((p) => p.slug === expandedProjectSlug)) {
      return expandedProjectSlug;
    }
    if (lastQuickAddSlug.current && activeProjects.some((p) => p.slug === lastQuickAddSlug.current)) {
      return lastQuickAddSlug.current;
    }
    return defaultSlug;
  }, [expandedProjectSlug, defaultSlug, activeProjects]);

  const [text, setText] = useState("");
  const [selectedSlug, setSelectedSlug] = useState(smartDefault);
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [entityMode, setEntityMode] = useState(false);
  const [showEntityForm, setShowEntityForm] = useState(false);

  // F08 — combobox state
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerActiveIdx, setPickerActiveIdx] = useState(0);
  const pickerBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const internalRef = useRef<HTMLInputElement>(null);
  const resolvedRef = (inputRef as React.RefObject<HTMLInputElement | null>) ?? internalRef;
  const pickerInputRef = useRef<HTMLInputElement | null>(null);

  // Re-sync selectedSlug when smartDefault changes (user navigates to new
  // project in ProjectsView, expands it → QuickAdd follows).
  useEffect(() => {
    setSelectedSlug(smartDefault);
    setPickerQuery("");
  }, [smartDefault]);

  async function handleInlineSubmit() {
    const trimmed = text.trim();
    if (!trimmed || !selectedSlug || submitting) return;

    // B08 — client-side mirror of the server ≥3-char rule.
    if (trimmed.length < 3) {
      setLastError("Task must be at least 3 characters.");
      return;
    }

    setSubmitting(true);
    setLastError(null);

    const result = await addTaskApi({ slug: selectedSlug, text: trimmed });

    setSubmitting(false);

    if (result.ok) {
      setText("");
      lastQuickAddSlug.current = selectedSlug;
    } else {
      setLastError(result.error);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (entityMode) {
        setShowEntityForm(true);
      } else {
        void handleInlineSubmit();
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setText("");
      setLastError(null);
      resolvedRef.current?.blur();
    }
  }

  function handleEntityFormClose() {
    setShowEntityForm(false);
    resolvedRef.current?.focus();
  }

  function handleEntityFormSuccess() {
    setShowEntityForm(false);
    setText("");
    resolvedRef.current?.focus();
  }

  // ── F08 combobox behavior ─────────────────────────────────────────────────

  const filtered = useMemo(
    () => fuzzyFilter(activeProjects, pickerQuery, (p) => p.title, 20),
    [activeProjects, pickerQuery]
  );

  const currentProject = activeProjects.find((p) => p.slug === selectedSlug) ?? activeProjects[0];
  const pickerDisplay = pickerOpen ? pickerQuery : currentProject?.title ?? "";

  function openPicker() {
    setPickerQuery("");
    setPickerOpen(true);
    setPickerActiveIdx(0);
  }
  function closePicker() {
    setPickerOpen(false);
    setPickerQuery("");
  }
  function selectPickerIdx(idx: number) {
    const hit = filtered[idx];
    if (!hit) return;
    setSelectedSlug(hit.item.slug);
    lastQuickAddSlug.current = hit.item.slug;
    closePicker();
    resolvedRef.current?.focus();
  }
  function handlePickerKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPickerActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPickerActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectPickerIdx(pickerActiveIdx);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePicker();
    }
  }
  function handlePickerBlur() {
    // Defer close so clicks on list items register first.
    if (pickerBlurTimer.current !== null) clearTimeout(pickerBlurTimer.current);
    pickerBlurTimer.current = setTimeout(() => {
      closePicker();
    }, 120);
  }
  function handlePickerListMouseDown() {
    // Cancel the blur-driven close if the user clicks inside the list.
    if (pickerBlurTimer.current !== null) {
      clearTimeout(pickerBlurTimer.current);
      pickerBlurTimer.current = null;
    }
  }

  useEffect(() => {
    return () => {
      if (pickerBlurTimer.current !== null) clearTimeout(pickerBlurTimer.current);
    };
  }, []);

  if (activeProjects.length === 0) return null;

  const effectiveSlug =
    activeProjects.some((p) => p.slug === selectedSlug)
      ? selectedSlug
      : (activeProjects[0]?.slug ?? "");

  return (
    <>
      {showEntityForm && (
        <EntityCreateForm
          projects={projects}
          selectedSlug={effectiveSlug}
          prefillText={text}
          onClose={handleEntityFormClose}
          onSuccess={handleEntityFormSuccess}
        />
      )}
      <div className="quick-add">
        {lastError && (
          <div className="quick-add-error" role="alert" aria-live="assertive">
            {lastError}
          </div>
        )}
        <div className="quick-add-row">
          {/* Sprint C F08 — fuzzy combobox replacing the native <select>.
              Closed state shows current project title. Click / focus
              opens the filtered list. Keyboard: arrows + Enter + Esc. */}
          <div className="combobox-wrap">
            <input
              ref={pickerInputRef}
              type="text"
              className="combobox-input"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={pickerOpen}
              aria-controls="combobox-list"
              aria-activedescendant={
                pickerOpen && filtered.length > 0
                  ? `combobox-option-${pickerActiveIdx}`
                  : undefined
              }
              aria-label="Target project"
              value={pickerDisplay}
              placeholder={currentProject?.title ?? "Project"}
              disabled={submitting}
              onFocus={openPicker}
              onChange={(e) => {
                setPickerQuery(e.target.value);
                setPickerOpen(true);
                setPickerActiveIdx(0);
              }}
              onKeyDown={handlePickerKeyDown}
              onBlur={handlePickerBlur}
            />
            {pickerOpen && (
              <div
                id="combobox-list"
                className="combobox-list"
                role="listbox"
                onMouseDown={handlePickerListMouseDown}
                onTouchStart={handlePickerListMouseDown}
              >
                {filtered.length === 0 ? (
                  <div className="combobox-option combobox-option--empty">
                    No matching projects
                  </div>
                ) : (
                  filtered.map((hit, idx) => (
                    <div
                      key={hit.item.slug}
                      id={`combobox-option-${idx}`}
                      role="option"
                      aria-selected={idx === pickerActiveIdx}
                      className={`combobox-option${idx === pickerActiveIdx ? " active" : ""}`}
                      onMouseEnter={() => setPickerActiveIdx(idx)}
                      onMouseDown={(e) => {
                        // Use mousedown (fires before input blur) so the
                        // selection lands before the picker closes on blur.
                        e.preventDefault();
                        selectPickerIdx(idx);
                      }}
                      onTouchEnd={(e) => {
                        e.preventDefault();
                        selectPickerIdx(idx);
                      }}
                    >
                      {hit.item.title}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <input
            ref={resolvedRef}
            className={`quick-add-input${entityMode ? " quick-add-input--entity-mode" : ""}`}
            placeholder={entityMode ? "Entity task…" : "Add task…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={submitting}
            maxLength={500}
            aria-label={entityMode ? "New entity task text" : "New task text"}
          />
          <button
            type="button"
            className={`quick-add-entity-btn press-scale${entityMode ? " active" : ""}`}
            onClick={() => setEntityMode((v) => !v)}
            aria-label={entityMode ? "Switch to inline task mode" : "Switch to entity task mode"}
            aria-pressed={entityMode}
            title={entityMode ? "Entity mode on — creates canonical file" : "Entity mode off — creates inline checkbox"}
          >
            <FileText size={12} strokeWidth={1.5} />
          </button>
          <span className="quick-add-hint" aria-hidden="true">
            <CornerDownLeft size={12} strokeWidth={1.5} />
          </span>
        </div>
      </div>
    </>
  );
}
