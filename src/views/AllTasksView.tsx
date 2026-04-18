import { useState } from "react";
import { Search, Inbox } from "lucide-react";
import type { Project } from "../api.js";
import { TaskRow } from "../components/TaskRow.js";
import { EmptyState } from "../components/EmptyState.js";

interface AllTasksViewProps {
  projects: Project[];
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export function AllTasksView({ projects, searchInputRef }: AllTasksViewProps) {
  const [query, setQuery] = useState("");

  const activeProjects = projects.filter((p) => p.status === "active");

  const lowerQuery = query.toLowerCase();

  const grouped = activeProjects
    .map((project) => {
      const projectMatches =
        lowerQuery !== "" && project.title.toLowerCase().includes(lowerQuery);
      const openTasks = project.tasks.filter(
        (t) =>
          !t.done &&
          (lowerQuery === "" ||
            projectMatches ||
            t.action.toLowerCase().includes(lowerQuery))
      );
      return { project, openTasks };
    })
    .filter((g) => g.openTasks.length > 0);

  const totalVisible = grouped.reduce((sum, g) => sum + g.openTasks.length, 0);

  return (
    <div className="task-list" data-view="tasks">
      <div className="search-bar">
        <input
          ref={searchInputRef}
          className="search-input"
          type="search"
          placeholder="Search tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search tasks"
        />
      </div>

      {totalVisible === 0 && query && (
        <EmptyState icon={Search} title="No matches." hint="Try a shorter query." />
      )}
      {totalVisible === 0 && !query && (
        <EmptyState icon={Inbox} title="Nothing open." />
      )}

      {grouped.map(({ project, openTasks }) => (
        <div key={project.slug} className="task-group">
          {/* H10 — semantic heading for group labels */}
          <h3 className="group-header" data-project-slug={project.slug}>
            {project.title}
          </h3>
          {openTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              tasksPath={project.tasksPath}
              projects={projects}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
