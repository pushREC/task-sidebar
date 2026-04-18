import { Popover } from "./Popover.js";

interface PriorityPopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  currentRank: "critical" | "high" | "medium" | "low" | null;
  onClose: () => void;
  onPick: (impact: string | null, urgency: string | null) => void;
}

/**
 * PriorityPopover — 4 quick levels + clear.
 *
 * Per Lock #8 priority is INFERRED, never stored. Clicking a level sets
 * BOTH impact and urgency to produce the chosen rank after server
 * inference. This is a lossy shortcut (user with high-impact + low-
 * urgency who clicks "P3" will end up with medium/medium). Detail
 * panel keeps fine-grained control.
 *
 * Mapping (from life-os priority_infer.py score tiers):
 *   P1 Critical (≥250) → very-high / very-high
 *   P2 High     (≥8)   → high      / high
 *   P3 Medium   (≥5)   → medium    / medium
 *   P4 Low      (<5)   → low       / low
 *   Clear              → strip both
 */

interface Level {
  id: "p1" | "p2" | "p3" | "p4";
  label: string;
  detail: string;
  impact: string;
  urgency: string;
}

const LEVELS: Level[] = [
  { id: "p1", label: "P1 Critical", detail: "very-high / very-high", impact: "very-high", urgency: "very-high" },
  { id: "p2", label: "P2 High",     detail: "high / high",           impact: "high",      urgency: "high"      },
  { id: "p3", label: "P3 Medium",   detail: "medium / medium",       impact: "medium",    urgency: "medium"    },
  { id: "p4", label: "P4 Low",      detail: "low / low",             impact: "low",       urgency: "low"       },
];

const RANK_TO_ID: Record<string, Level["id"] | null> = {
  critical: "p1",
  high: "p2",
  medium: "p3",
  low: "p4",
};

export function PriorityPopover({ anchorRef, currentRank, onClose, onPick }: PriorityPopoverProps) {
  const activeId = currentRank ? RANK_TO_ID[currentRank] : null;

  function handlePick(level: Level) {
    onPick(level.impact, level.urgency);
    onClose();
  }
  function handleClear() {
    onPick(null, null);
    onClose();
  }

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} ariaLabel="Priority">
      {LEVELS.map((level) => (
        <button
          key={level.id}
          type="button"
          className={`popover-item${activeId === level.id ? " active" : ""}`}
          role="menuitem"
          onClick={() => handlePick(level)}
        >
          <span>{level.label}</span>
          <span className="popover-item--mono" style={{ opacity: 0.6 }}>
            {level.detail}
          </span>
        </button>
      ))}
      {currentRank && (
        <>
          <div className="popover-divider" />
          <button
            type="button"
            className="popover-item popover-item--destructive"
            role="menuitem"
            onClick={handleClear}
          >
            Clear
          </button>
        </>
      )}
    </Popover>
  );
}
