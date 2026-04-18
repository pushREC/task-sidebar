import { useEffect, useMemo, useState } from "react";
import { Inbox } from "lucide-react";
import type { Task, Project } from "../api.js";
import { TaskRow } from "../components/TaskRow.js";
import { BucketHeader } from "../components/BucketHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { useSidebarStore } from "../store.js";
import { groupIntoBuckets } from "../lib/time-buckets.js";
import { AGENDA_PROJECT_STATUSES } from "../lib/project-scopes.js";

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

interface EnrichedTask extends Task {
  projectSlug: string;
  projectTitle: string;
  projectTasksPath: string;
}

export function AgendaView({ projects }: AgendaViewProps) {
  const collapsedBuckets = useSidebarStore((s) => s.collapsedBuckets);
  const toggleBucketCollapsed = useSidebarStore((s) => s.toggleBucketCollapsed);

  // O-1 + O1-N — single source of truth for "now" across this render.
  // Refreshes on vault updates AND every 60s via a tick counter, so a
  // long-running sidebar doesn't hold a stale midnight boundary.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [projects, nowTick]);

  // Flatten all eligible tasks with project metadata attached.
  const allTasks = useMemo<EnrichedTask[]>(() => {
    const out: EnrichedTask[] = [];
    for (const p of projects) {
      if (!AGENDA_PROJECT_STATUSES.has(p.status)) continue;
      for (const t of p.tasks) {
        out.push({
          ...t,
          projectSlug: p.slug,
          projectTitle: p.title,
          projectTasksPath: p.tasksPath,
        });
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
    // Round-2 simplification: semantic role="list" with role="listitem"
    // children. j/k keyboard nav is a VISUAL selection overlay, not an
    // ARIA listbox. Screen readers navigate the list naturally via DOM
    // order. This removes the tabIndex/activedescendant/hidden-target
    // complexity that round-1's listbox pattern introduced.
    <div className="agenda-view" data-view="agenda" role="list" aria-label="Agenda">
      {groups.map((group) => {
        const collapsed = collapsedBuckets.has(group.bucket);
        const panelId = `bucket-panel-${group.bucket}`;
        const headingId = `bucket-heading-${group.bucket}`;
        return (
          // C-1 — single [data-bucket] node per bucket (on the <section>);
          // BucketHeader must NOT also emit data-bucket.
          <section
            key={group.bucket}
            className="bucket"
            data-bucket={group.bucket}
            aria-labelledby={headingId}
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
                role="group" dropped in round-2; the section itself is the
                semantic grouping (aria-labelledby → header). */}
            <div
              id={panelId}
              className="bucket-body"
              hidden={collapsed}
            >
              {group.tasks.length > 0 ? (
                group.tasks.map((t, idx) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    isFirst={idx === 0}
                    tasksPath={t.projectTasksPath}
                    projects={projects}
                    now={now}
                  />
                ))
              ) : (
                <div className="bucket-empty">Nothing here.</div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
