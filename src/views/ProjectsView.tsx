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

        function handleHeaderClick() {
          toggleProjectExpanded(project.slug);
          // When expanding, also show detail panel; when collapsing, hide it
          if (!isExpanded) {
            setExpandedProjectSlug(project.slug);
          } else {
            setExpandedProjectSlug(null);
          }
        }

        function handleHeaderKeyDown(e: React.KeyboardEvent) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleHeaderClick();
          }
          if (e.key === "Escape" && isDetailExpanded) {
            e.preventDefault();
            setExpandedProjectSlug(null);
          }
        }

        return (
          <div key={project.slug} className="project-group" data-project-slug={project.slug}>
            <div
              className={`project-header${isDetailExpanded ? " project-header--detail-open" : ""}`}
              role="button"
              tabIndex={0}
              onClick={handleHeaderClick}
              onKeyDown={handleHeaderKeyDown}
              aria-expanded={isExpanded}
            >
              <span className={`project-caret${isExpanded ? " expanded" : ""}`}>
                <ChevronRight size={12} strokeWidth={2} />
              </span>
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
