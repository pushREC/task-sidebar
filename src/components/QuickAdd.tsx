import { useRef, useState } from "react";
import { CornerDownLeft, FileText } from "lucide-react";
import type { Project } from "../api.js";
import { addTaskApi } from "../api.js";
import { EntityCreateForm } from "./EntityCreateForm.js";

interface QuickAddProps {
  projects: Project[];
  defaultSlug: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function QuickAdd({ projects, defaultSlug, inputRef }: QuickAddProps) {
  const activeProjects = projects.filter(
    (p) => p.status === "active" || p.status === "backlog"
  );

  const [text, setText] = useState("");
  const [selectedSlug, setSelectedSlug] = useState(defaultSlug);
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [entityMode, setEntityMode] = useState(false);
  const [showEntityForm, setShowEntityForm] = useState(false);
  const internalRef = useRef<HTMLInputElement>(null);
  const resolvedRef = (inputRef as React.RefObject<HTMLInputElement | null>) ?? internalRef;

  async function handleInlineSubmit() {
    const trimmed = text.trim();
    if (!trimmed || !selectedSlug || submitting) return;

    // B08 — client-side mirror of the server ≥3-char rule. Quietly no-ops
    // on keystroke dust (single `j` or `a` that bleeds through the global
    // shortcut handler) so users don't see a confusing server error.
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
    } else {
      setLastError(result.error);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (entityMode) {
        // Open entity form prefilled with current text
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
          <select
            className="quick-add-select"
            value={effectiveSlug}
            onChange={(e) => setSelectedSlug(e.target.value)}
            disabled={submitting}
            aria-label="Target project"
          >
            {activeProjects.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title}
              </option>
            ))}
          </select>
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
            className={`quick-add-entity-btn${entityMode ? " active" : ""}`}
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
