import { useMemo } from "react";
import { Inbox } from "lucide-react";
import type { Task, Project } from "../api.js";
import { TaskRow } from "../components/TaskRow.js";
import { BucketHeader } from "../components/BucketHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { useSidebarStore } from "../store.js";
import { groupIntoBuckets } from "../lib/time-buckets.js";

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

// Projects whose status means their tasks SHOULD appear in Agenda.
// Done / cancelled / archived projects are excluded so the Agenda stays
// focused on actionable work.
const AGENDA_PROJECT_STATUSES = new Set([
  "active",
  "backlog",
  "blocked",
  "paused",
  // Also accept on-track / at-risk / off-track / overdue for compat with the
  // old entity-schemas.md enum (still in use in some README files per the
  // plan's unresolved spec contradiction).
  "on-track",
  "at-risk",
  "off-track",
  "overdue",
  "not-started",
]);

interface EnrichedTask extends Task {
  projectSlug: string;
  projectTitle: string;
  projectTasksPath: string;
}

export function AgendaView({ projects }: AgendaViewProps) {
  const collapsedBuckets = useSidebarStore((s) => s.collapsedBuckets);
  const toggleBucketCollapsed = useSidebarStore((s) => s.toggleBucketCollapsed);

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
  const groups = useMemo(() => groupIntoBuckets(allTasks), [allTasks]);

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
    <div className="agenda-view" data-view="agenda">
      {groups.map((group) => {
        const collapsed = collapsedBuckets.has(group.bucket);
        const panelId = `bucket-panel-${group.bucket}`;
        return (
          <section key={group.bucket} className="bucket" data-bucket={group.bucket}>
            <BucketHeader
              bucket={group.bucket}
              count={group.tasks.length}
              liveCount={liveCounts.get(group.bucket) ?? 0}
              collapsed={collapsed}
              onToggle={() => toggleBucketCollapsed(group.bucket)}
            />
            {!collapsed && group.tasks.length > 0 && (
              <div id={panelId} className="bucket-body" role="list">
                {group.tasks.map((t, idx) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    isFirst={idx === 0}
                    tasksPath={t.projectTasksPath}
                    projects={projects}
                  />
                ))}
              </div>
            )}
            {!collapsed && group.tasks.length === 0 && (
              <div className="bucket-empty" id={panelId}>
                Nothing here.
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
