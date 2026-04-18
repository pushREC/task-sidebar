import { Sunrise } from "lucide-react";
import type { Task, Project } from "../api.js";
import { TaskRow } from "../components/TaskRow.js";
import { EmptyState } from "../components/EmptyState.js";

interface TodayViewProps {
  tasks: Task[];
  projects?: Project[];
}

const RANK_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function sortTodayTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    // 1. Priority rank (high → medium → low → none)
    const rankA = a.priority ? (RANK_ORDER[a.priority.rank] ?? 3) : 3;
    const rankB = b.priority ? (RANK_ORDER[b.priority.rank] ?? 3) : 3;
    if (rankA !== rankB) return rankA - rankB;

    // 2. Overdue before due-today
    if (a.overdue && !b.overdue) return -1;
    if (!a.overdue && b.overdue) return 1;

    // 3. Due today before other
    if (a.dueToday && !b.dueToday) return -1;
    if (!a.dueToday && b.dueToday) return 1;

    // 4. In-progress before other statuses
    const aInProgress = a.status === "in-progress";
    const bInProgress = b.status === "in-progress";
    if (aInProgress && !bInProgress) return -1;
    if (!aInProgress && bInProgress) return 1;

    return 0;
  });
}

export function TodayView({ tasks, projects }: TodayViewProps) {
  if (tasks.length === 0) {
    return (
      <EmptyState icon={Sunrise} title="Clean slate." hint="Nothing due today." />
    );
  }

  // Build a lookup: projectSlug → tasksPath so TaskRow can call write APIs
  const pathBySlug = new Map<string, string>(
    (projects ?? []).map((p) => [p.slug, p.tasksPath])
  );

  const sortedTasks = sortTodayTasks(tasks);

  return (
    <div className="task-list">
      {sortedTasks.map((task, index) => (
        <TaskRow
          key={task.id}
          task={task}
          isFirst={index === 0}
          tasksPath={task.projectSlug ? pathBySlug.get(task.projectSlug) : undefined}
          projects={projects}
        />
      ))}
    </div>
  );
}
