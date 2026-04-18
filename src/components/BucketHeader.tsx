import { ChevronDown } from "lucide-react";
import type { BucketName } from "../lib/time-buckets.js";
import { bucketLabel, ALWAYS_SHOW_EMPTY } from "../lib/time-buckets.js";

interface BucketHeaderProps {
  bucket: BucketName;
  count: number;      // task count in this bucket (live + done combined)
  liveCount: number;  // not-done count (used for the "Overdue is empty / cleared" positive signal)
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * V3A bucket header: sticky + chevron + count.
 *
 * Semantics:
 *   - Overdue / Today / Tomorrow render even when empty (D12); count shows "0".
 *   - Overdue gets accent-red text when it has live overdue tasks; muted when empty.
 *   - Chevron rotates 0deg (collapsed, pointing right-ish via CSS) / -90deg
 *     (expanded, pointing down). We store "collapsed" state so default = shown
 *     matches zero-state.
 *   - Single <button> element so keyboard focus + :focus-visible naturally apply.
 */
export function BucketHeader({
  bucket,
  count,
  liveCount,
  collapsed,
  onToggle,
}: BucketHeaderProps) {
  const label = bucketLabel(bucket);
  const isEmpty = count === 0;
  const isAlwaysShown = ALWAYS_SHOW_EMPTY.has(bucket);

  // "Overdue 0" when empty feels wrong in red; muted instead.
  const showAccent = bucket === "overdue" && liveCount > 0;

  return (
    <button
      type="button"
      className={`bucket-header bucket-header--${bucket}${showAccent ? " bucket-header--accent" : ""}${collapsed ? " bucket-header--collapsed" : ""}${isEmpty ? " bucket-header--empty" : ""}`}
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-controls={`bucket-panel-${bucket}`}
      data-bucket={bucket}
    >
      <span className="bucket-chev" aria-hidden="true">
        <ChevronDown size={12} strokeWidth={2} />
      </span>
      <span className="bucket-label">{label}</span>
      <span className="bucket-count">
        {isEmpty && isAlwaysShown ? "0" : count}
      </span>
    </button>
  );
}
