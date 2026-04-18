/**
 * Extracts the project slug from a tasks.md path.
 * Expects the shape: …/1-Projects/<slug>/tasks.md
 * Returns the slug (the directory component immediately before "tasks.md").
 */
export function extractSlug(tasksPath: string): string {
  const parts = tasksPath.split("/");
  return parts[parts.length - 2] ?? "unknown";
}
