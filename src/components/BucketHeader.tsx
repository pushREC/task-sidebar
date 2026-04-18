import { ChevronDown } from "lucide-react";
import type { BucketName } from "../lib/time-buckets.js";
import { bucketLabel, ALWAYS_SHOW_EMPTY } from "../lib/time-buckets.js";

interface BucketHeaderProps {
  bucket: BucketName;
  headingId: string;   // H-2 / M-1 — aria-labelledby target on the <section>
  panelId: string;     // M-2 — aria-controls target on the body (always in DOM)
  count: number;       // task count in this bucket (live + done combined)
  liveCount: number;   // not-done count (drives Overdue's accent mode)
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * V3A bucket header: sticky + chevron + count.
 *
 * Single <button> so keyboard focus + :focus-visible naturally apply.
 * C-1 — deliberately does NOT emit `data-bucket`; the parent <section>
 * carries it as the canonical DOM marker for bucket-level nav queries.
 * M-7 — when Overdue has live tasks, a visually-hidden "Urgent" word
 * travels to screen readers so the red-accent signal isn't color-only.
 */
export function BucketHeader({
  bucket,
  headingId,
  panelId,
  count,
  liveCount,
  collapsed,
  onToggle,
}: BucketHeaderProps) {
  const label = bucketLabel(bucket);
  const isEmpty = count === 0;
  const isAlwaysShown = ALWAYS_SHOW_EMPTY.has(bucket);
  const showAccent = bucket === "overdue" && liveCount > 0;
  const displayCount = isEmpty && isAlwaysShown ? "0" : String(count);

  return (
    <button
      id={headingId}
      type="button"
      className={`bucket-header bucket-header--${bucket}${showAccent ? " bucket-header--accent" : ""}${collapsed ? " bucket-header--collapsed" : ""}${isEmpty ? " bucket-header--empty" : ""}`}
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-controls={panelId}
    >
      <span className="bucket-chev" aria-hidden="true">
        <ChevronDown size={12} strokeWidth={2} />
      </span>
      <span className="bucket-label">{label}</span>
      {showAccent && <span className="sr-only">{` — urgent, ${liveCount} live task${liveCount === 1 ? "" : "s"}`}</span>}
      <span className="bucket-count" aria-hidden={isEmpty ? "true" : undefined}>
        {displayCount}
      </span>
    </button>
  );
}
