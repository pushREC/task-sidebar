/**
 * Agenda time-bucketing logic.
 *
 * Pure functions only — no React, no I/O, no browser APIs beyond `Date`.
 * Keep this module tiny and testable. The Agenda view calls `groupIntoBuckets`
 * once per render and trusts this module for correctness of partition.
 *
 * Locked decisions:
 *   D9  — dynamic split: if tasks beyond This Week <10 → single "Upcoming"
 *         bucket; else split "Next Week" + "Later". "No date" always last.
 *   D10 — week starts Monday (ISO 8601 / Berlin locale).
 *   D17 — done tasks stay inline in their time bucket.
 *   D18 — cancelled tasks excluded (not in any bucket).
 */

import type { Task } from "../api.js";
import { diffDays, parseISODate } from "./format.js";

/** All possible bucket names. `upcoming` is mutually exclusive with
 *  `next-week` + `later` depending on D9 density split. */
export type BucketName =
  | "overdue"
  | "today"
  | "tomorrow"
  | "this-week"
  | "next-week"
  | "later"
  | "upcoming"
  | "no-date";

export const ALL_BUCKETS: readonly BucketName[] = [
  "overdue",
  "today",
  "tomorrow",
  "this-week",
  "next-week",
  "later",
  "upcoming",
  "no-date",
];

/** Buckets that always render even when empty (D12 — Overdue/Today/Tomorrow
 *  are emotionally load-bearing; absence is as meaningful as presence). */
export const ALWAYS_SHOW_EMPTY = new Set<BucketName>([
  "overdue",
  "today",
  "tomorrow",
]);

/** Buckets that default-collapse on first load (D13).
 *  `upcoming` covers the dynamic-split case; the hydrate function handles
 *  orphan names. `no-date` is intentionally EXPANDED by default — in a
 *  vault that hasn't yet adopted due-date hygiene, no-date holds most
 *  tasks, and collapsing would show the user four empty headers on first
 *  paint. User can collapse manually; future schema adoption will
 *  naturally drain this bucket. */
export const DEFAULT_COLLAPSED: readonly BucketName[] = [
  "this-week",
  "next-week",
  "later",
  "upcoming",
];

/** D9 — if tasks beyond This Week cross this threshold, split into
 *  Next Week + Later. Below it, collapse to single Upcoming bucket. */
export const DENSITY_SPLIT_THRESHOLD = 10;

/**
 * Day index for Monday-start week.
 * Date.getDay() returns 0=Sun..6=Sat; we shift to 0=Mon..6=Sun.
 */
function mondayDayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** Start-of-day for local timezone. */
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Days remaining in the current Mon–Sun week (0..6).
 * Returns 0 on Sunday (today is the last day), 6 on Monday.
 */
function daysUntilSundayInclusive(now: Date): number {
  return 6 - mondayDayIndex(now);
}

/** Days remaining in NEXT week (7..13 from today). */
function daysUntilNextSundayInclusive(now: Date): number {
  return 13 - mondayDayIndex(now);
}

/**
 * Unconditionally classify a task by its due date + status.
 * Does NOT apply the density split yet — returns the "fine-grained" bucket
 * (next-week or later). The caller applies D9 to collapse when count is low.
 *
 * Returns `null` for tasks that should be EXCLUDED from the Agenda entirely
 * (status === "cancelled" per D18). Done tasks still return a bucket (D17).
 */
export function bucketOfTaskRaw(task: Task, now: Date = new Date()): BucketName | null {
  if (task.status === "cancelled") return null;
  if (!task.due) return "no-date";

  const due = parseISODate(task.due);
  if (!due) return "no-date";

  const d = diffDays(now, due);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";

  const thisWeekDaysLeft = daysUntilSundayInclusive(now);
  if (d <= thisWeekDaysLeft) return "this-week";

  const nextWeekDaysLeft = daysUntilNextSundayInclusive(now);
  if (d <= nextWeekDaysLeft) return "next-week";

  return "later";
}

/**
 * Sort comparator for tasks within a bucket.
 * Priority order:
 *   1. Live (not-done) before done (D17 — done is strikethrough, live wins)
 *   2. In-progress before open/blocked/backlog
 *   3. Priority rank (critical < high < medium < low; null last)
 *   4. Overdue days descending (most overdue first) — only for `overdue` bucket
 *   5. Due date ascending (earlier first)
 *   6. Action text ascending (stable)
 */
const RANK_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function compareInBucket(a: Task, b: Task): number {
  // 1. Live vs done
  const aDone = a.done || a.status === "done";
  const bDone = b.done || b.status === "done";
  if (aDone !== bDone) return aDone ? 1 : -1;

  // 2. In-progress first
  const aIP = a.status === "in-progress";
  const bIP = b.status === "in-progress";
  if (aIP !== bIP) return aIP ? -1 : 1;

  // 3. Priority rank
  const ar = a.priority ? RANK_ORDER[a.priority.rank] ?? 4 : 4;
  const br = b.priority ? RANK_ORDER[b.priority.rank] ?? 4 : 4;
  if (ar !== br) return ar - br;

  // 4. Overdue: deeper-overdue first (stable for non-overdue)
  if (a.overdue && b.overdue && a.due && b.due) {
    return a.due.localeCompare(b.due); // older ISO date → more overdue → first
  }

  // 5. Due date ascending (undefined/empty last)
  if (a.due && !b.due) return -1;
  if (!a.due && b.due) return 1;
  if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);

  // 6. Tiebreaker
  return a.action.localeCompare(b.action);
}

export interface BucketGroup<T extends Task = Task> {
  bucket: BucketName;
  tasks: T[];
}

/**
 * Partition a flat task list into ordered bucket groups.
 * Generic over task type T so callers can preserve their own extensions
 * (e.g. AgendaView's EnrichedTask with projectTasksPath) without casts.
 *
 * Applies D9 density rule: collapses next-week+later into "upcoming" when
 * their combined count is below `threshold`.
 *
 * Cancelled tasks are dropped (D18). Done tasks are kept (D17).
 * Tasks are sorted within each bucket via `compareInBucket`.
 */
export function groupIntoBuckets<T extends Task>(
  tasks: T[],
  now: Date = new Date(),
  threshold: number = DENSITY_SPLIT_THRESHOLD
): BucketGroup<T>[] {
  const byBucket = new Map<BucketName, T[]>();
  for (const t of tasks) {
    const b = bucketOfTaskRaw(t, now);
    if (b === null) continue; // cancelled
    const arr = byBucket.get(b);
    if (arr) arr.push(t);
    else byBucket.set(b, [t]);
  }

  // D9 — density collapse
  const nextWeek = byBucket.get("next-week") ?? [];
  const later = byBucket.get("later") ?? [];
  if (nextWeek.length + later.length < threshold) {
    const upcoming = [...nextWeek, ...later];
    byBucket.delete("next-week");
    byBucket.delete("later");
    if (upcoming.length > 0) byBucket.set("upcoming", upcoming);
  }

  // Output order — fixed, not alphabetical
  const order: BucketName[] = [
    "overdue",
    "today",
    "tomorrow",
    "this-week",
    "next-week",
    "later",
    "upcoming",
    "no-date",
  ];

  const groups: BucketGroup<T>[] = [];
  for (const name of order) {
    const arr = byBucket.get(name);
    if (arr && arr.length > 0) {
      arr.sort(compareInBucket);
      groups.push({ bucket: name, tasks: arr });
    } else if (ALWAYS_SHOW_EMPTY.has(name)) {
      // D12 — Overdue/Today/Tomorrow always render, even empty
      groups.push({ bucket: name, tasks: [] as T[] });
    }
  }

  return groups;
}

/** Human-readable label per bucket name. */
export function bucketLabel(b: BucketName): string {
  switch (b) {
    case "overdue":
      return "Overdue";
    case "today":
      return "Today";
    case "tomorrow":
      return "Tomorrow";
    case "this-week":
      return "This week";
    case "next-week":
      return "Next week";
    case "later":
      return "Later";
    case "upcoming":
      return "Upcoming";
    case "no-date":
      return "No date";
  }
}
