import chokidar, { type FSWatcher } from "chokidar";
import { join } from "path";
import { VAULT_ROOT } from "./safety.js";

/**
 * Sprint I.9 R1 — Opus P12 WATCHER-INVALIDATE-BROADCAST-TIMING (LOW) doc note:
 *
 * This watcher is a SAFETY NET for external changes (Obsidian edits, git
 * pulls, manual file edits) — it is NOT the primary cache invalidation path.
 * All in-process writers call `invalidateFile(absPath)` SYNCHRONOUSLY before
 * broadcasting their SSE event (plan §0.4 Decision 7 hard invariant). That
 * guarantees the client refetch after a writer-originated change sees the
 * fresh cache.
 *
 * When chokidar fires for an EXTERNAL change, the handler passed to
 * `startWatcher()` is expected to call `invalidateFile(absPath)` itself
 * before calling `broadcast()`. The 150ms debounce window here coalesces
 * rapid filesystem events (Obsidian frequently fires two events per save),
 * so the caller's invalidate → broadcast chain runs AT MOST once per 150ms
 * per slug. Combined with the 100ms SSE coalesce window (server/sse.ts),
 * worst-case external-change → broadcast latency is 150+100 = 250ms.
 *
 * This file intentionally does NOT call invalidateFile/broadcast directly —
 * those are the caller's responsibility — keeping this module a pure event
 * source that any consumer can wire into their own cache layer.
 */
const PROJECTS_DIR = join(VAULT_ROOT, "1-Projects");

// chokidar v5 dropped glob expansion — watch the directory with depth:2 to reach tasks/*.md
// and filter by filename or path pattern in the handler.
const WATCH_FILENAMES = new Set(["README.md", "tasks.md"]);

const DEBOUNCE_MS = 150;

function extractSlugFromPath(filePath: string): string | "all" {
  // e.g. /vault/1-Projects/agent-os/tasks.md → "agent-os"
  // e.g. /vault/1-Projects/agent-os/tasks/some-task.md → "agent-os"
  const parts = filePath.split("/");
  const projectsIdx = parts.lastIndexOf("1-Projects");
  if (projectsIdx === -1 || projectsIdx + 1 >= parts.length) return "all";
  const slug = parts[projectsIdx + 1];
  return slug && slug.length > 0 ? slug : "all";
}

function isTrackedFile(filePath: string): boolean {
  const parts = filePath.split("/");
  const filename = parts[parts.length - 1] ?? "";

  // Top-level project files (README.md, tasks.md)
  if (WATCH_FILENAMES.has(filename)) return true;

  // Entity task files: path matches …/1-Projects/<slug>/tasks/<slug>.md
  // Parent dir must be named "tasks"
  const parentDir = parts[parts.length - 2] ?? "";
  if (parentDir === "tasks" && filename.endsWith(".md")) return true;

  return false;
}

export function startWatcher(
  onChange: (slug: string | "all", absPath: string) => void
): FSWatcher {
  const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; absPath: string }>();

  // depth: 2 — watch PROJECTS_DIR, project subdirs, and tasks/ subdirs
  const watcher = chokidar.watch(PROJECTS_DIR, {
    ignoreInitial: true,
    persistent: true,
    depth: 2,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 30 },
  });

  function handleChange(filePath: string): void {
    if (!isTrackedFile(filePath)) return;

    const slug = extractSlugFromPath(filePath);

    // Debounce per slug — Obsidian often fires two events per save.
    // Sprint I.4.16 — also remember the last absPath so the cache-
    // invalidate callback can route by path when slug == "all".
    const existing = pending.get(slug);
    if (existing) clearTimeout(existing.timer);

    pending.set(slug, {
      absPath: filePath,
      timer: setTimeout(() => {
        const entry = pending.get(slug);
        pending.delete(slug);
        onChange(slug, entry?.absPath ?? filePath);
      }, DEBOUNCE_MS),
    });
  }

  watcher.on("change", handleChange);
  watcher.on("add", handleChange);
  watcher.on("unlink", handleChange);

  watcher.on("error", (err: unknown) => {
    process.stderr.write(`watcher error: ${err}\n`);
  });

  return watcher;
}
