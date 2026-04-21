import { useEffect, useMemo, useState } from "react";
import { Inbox } from "lucide-react";
import type { Task, Project } from "../api.js";
import { TaskRow } from "../components/TaskRow.js";
import { BucketHeader } from "../components/BucketHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { useSidebarStore } from "../store.js";
import { groupIntoBuckets } from "../lib/time-buckets.js";
import { AGENDA_PROJECT_STATUSES } from "../lib/project-scopes.js";
import { epochDayKey } from "../lib/format.js";

/**
 * Agenda view — time-bucketed cross-project task list.
 *
 * Replaces both the old TodayView and AllTasksView. Answers the user's #1
 * stated need: "what's overdue / due today / due tomorrow / this week
 * without opening the project/task manager."
 *
 * Source: walks `vault.projects[].tasks` across active/backlog/blocked/paused
 * projects. Cancelled tasks and done-project tasks are excluded.
 */
interface AgendaViewProps {
  projects: Project[];
}

// Sprint I.1.3 — generic `Enriched<T>` preserves the discriminated Task
// union through view-layer enrichment. `interface EnrichedTask extends Task`
// fails on a union type because TypeScript can't extend `InlineTask | EntityTask`
// with a single interface (no statically-known members across the union).
// Generic intersection distributes: `Enriched<InlineTask | EntityTask>` =
// `Enriched<InlineTask> | Enriched<EntityTask>`, preserving narrowing on `source`.
export type Enriched<T extends Task> = T & {
  projectSlug: string;
  projectTitle: string;
  projectTasksPath: string;
};

export function AgendaView({ projects }: AgendaViewProps) {
  const collapsedBuckets = useSidebarStore((s) => s.collapsedBuckets);
  const toggleBucketCollapsed = useSidebarStore((s) => s.toggleBucketCollapsed);

  // O-1 + O1-N + Gemini M-4 — single "now" source. Recomputes only when
  // the local calendar day changes (not every 60s). Prevents full
  // re-bucket jank + focus loss on mid-day refreshes. A short 60s tick
  // checks whether the day rolled over; in the 99.9% case it's a no-op.
  const [epochDay, setEpochDay] = useState(() => epochDayKey(new Date()));
  useEffect(() => {
    const id = setInterval(() => {
      const key = epochDayKey(new Date());
      setEpochDay((prev) => (prev === key ? prev : key));
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [projects, epochDay]);

  // Flatten all eligible tasks with project metadata attached.
  const allTasks = useMemo<Enriched<Task>[]>(() => {
    const out: Enriched<Task>[] = [];
    for (const p of projects) {
      if (!AGENDA_PROJECT_STATUSES.has(p.status)) continue;
      for (const t of p.tasks) {
        out.push({
          ...t,
          projectSlug: p.slug,
          projectTitle: p.title,
          projectTasksPath: p.tasksPath,
        } as Enriched<Task>);
      }
    }
    return out;
  }, [projects]);

  // Group into time buckets. This is cheap for 2k tasks; no memo needed
  // beyond React's natural batching.
  const groups = useMemo(() => groupIntoBuckets(allTasks, now), [allTasks, now]);

  // Count live (not-done) tasks per bucket for the "Overdue is empty" signal
  const liveCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of groups) {
      m.set(g.bucket, g.tasks.filter((t) => !t.done && t.status !== "done").length);
    }
    return m;
  }, [groups]);

  if (allTasks.length === 0) {
    return <EmptyState icon={Inbox} title="Nothing on the agenda." hint="Quick-add with `a`." />;
  }

  return (
    // Round-3 fix (Gemini H-1 / Opus H-2): role="list" MUST be the direct
    // parent of role="listitem" per ARIA spec. Intermediate <section>
    // elements break the relationship. So role="list" now lives on the
    // bucket-body (direct parent), and agenda-view is a plain container.
    <div className="agenda-view" data-view="agenda">
      {groups.map((group) => {
        const collapsed = collapsedBuckets.has(group.bucket);
        const panelId = `bucket-panel-${group.bucket}`;
        const headingId = `bucket-heading-${group.bucket}`;
        return (
          // C-1 — single [data-bucket] node per bucket (on the <section>);
          // BucketHeader must NOT also emit data-bucket.
          // Round-3: the ARIA grouping moved down to the bucket-body
          // role="list"; the <section> is just visual structure.
          <section
            key={group.bucket}
            className="bucket"
            data-bucket={group.bucket}
          >
            <BucketHeader
              bucket={group.bucket}
              headingId={headingId}
              panelId={panelId}
              count={group.tasks.length}
              liveCount={liveCounts.get(group.bucket) ?? 0}
              collapsed={collapsed}
              onToggle={() => toggleBucketCollapsed(group.bucket)}
            />
            {/* M-2 — bucket-body stays in the DOM when collapsed (hidden
                attribute) so aria-controls on the header always resolves.
                Round-3 Gemini H-1 / Opus H-2 — role="list" is the DIRECT
                parent of listitems; no intervening <section> breaking the
                ARIA tree. aria-labelledby names the list by its header.
                Round-4 R4-1 — role="list" applied only when tasks exist;
                an empty bucket renders as a plain region so a
                non-listitem child (.bucket-empty) doesn't violate the
                "list must contain listitems" ARIA constraint. */}
            {group.tasks.length > 0 ? (
              // Sprint I.2.1 — lazy-mount: children only in React tree
              // when expanded. `hidden` attribute alone kept them mounted
              // (~13 DOM nodes per TaskRow × 2k tasks = 26k wasted). Now
              // collapsed buckets emit zero TaskRow fiber. DOM node count
              // scales with VISIBLE rows only. Panel div stays mounted for
              // aria-controls resolution (BucketHeader references panelId).
              // Preempt B3: QuickAdd remains at App.tsx level (unchanged).
              <div
                id={panelId}
                className="bucket-body"
                role="list"
                aria-labelledby={headingId}
                hidden={collapsed}
              >
                {!collapsed && group.tasks.map((t, idx) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    isFirst={idx === 0}
                    tasksPath={t.projectTasksPath}
                    projects={projects}
                    now={now}
                  />
                ))}
              </div>
            ) : (
              <div
                id={panelId}
                className="bucket-body"
                aria-labelledby={headingId}
                hidden={collapsed}
              >
                {!collapsed && <div className="bucket-empty">Nothing here.</div>}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
