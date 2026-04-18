import { ChevronRight, FolderOpen } from "lucide-react";
import type { Project } from "../api.js";
import { TaskRow } from "../components/TaskRow.js";
import { ProjectDetailPanel } from "../components/ProjectDetailPanel.js";
import { EmptyState } from "../components/EmptyState.js";
import { useSidebarStore } from "../store.js";

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

export function ProjectsView({ projects }: ProjectsViewProps) {
  const expandedProjects = useSidebarStore((s) => s.expandedProjects);
  const toggleProjectExpanded = useSidebarStore((s) => s.toggleProjectExpanded);
  const expandedProjectSlug = useSidebarStore((s) => s.expandedProjectSlug);
  const setExpandedProjectSlug = useSidebarStore((s) => s.setExpandedProjectSlug);

  const activeProjects = projects
    .filter((p) => p.status === "active")
    .sort((a, b) => {
      if (a.due && b.due) return a.due.localeCompare(b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return a.title.localeCompare(b.title);
    });

  if (activeProjects.length === 0) {
    return <EmptyState icon={FolderOpen} title="No active projects." />;
  }

  return (
    <div className="task-list" data-view="projects">
      {activeProjects.map((project) => {
        const isExpanded = expandedProjects.has(project.slug);
        const isDetailExpanded = expandedProjectSlug === project.slug;
        const openTasks = project.tasks.filter((t) => !t.done);
        const dueLabel = dueDaysLabel(project.due);

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

        return (
          <div key={project.slug} className="project-group" data-project-slug={project.slug}>
            <div
              className={`project-header${isDetailExpanded ? " project-header--detail-open" : ""}`}
              onClick={handleDetailToggle}
            >
              <button
                type="button"
                className={`project-caret${isExpanded ? " expanded" : ""}`}
                onClick={handleChevronClick}
                aria-expanded={isExpanded}
                aria-label={isExpanded ? "Collapse tasks" : "Expand tasks"}
              >
                <ChevronRight size={12} strokeWidth={2} />
              </button>
              <span className="project-title">{project.title}</span>
              {openTasks.length > 0 && (
                <span className="count-badge">{openTasks.length}</span>
              )}
              {dueLabel && (
                <span className="project-due-chip">{dueLabel}</span>
              )}
            </div>

            {isExpanded && isDetailExpanded && (
              <ProjectDetailPanel project={project} />
            )}

            {isExpanded && openTasks.length > 0 && (
              <div className="project-tasks">
                {openTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    tasksPath={project.tasksPath}
                    projects={projects}
                    indent
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
