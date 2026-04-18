import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Project } from "../api.js";
import { createEntityTaskApi } from "../api.js";
import { useSidebarStore } from "../store.js";

interface EntityCreateFormProps {
  projects: Project[];
  selectedSlug: string;
  prefillText: string;
  onClose: () => void;
  onSuccess: () => void;
}

const ENERGY_OPTIONS = ["", "low", "medium", "high"] as const;
const IMPACT_OPTIONS = ["", "very-high", "high", "medium", "low", "very-low"] as const;
const URGENCY_OPTIONS = IMPACT_OPTIONS;

export function EntityCreateForm({
  projects,
  selectedSlug,
  prefillText,
  onClose,
  onSuccess,
}: EntityCreateFormProps) {
  const defaults = useSidebarStore((s) => s.entityCreateDefaults);

  const [action, setAction] = useState(prefillText);
  const [energy, setEnergy] = useState(defaults?.energyLevel ?? "");
  const [duration, setDuration] = useState(
    defaults?.estimatedDuration !== undefined ? String(defaults.estimatedDuration) : ""
  );
  const [due, setDue] = useState(defaults?.due ?? "");
  const [impact, setImpact] = useState(defaults?.impact ?? "");
  const [urgency, setUrgency] = useState(defaults?.urgency ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const actionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    actionRef.current?.focus();
    actionRef.current?.select();
  }, []);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = action.trim();
    if (!trimmed || !selectedSlug || submitting) return;

    setSubmitting(true);
    setLastError(null);

    const durationParsed = duration ? parseInt(duration, 10) : undefined;

    const result = await createEntityTaskApi({
      slug: selectedSlug,
      action: trimmed,
      energyLevel: energy || undefined,
      estimatedDuration: durationParsed !== undefined && !isNaN(durationParsed) ? durationParsed : undefined,
      due: due || undefined,
      impact: impact || undefined,
      urgency: urgency || undefined,
    });

    setSubmitting(false);

    if (result.ok) {
      onSuccess();
    } else {
      setLastError(result.error);
    }
  }

  const activeProjects = projects.filter(
    (p) => p.status === "active" || p.status === "backlog"
  );

  return (
    <div
      className="entity-form-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Create entity task"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="entity-form-modal">
        <div className="entity-form-header">
          <span className="entity-form-title">New entity task</span>
          <button
            type="button"
            className="entity-form-close press-scale"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {lastError && (
          <div className="entity-form-error">{lastError}</div>
        )}

        <form className="entity-form-body" onSubmit={(e) => void handleSubmit(e)}>
          <div className="entity-form-field">
            <label className="entity-form-label" htmlFor="ef-action">
              action <span className="entity-form-required">*</span>
            </label>
            <input
              ref={actionRef}
              id="ef-action"
              type="text"
              className="entity-form-input"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              disabled={submitting}
              maxLength={500}
              required
            />
          </div>

          <div className="entity-form-field">
            <label className="entity-form-label" htmlFor="ef-project">project</label>
            <select
              id="ef-project"
              className="entity-form-select"
              value={selectedSlug}
              disabled
              aria-label="target project"
            >
              {activeProjects.map((p) => (
                <option key={p.slug} value={p.slug}>{p.title}</option>
              ))}
            </select>
          </div>

          <div className="entity-form-row">
            <div className="entity-form-field">
              <label className="entity-form-label" htmlFor="ef-energy">energy</label>
              <select
                id="ef-energy"
                className="entity-form-select"
                value={energy}
                onChange={(e) => setEnergy(e.target.value)}
                disabled={submitting}
                aria-label="energy level"
              >
                {ENERGY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt || "—"}</option>
                ))}
              </select>
            </div>

            <div className="entity-form-field">
              <label className="entity-form-label" htmlFor="ef-duration">duration (min)</label>
              <input
                id="ef-duration"
                type="number"
                className="entity-form-input entity-form-input--number"
                value={duration}
                min={0}
                onChange={(e) => setDuration(e.target.value)}
                disabled={submitting}
                aria-label="estimated duration in minutes"
              />
            </div>
          </div>

          <div className="entity-form-row">
            <div className="entity-form-field">
              <label className="entity-form-label" htmlFor="ef-impact">impact</label>
              <select
                id="ef-impact"
                className="entity-form-select"
                value={impact}
                onChange={(e) => setImpact(e.target.value)}
                disabled={submitting}
                aria-label="impact"
              >
                {IMPACT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt || "—"}</option>
                ))}
              </select>
            </div>

            <div className="entity-form-field">
              <label className="entity-form-label" htmlFor="ef-urgency">urgency</label>
              <select
                id="ef-urgency"
                className="entity-form-select"
                value={urgency}
                onChange={(e) => setUrgency(e.target.value)}
                disabled={submitting}
                aria-label="urgency"
              >
                {URGENCY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt || "—"}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="entity-form-field">
            <label className="entity-form-label" htmlFor="ef-due">due date</label>
            <input
              id="ef-due"
              type="date"
              className="entity-form-input entity-form-input--date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              disabled={submitting}
              aria-label="due date"
            />
          </div>

          <div className="entity-form-footer">
            <button
              type="button"
              className="entity-form-btn entity-form-btn--cancel press-scale"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="entity-form-btn entity-form-btn--submit press-scale"
              disabled={submitting || !action.trim()}
            >
              {submitting ? "Creating…" : "Create task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
