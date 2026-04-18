/**
 * Frontend display formatters.
 *
 * Keep this module stateless and dependency-free so it stays trivially
 * testable and portable. Per plan D23: backend stores ISO YYYY-MM-DD in
 * frontmatter; frontend always shows a relative label.
 */

/** Start-of-day local time for a given Date (clones the input). */
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Whole-day difference between two dates in the user's local timezone.
 * Positive when `b` is after `a`. Always an integer (no fractional days).
 */
export function diffDays(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Parse a YYYY-MM-DD string as a LOCAL date (not UTC).
 * `new Date("2026-04-18")` would parse as UTC midnight → wrong day in
 * negative-offset zones. Explicit `T00:00:00` anchors to local midnight.
 *
 * C-5 — strict calendar validation: `new Date("2026-02-31")` silently
 * rolls to March 3; reject impossible dates by checking round-trip.
 */
export function parseISODate(iso: string): Date | null {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [yStr, mStr, dStr] = iso.split("-");
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const d = parseInt(dStr, 10);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const out = new Date(y, m - 1, d, 0, 0, 0, 0);
  if (isNaN(out.getTime())) return null;
  // Reject rollover: 2026-02-31 → March 3 fails this check.
  if (out.getFullYear() !== y || out.getMonth() !== m - 1 || out.getDate() !== d) {
    return null;
  }
  return out;
}

/**
 * Format a due date relative to `now`.
 * Output is tight, mono-friendly, tabular-nums-compatible.
 *
 * Examples (with today = Sat Apr 18):
 *   "2026-04-15" → "−3d"     (overdue by 3 days)
 *   "2026-04-18" → "today"
 *   "2026-04-19" → "+1d"     (tomorrow)
 *   "2026-04-21" → "+3d"
 *   "2026-04-27" → "Mon"     (this-week named weekday)
 *   "2026-05-04" → "+16d"    (further out but <60d)
 *   "2026-09-01" → "Sep 1"   (>60d → compact month-day)
 *   undefined    → "—"
 */
export function relativeDue(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const due = parseISODate(iso);
  if (!due) return "—";
  const d = diffDays(now, due);
  if (d < 0) return `−${Math.abs(d)}d`;          // Unicode minus (U+2212) for typographic correctness
  if (d === 0) return "today";
  if (d === 1) return "+1d";
  if (d <= 6) return due.toLocaleDateString("en-US", { weekday: "short" }); // Mon / Tue / …
  if (d <= 60) return `+${d}d`;
  // O-3 — include 2-digit year for dates >365 days away to disambiguate
  // "Sep 1 (which year?)". Same-year far-dates still show "Sep 1".
  if (d > 365) {
    return due.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "2-digit",
    });
  }
  return due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Format a past timestamp as a relative "Nd ago" / "Nh ago" / "just now".
 * Used for created/modified stamps in the detail panel breadcrumb (Sprint E).
 */
export function relativeAge(
  isoOrMs: string | number | Date | undefined,
  now: Date = new Date()
): string {
  if (!isoOrMs) return "—";
  const t =
    typeof isoOrMs === "number"
      ? new Date(isoOrMs)
      : isoOrMs instanceof Date
      ? isoOrMs
      : new Date(isoOrMs);
  if (isNaN(t.getTime())) return "—";
  const sec = Math.max(0, Math.round((now.getTime() - t.getTime()) / 1000));
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.round(mo / 12);
  return `${yr}y ago`;
}
