import { useRef, useState } from "react";
import { Popover } from "./Popover.js";

interface DuePopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  currentDue: string | undefined;
  onClose: () => void;
  onPick: (iso: string | null) => void;
}

/**
 * DuePopover — quick picks + custom date input.
 *
 * Presets operate in LOCAL time (Berlin, Mon-Sun week per D10).
 * "Clear" removes the due date entirely (sends null to the server,
 * which the field-edit handler interprets as "strip field").
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
/** Days until NEXT Monday (exclusive of today; always >=1, <=7). */
function daysUntilNextMonday(now: Date): number {
  // ISO weekday: Mon=1..Sun=7
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  return 8 - dow; // if Mon → 7; if Sun → 1
}

interface Preset {
  label: string;
  detail: string;
  dateFn: (now: Date) => string;
}

const PRESETS: Preset[] = [
  { label: "Today",    detail: "",      dateFn: (n) => toISO(n) },
  { label: "Tomorrow", detail: "",      dateFn: (n) => toISO(addDays(n, 1)) },
  { label: "+3 days",  detail: "",      dateFn: (n) => toISO(addDays(n, 3)) },
  { label: "Next Mon", detail: "",      dateFn: (n) => toISO(addDays(n, daysUntilNextMonday(n))) },
];

export function DuePopover({ anchorRef, currentDue, onClose, onPick }: DuePopoverProps) {
  const [customValue, setCustomValue] = useState<string>(currentDue ?? "");
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const now = new Date();

  // Codex C1-2 — a "committed" guard prevents the date input's blur
  // handler from racing against a preset/Clear click. Once any button
  // in the popover has initiated a commit, further writes from the
  // input's blur are ignored. Also: we commit on Enter only, never on
  // blur, which is what removes the race at the source.
  const committedRef = useRef(false);

  function handlePreset(iso: string) {
    if (committedRef.current) return;
    committedRef.current = true;
    onPick(iso);
    onClose();
  }

  function commitCustom(iso: string) {
    if (committedRef.current) return;
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      committedRef.current = true;
      onPick(iso);
      onClose();
    }
  }

  function handleCustomEnter() {
    commitCustom(customValue);
  }

  function handleClear() {
    if (committedRef.current) return;
    committedRef.current = true;
    onPick(null);
    onClose();
  }

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} ariaLabel="Due date">
      {PRESETS.map((preset) => {
        const iso = preset.dateFn(now);
        const active = currentDue === iso;
        return (
          <button
            key={preset.label}
            type="button"
            className={`popover-item${active ? " active" : ""}`}
            role="menuitem"
            onClick={() => handlePreset(iso)}
          >
            <span>{preset.label}</span>
            <span className="popover-item--mono">{iso.slice(5)}</span>
          </button>
        );
      })}
      <div className="popover-divider" />
      {/* Codex C1-2 + R2-C-1 — commit on change (native date picker)
          AND on Enter (keyboard typing). Both paths guarded by
          committedRef so preset/Clear clicks can't be overridden.
          The native `type=date` onChange fires when the user picks
          from the calendar widget (mouse/touch) — previously only
          Enter was a commit path, which mouse-only users never hit. */}
      <input
        ref={dateInputRef}
        type="date"
        className="popover-date-input"
        value={customValue}
        aria-label="Custom due date"
        onChange={(e) => {
          const next = e.target.value;
          setCustomValue(next);
          // Only auto-commit if the new value is a complete ISO date.
          // (Mid-typing via keyboard produces partial values like
          // "2026" or "2026-04" which should NOT commit.)
          if (next && /^\d{4}-\d{2}-\d{2}$/.test(next)) {
            commitCustom(next);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleCustomEnter();
          }
        }}
      />
      {currentDue && (
        <>
          <div className="popover-divider" />
          <button
            type="button"
            className="popover-item popover-item--destructive"
            role="menuitem"
            onClick={handleClear}
          >
            Clear due date
          </button>
        </>
      )}
    </Popover>
  );
}
