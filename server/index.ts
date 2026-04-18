import express from "express";
import type { Request, Response, NextFunction } from "express";
import { createServer as createHttpServer } from "http";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { buildVaultIndex } from "./vault-index.js";
import { startWatcher } from "./watcher.js";
import { sseHandler, broadcast } from "./sse.js";
import { taskRoutes } from "./routes.js";
import { installShutdownDrain } from "./status-reconcile-queue.js";
import {
  ensureTombstoneDir,
  cleanupOrphans,
  sweepTombstones,
  TOMBSTONE_TTL_MS,
} from "./writers/task-tombstone.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DOCS_ROOT = resolve(__dirname, "..", "docs");

async function start(): Promise<void> {
  // Sprint G R1 — drain pending 5s reconciles on graceful shutdown so
  // tasks transitioned to "done" within the window don't silently miss
  // their reconcile side-effects on server restart.
  installShutdownDrain();

  // Sprint H.3.5 — tombstone dir setup + orphan cleanup BEFORE app.listen.
  // ensureTombstoneDir is idempotent; cleanupOrphans removes any
  // tombstone older than 1h (handles prior crashes mid-window).
  await ensureTombstoneDir();
  const orphansSwept = await cleanupOrphans();
  if (orphansSwept > 0) {
    process.stderr.write(`[tombstone] startup cleanup removed ${orphansSwept} orphans\n`);
  }

  const app = express();

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });

  // Parse JSON bodies for all write routes — 32kb limit to catch oversized bodies early
  app.use("/api/tasks", express.json({ limit: "32kb" }));
  app.use("/api/projects", express.json({ limit: "32kb" }));

  // Static /docs — mounted BEFORE Vite to claim the path (Sprint 0 visual-previews artifact)
  // Scope-locked to codebases/vault-sidebar/docs; no directory traversal.
  app.use(
    "/docs",
    express.static(DOCS_ROOT, {
      fallthrough: false,
      index: "index.html",
      dotfiles: "deny",
    })
  );

  // SSE endpoint — must be registered BEFORE Vite middleware fallback
  app.get("/api/events", sseHandler);

  // Task write routes (toggle / add / edit / move)
  app.use("/api", taskRoutes);

  app.get("/api/vault", async (_req, res) => {
    try {
      const index = await buildVaultIndex();
      res.json(index);
    } catch (err) {
      process.stderr.write(`/api/vault error: ${err}\n`);
      res.status(500).json({ error: "Failed to build vault index" });
    }
  });

  // Hide framework fingerprint
  app.disable("x-powered-by");

  // JSON error middleware — must come AFTER all routes, BEFORE vite fallback
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const errType = err && typeof err === "object" && "type" in err
      ? (err as { type?: string }).type
      : undefined;
    if (errType === "entity.parse.failed") {
      res.status(400).json({ ok: false, error: "Invalid JSON body" });
      return;
    }
    if (errType === "entity.too.large") {
      res.status(413).json({ ok: false, error: "Request body too large (max 32kb)" });
      return;
    }
    console.error("[server] unhandled error:", err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  });

  app.use(vite.middlewares);

  const server = createHttpServer(app);
  server.listen(5174, "127.0.0.1", () => {
    process.stdout.write("vault-sidebar running at http://127.0.0.1:5174\n");
  });

  // Start file watcher after server is up
  const watcher = startWatcher((slug) => {
    broadcast({ type: "vault-changed", slug });
  });

  // Sprint H.3.5 — tombstone sweeper. Runs every TOMBSTONE_TTL_MS to
  // delete tombstones older than the TTL (5.5s default). unref() so the
  // interval doesn't keep Node alive at shutdown. Silent-error per run
  // (logs via the module's own stderr path on failures).
  const tombstoneSweeper = setInterval(() => {
    void sweepTombstones().catch((err) => {
      process.stderr.write(`[tombstone] sweep error: ${err}\n`);
    });
  }, TOMBSTONE_TTL_MS);
  tombstoneSweeper.unref();

  async function shutdown(signal: string): Promise<void> {
    process.stdout.write(`Received ${signal}, shutting down…\n`);
    clearInterval(tombstoneSweeper);
    // Final sweep to clean any tombstones that expired during shutdown.
    try {
      const swept = await sweepTombstones();
      if (swept > 0) {
        process.stderr.write(`[tombstone] shutdown drain swept ${swept}\n`);
      }
    } catch (err) {
      console.error("tombstone shutdown sweep failed:", err);
    }
    try {
      await watcher.close();
    } catch (err) {
      console.error("watcher close failed:", err);
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 2000).unref();
  }

  process.on("SIGINT", () => { void shutdown("SIGINT"); });
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
}

start().catch((err) => {
  process.stderr.write(`startup error: ${err}\n`);
  process.exit(1);
});
