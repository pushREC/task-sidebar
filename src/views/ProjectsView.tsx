import { useEffect, useMemo, useState } from "react";
import { ChevronRight, FolderOpen, AlertTriangle, Circle } from "lucide-react";
import type { Project } from "../api.js";
import { TaskRow } from "../components/TaskRow.js";
import { ProjectDetailPanel } from "../components/ProjectDetailPanel.js";
import { EmptyState } from "../components/EmptyState.js";
import { useSidebarStore } from "../store.js";
import { epochDayKey } from "../lib/format.js";

interface ProjectsViewProps {
  projects: Project[];
}

function dueDaysLabel(due: string | undefined): string | null {
  if (!due) return null;
  const dueDate = new Date(due + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((dueDate.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "due today";
  if (diff === 1) return "due tomorrow";
  return `due in ${diff}d`;
}

// Sprint F E09 — localStorage key for "Show inactive" toggle. Kept outside
// the Zustand store (it's a purely local preference, not worth hydration
// complexity + persist migration). Safe against storage absence.
const SHOW_INACTIVE_KEY = "vault-sidebar-show-inactive";

export function ProjectsView({ projects }: ProjectsViewProps) {
  const expandedProjects = useSidebarStore((s) => s.expandedProjects);
  const toggleProjectExpanded = useSidebarStore((s) => s.toggleProjectExpanded);
  const expandedProjectSlug = useSidebarStore((s) => s.expandedProjectSlug);
  const setExpandedProjectSlug = useSidebarStore((s) => s.setExpandedProjectSlug);

  const [showInactive, setShowInactiveState] = useState<boolean>(() => {
    try { return localStorage.getItem(SHOW_INACTIVE_KEY) === "1"; } catch { return false; }
  });
  function toggleShowInactive() {
    setShowInactiveState((prev) => {
      const next = !prev;
      try { localStorage.setItem(SHOW_INACTIVE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  // C4-N + Gemini M-4 — shared `now` that only recomputes on a LOCAL
  // calendar day rollover. Prevents mid-day re-renders from shifting
  // due-chip styling unnecessarily. Matches AgendaView exactly.
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

  // E09 — if showInactive, include backlog / blocked / paused projects too
  // (never done/cancelled — those belong in 4-Archive by definition).
  const INACTIVE_STATUSES = new Set(["backlog", "blocked", "paused"]);
  const scopedProjects = projects
    .filter((p) => p.status === "active" || (showInactive && INACTIVE_STATUSES.has(p.status)))
    .sort((a, b) => {
      // Active first, then whatever the inactive order happens to be (by due).
      if (a.status !== b.status) {
        if (a.status === "active") return -1;
        if (b.status === "active") return 1;
      }
      if (a.due && b.due) return a.due.localeCompare(b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return a.title.localeCompare(b.title);
    });

  const toolbar = (
    <div className="projects-toolbar">
      <button
        type="button"
        className={`projects-toolbar__toggle press-scale${showInactive ? " projects-toolbar__toggle--active" : ""}`}
        onClick={toggleShowInactive}
        aria-pressed={showInactive}
        title="Show backlog · blocked · paused projects"
      >
        {showInactive ? "Hide inactive" : "Show inactive"}
      </button>
    </div>
  );

  if (scopedProjects.length === 0) {
    return (
      <>
        {toolbar}
        <EmptyState icon={FolderOpen} title={showInactive ? "No projects." : "No active projects."} />
      </>
    );
  }

  return (
    <div className="task-list" data-view="projects">
      {toolbar}
      {scopedProjects.map((project) => {
        const isExpanded = expandedProjects.has(project.slug);
        const isDetailExpanded = expandedProjectSlug === project.slug;
        const openTasks = project.tasks.filter((t) => !t.done);
        const dueLabel = dueDaysLabel(project.due);

        // Sprint C S06 — project health signals. Prefer server-computed
        // counts (Sprint A verified parent-goal + inferred fields); fall
        // back to client counts for robustness when server omitted them.
        const overdueN = project.tasksOverdueCount ??
          project.tasks.filter((t) => t.overdue && !t.done).length;
        const inProgressN = project.tasks.filter(
          (t) => t.status === "in-progress" && !t.done
        ).length;
        const doneN = project.tasksDoneCount ??
          project.tasks.filter((t) => t.done).length;
        const notDoneN = project.tasksNotDoneCount ??
          project.tasks.filter((t) => !t.done && t.status !== "cancelled").length;
        const totalN = doneN + notDoneN;

        // B10 — split the single click into two intents:
        //   chevron click → expand/collapse the task list (existing behavior)
        //   header-body click → toggle the project detail panel
        // Both have their own a11y: the chevron is a real <button>; the
        // header body is a second <button>. No role="button" div wrapper.
        function handleChevronClick(e: React.MouseEvent) {
          e.stopPropagation();
          toggleProjectExpanded(project.slug);
        }
        function handleDetailToggle() {
          setExpandedProjectSlug(isDetailExpanded ? null : project.slug);
        }

        const projectHeadingId = `project-heading-${project.slug}`;
        const detailPanelId = `project-detail-${project.slug}`;
        return (
          <div key={project.slug} className="project-group" data-project-slug={project.slug}>
            <div className={`project-header${isDetailExpanded ? " project-header--detail-open" : ""}`}>
              <button
                type="button"
                className={`project-caret${isExpanded ? " expanded" : ""}`}
                onClick={handleChevronClick}
                aria-expanded={isExpanded}
                aria-label={isExpanded ? "Collapse tasks" : "Expand tasks"}
              >
                <ChevronRight size={12} strokeWidth={2} />
              </button>
              {/* R4-2 — title is now a proper <button> so keyboard users can
                  Tab to it and activate with Enter/Space to toggle the
                  ProjectDetailPanel. aria-expanded tracks open-state;
                  aria-controls points to the detail region. */}
              <button
                type="button"
                className="project-title-btn"
                id={projectHeadingId}
                aria-expanded={isDetailExpanded}
                aria-controls={detailPanelId}
                onClick={handleDetailToggle}
              >
                <span className="project-title">{project.title}</span>
              </button>
              {/* Sprint C S06 — health-signal chips. Rendered only when
                  meaningful so narrow layouts stay quiet. Order matches
                  urgency: overdue > in-progress > done/total ratio. */}
              <span className="project-health" aria-label={`${overdueN} overdue, ${inProgressN} in progress, ${doneN} of ${totalN} done`}>
                {overdueN > 0 && (
                  <span className="project-health-chip project-health-chip--overdue" title={`${overdueN} overdue`}>
                    <AlertTriangle size={10} strokeWidth={2} />
                    <span>{overdueN}</span>
                  </span>
                )}
                {inProgressN > 0 && (
                  <span className="project-health-chip project-health-chip--in-progress" title={`${inProgressN} in progress`}>
                    <Circle size={8} strokeWidth={0} fill="currentColor" />
                    <span>{inProgressN}</span>
                  </span>
                )}
                {totalN > 0 && (
                  <span className="project-health-chip" title={`${doneN} of ${totalN} done`}>
                    <span>{doneN}/{totalN}</span>
                  </span>
                )}
              </span>
              {dueLabel && (
                <span className="project-due-chip">{dueLabel}</span>
              )}
            </div>

            {isExpanded && isDetailExpanded && (
              <div id={detailPanelId}>
                <ProjectDetailPanel project={project} />
              </div>
            )}

            {isExpanded && openTasks.length > 0 && (
              // Round-4: consistent aria-labelledby pattern (matches
              // AgendaView's bucket-body which labels via bucket header id).
              // role="list" is the direct parent of TaskRow role="listitem".
              <div className="project-tasks" role="list" aria-labelledby={projectHeadingId}>
                {openTasks.map((task, idx) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    tasksPath={project.tasksPath}
                    projects={projects}
                    indent
                    now={now}
                    // Sprint J.1.1 — stagger-fade-in. Cap at 30 keeps
                    // total stagger under 480ms even on huge projects.
                    style={{ "--row-index": Math.min(idx, 30) } as React.CSSProperties}
                  />
                ))}
              </div>
            )}

            {isExpanded && openTasks.length === 0 && (
              <div className="project-empty">No open tasks.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
