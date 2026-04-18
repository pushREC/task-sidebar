import { useMemo } from "react";
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
  const selectedTaskId = useSidebarStore((s) => s.selectedTaskId);

  // O-1 — single source of truth for "now" across this render. Passed to
  // groupIntoBuckets (bucket classification) AND via TaskRow (relativeDue).
  // Midnight race between two independent new Date() calls is eliminated.
  const now = useMemo(() => new Date(), [projects]); // refreshes on vault updates

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
    // H-2 — aria-activedescendant pattern: the agenda itself is the listbox,
    // each row is an option with a stable id. j/k nav updates
    // activedescendant without moving browser focus, which lets us keep the
    // rest of the DOM's focus order intact (search inputs, tabs, etc.).
    <div
      className="agenda-view"
      data-view="agenda"
      role="listbox"
      aria-label="Agenda"
      aria-activedescendant={selectedTaskId ? `agenda-row-${selectedTaskId}` : undefined}
      tabIndex={-1}
    >
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
                attribute) so aria-controls on the header always resolves. */}
            <div
              id={panelId}
              className="bucket-body"
              role="group"
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
