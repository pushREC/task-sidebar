/**
 * Sprint I.4.1 — in-memory vault cache.
 *
 * Problem it solves: every /api/vault request triggers buildVaultIndex()
 * which globs every project dir, reads every README.md + tasks.md, parses
 * every entity task file, resolves goal-timeframes per project, and
 * computes priority for every task with signal. On the real vault (50
 * projects, ~100 tasks) this takes ~18ms p50 with a 600KB response.
 * Target: < 5ms p50 by serving a cached snapshot.
 *
 * Design — v1 (this implementation):
 *   - Single module-level `cached: VaultIndex | null` snapshot.
 *   - `getVault()` returns the cached snapshot synchronously. Throws if
 *     not yet built (only happens if a route fires before buildInitial()
 *     completes; server/index.ts guarantees buildInitial() awaited
 *     BEFORE app.listen — plan §14.14.5 T16/I.4.15).
 *   - `invalidateProject(slug)` + `invalidateFile(absPath)` both do a
 *     FULL vault rebuild (v1 simplicity). Optimization to per-slug
 *     rebuild deferred; the hit-path win (warm /api/vault ~5ms) is
 *     already achieved.
 *   - `startSanityRebuild(intervalMs)` setInterval that rebuilds +
 *     logs delta count for drift detection (external chokidar misses).
 *
 * Invariants enforced (Sprint I.4 preempt B5 + plan §0.4 Decision 7):
 *   - Writer-synchronous: every writer calls `await invalidateProject(slug)`
 *     BEFORE emitting SSE `vault-changed` broadcast. Cache is always as
 *     fresh as the last completed write.
 *   - B5 symmetric: BOTH delete success AND restore success call
 *     invalidateProject (delete in task-delete.ts; restore in
 *     task-tombstone.ts restoreFromTombstone).
 *   - Client pairs every `fetchVault()` call with `nextVaultSeq()`
 *     per Sprint H R2 D3 — out-of-order responses already dropped by
 *     store.maxAppliedVaultSeq.
 */

import { buildVaultIndex, type VaultIndex } from "./vault-index.js";
import { VAULT_ROOT } from "./safety.js";

// ─── Module-level state ───────────────────────────────────────────────────
let cached: VaultIndex | null = null;
// Sprint I.4.2 polish — pre-serialized JSON string so /api/vault skips
// JSON.stringify on every hit. 600KB serialize was the dominant cost
// after the cache landed (full rebuild eliminated, serialize remained).
let cachedJson: string | null = null;
let initialBuilt = false;

// Sprint I.9 R1 fixes — monotonic generation token + dirty-flag queue
// + setCache out-of-order guard. Three merged findings:
//
//   Opus P5 / Codex SANITY-REBUILD-CLOBBER (CRITICAL): sanity-rebuild's
//     stale snapshot could setCache() AFTER a concurrent writer-invalidate
//     finished, overwriting fresh data with disk state read 500ms earlier.
//     FIX: setCache now takes a generation token; stale gens are rejected.
//
//   Codex CACHE-COALESCE-DROPS-LATE-WRITE (HIGH): writer B's invalidate
//     arriving mid-flight of writer A's rebuild would skip its own rebuild,
//     awaiting A's promise. If B's file write landed AFTER A's disk read,
//     the cache never sees B. FIX: mid-flight invalidate sets `dirty` flag
//     so the current rebuild runs a follow-up after completion, reading
//     fresh disk state.
let currentGeneration = 0;
let latestStartedGeneration = 0;

// Concurrency guard: serialize invalidate calls so two back-to-back writes
// don't both trigger full rebuilds in parallel (wasteful). The last caller
// wins; concurrent callers all await the same in-flight rebuild promise.
let rebuildInFlight: Promise<void> | null = null;
let dirty = false;

function setCache(next: VaultIndex, gen: number): void {
  // Reject out-of-order updates. Without this guard, sanity-rebuild's
  // 500ms-old snapshot can overwrite a fresh writer-rebuild that landed
  // at T+0ms, leaving the cache with pre-write state.
  if (gen < currentGeneration) return;
  currentGeneration = gen;
  cached = next;
  // JSON.stringify on cache update (writer-path, ~3-5ms) instead of on
  // every read (~3-5ms × every /api/vault hit). Trades writer-path cost
  // for massive read-path win — reads become memcpy-only.
  cachedJson = JSON.stringify(next);
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Return the current cached vault snapshot. MUST call buildInitial()
 * before this or it throws. server/index.ts guarantees this via
 * `await buildInitial()` before `app.listen(port)`.
 */
export function getVault(): VaultIndex {
  if (!cached || !initialBuilt) {
    throw new Error(
      "vault-cache: getVault() called before buildInitial() completed. " +
      "server/index.ts must await buildInitial() before app.listen().",
    );
  }
  return cached;
}

/**
 * Pre-serialized JSON string of the cache. Used by the /api/vault route
 * to skip JSON.stringify on every hit. Returns null if cache not yet built.
 */
export function getVaultJson(): string | null {
  return cachedJson;
}

/**
 * Full vault rebuild. Called at server startup BEFORE app.listen so the
 * first request never races an empty cache.
 *
 * Idempotent: calling after the initial build does a fresh rebuild
 * (equivalent to invalidateProject for any slug — same cost in v1).
 */
export async function buildInitial(): Promise<void> {
  const start = Date.now();
  const gen = ++latestStartedGeneration;
  const next = await buildVaultIndex();
  setCache(next, gen);
  initialBuilt = true;
  const ms = Date.now() - start;
  process.stderr.write(`[vault-cache] buildInitial: ${next.projects.length} projects in ${ms}ms\n`);
}

/**
 * Invalidate + rebuild because a writer just mutated a vault file for
 * the given project slug. Synchronous-semantically: callers `await`
 * this BEFORE emitting their SSE broadcast (plan §0.4 Decision 7).
 *
 * v1 implementation: full rebuild. Optimization to per-slug rebuild
 * deferred; current vault sizes (50 projects, ~100 tasks) rebuild in
 * ~18ms which is acceptable on the write-path (not the read-path).
 *
 * Sprint I.9 R1 hardening:
 *   - Mid-flight invalidate sets `dirty` flag so the current rebuild
 *     runs a follow-up after completion. This closes the Codex-flagged
 *     CACHE-COALESCE-DROPS-LATE-WRITE race where writer B's file write
 *     landed after writer A's rebuild's disk read.
 *   - Each rebuild claims a monotonic generation; setCache rejects
 *     stale gens, so sanity-rebuild can't clobber fresh cache (Opus P5
 *     CRITICAL).
 */
// Sprint I.9 R2 — Codex CACHE-DIRTY-STARVATION (HIGH): under pathological
// continuous-invalidate pressure (writer arrives during every rebuild
// window), the do-while dirty loop could theoretically never terminate,
// leaving rebuildInFlight unresolved and starving waiting callers. Cap the
// loop at MAX_REBUILD_ITERATIONS; if exceeded, log a warning and exit —
// the next invalidate or the 60s sanity-rebuild timer will catch any residual
// staleness. In practice vault-sidebar's user-driven load is 1-2 invalidates/sec
// with 18ms rebuilds, so the cap is belt-and-suspenders, never hit under
// realistic use.
const MAX_REBUILD_ITERATIONS = 10;

export async function invalidateProject(_slug: string): Promise<void> {
  if (rebuildInFlight) {
    // Mark dirty so the current rebuild schedules a follow-up after
    // it completes. Without this, writer B's invalidate would silently
    // await A's rebuild and return — but A's rebuild may have read
    // disk BEFORE B's write landed.
    dirty = true;
    await rebuildInFlight;
    return;
  }
  rebuildInFlight = (async () => {
    try {
      let iterations = 0;
      do {
        dirty = false;
        const gen = ++latestStartedGeneration;
        const next = await buildVaultIndex();
        setCache(next, gen);
        iterations++;
        if (iterations >= MAX_REBUILD_ITERATIONS && dirty) {
          process.stderr.write(
            `[vault-cache] invalidateProject hit MAX_REBUILD_ITERATIONS=${MAX_REBUILD_ITERATIONS} ` +
            `with dirty still set; bailing to let sanity-rebuild catch residual staleness. ` +
            `This indicates unusually heavy write pressure.\n`,
          );
          break;
        }
      } while (dirty);
    } finally {
      rebuildInFlight = null;
    }
  })();
  await rebuildInFlight;
}

/**
 * Invalidate by absolute or vault-relative file path. Extracts slug
 * from `1-Projects/<slug>/...` and delegates to invalidateProject.
 *
 * Used by server/watcher.ts for external changes (Obsidian edits, git
 * pulls) that don't originate from our writers.
 */
export async function invalidateFile(path: string): Promise<void> {
  // Sprint I.9 R1 — Codex WRITE-COMMITS-BEFORE-CACHE-FAILURE-SURFACES (HIGH):
  // writer writes file successfully at line N, then calls await invalidateFile
  // at line N+1. If buildVaultIndex throws (disk read failure, parse error),
  // the writer's route handler propagates the error as HTTP 500 even though
  // the underlying file mutation IS durable. Client sees the write as failed,
  // may retry → double-apply, or rolls back UI state.
  //
  // FIX: cache-refresh failures are logged to stderr but do NOT throw.
  // The file write is the user-visible operation; cache freshness is a
  // server-side concern the sanity-rebuild timer will reconcile within 60s.
  try {
    // Normalize to vault-relative if absolute
    const rel = path.startsWith(VAULT_ROOT + "/")
      ? path.slice(VAULT_ROOT.length + 1)
      : path;
    // Expect format: 1-Projects/<slug>/...
    const m = /^1-Projects\/([^/]+)\//.exec(rel);
    if (!m) {
      // Not a project file — e.g. 2-Areas, 3-Resources, Daily. Full rebuild
      // is the safe fallback; goal-timeframe lookups in vault-index pull
      // from 2-Areas/goals so a goal file change could affect priority.
      await invalidateProject("_any_");
      return;
    }
    await invalidateProject(m[1]);
  } catch (err) {
    process.stderr.write(`[vault-cache] invalidateFile failed for ${path}: ${err}\n`);
    // Sprint I.9 R2 — Codex CACHE-FAILURE-STAYS-STALE (HIGH): if a rebuild
    // is already in flight, marking dirty=true is sufficient — the current
    // rebuild's do-while loop will pick it up. But if NO rebuild is active,
    // dirty=true alone is inert until some later invalidate or the 60s
    // sanity-rebuild timer. Under the writer-synchronous invariant, the
    // writer's file mutation is already durable; we MUST close the cache-
    // vs-disk gap quickly. Kick a background retry on the next tick so a
    // recoverable error (transient parse, momentary disk hiccup) doesn't
    // leave the cache visibly stale for up to 60s.
    dirty = true;
    if (rebuildInFlight === null) {
      setTimeout(() => {
        // Fire-and-forget; any error is re-logged by this call's own catch.
        void invalidateProject("_retry_").catch(() => { /* suppressed */ });
      }, 100);
    }
  }
}

/**
 * Sanity-rebuild timer — external chokidar events may occasionally miss
 * on Linux under high load OR when editors use atomic-rename patterns
 * the watcher doesn't catch. Periodic full rebuild + diff-log catches
 * drift before it surfaces as user-visible staleness.
 *
 * Returns a cleanup function. Server.index.ts registers cleanup on
 * SIGTERM / SIGINT / beforeExit so the interval doesn't leak post-shutdown.
 */
export function startSanityRebuild(intervalMs: number = 60_000): () => void {
  const timer = setInterval(() => {
    // Sprint I.9 R1 — Opus P5 / Codex SANITY-REBUILD-CLOBBER (CRITICAL):
    // claim a generation BEFORE reading disk. If a concurrent writer-
    // invalidate bumps currentGeneration while our buildVaultIndex() is
    // awaiting, setCache() rejects our stale gen and the writer's fresh
    // data wins. Previously setCache() was unconditional and would
    // clobber fresh cache with stale disk reads.
    const prevCount = cached?.projects.length ?? 0;
    const prevTaskCount = cached
      ? cached.projects.reduce((s, p) => s + p.tasks.length, 0)
      : 0;
    const gen = ++latestStartedGeneration;
    buildVaultIndex()
      .then((next) => {
        const nextTaskCount = next.projects.reduce((s, p) => s + p.tasks.length, 0);
        const projectDelta = next.projects.length - prevCount;
        const taskDelta = nextTaskCount - prevTaskCount;
        if (projectDelta !== 0 || taskDelta !== 0) {
          process.stderr.write(
            `[vault-cache] sanity-rebuild drift: ${projectDelta > 0 ? "+" : ""}${projectDelta} projects, ` +
            `${taskDelta > 0 ? "+" : ""}${taskDelta} tasks\n`,
          );
        }
        // setCache guard rejects this if a newer writer-rebuild already
        // landed (currentGeneration > our gen).
        setCache(next, gen);
      })
      .catch((err) => {
        process.stderr.write(`[vault-cache] sanity-rebuild failed: ${err}\n`);
      });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** For tests or server-shutdown diagnostics. */
export function getInitialBuilt(): boolean {
  return initialBuilt;
}
