import { spawn } from "child_process";

/**
 * Optional integration: path to life-os status_reconcile.py.
 * Leave RECONCILE_SCRIPT_PATH unset to run without side-effect reconciliation
 * (done-transitions stay local to the task file; no parent-goal rollup).
 * Set to an absolute path to enable the fire-and-forget call.
 * See docs/LIFE-OS.md for wiring details.
 */
// Sprint I deferred D-02 — whitespace-only env var collapses to null so
// the no-op path fires (done-transitions stay local; no subprocess call).
const RECONCILE_SCRIPT: string | null = process.env.RECONCILE_SCRIPT_PATH?.trim() || null;
const FIRE_FORGET_TIMEOUT_MS = 3000;

/**
 * Fire-and-forget call to status_reconcile.py.
 *
 * Spawns the Python script with a 3s hard timeout. The HTTP response is
 * never blocked on this — errors are logged to stderr only.
 *
 * Call this after any write that transitions a task status to "done".
 */
export function fireStatusReconcile(): void {
  // Graceful no-op if reconcile script not configured (public release default).
  if (RECONCILE_SCRIPT === null) return;

  let proc: ReturnType<typeof spawn> | null = null;

  try {
    proc = spawn("python3", [RECONCILE_SCRIPT], {
      timeout: FIRE_FORGET_TIMEOUT_MS,
      stdio: ["ignore", "ignore", "pipe"],
      detached: false,
    });
  } catch (err) {
    process.stderr.write(`[status-reconcile] spawn failed: ${err}\n`);
    return;
  }

  const timer = setTimeout(() => {
    if (proc) {
      proc.kill("SIGKILL");
      process.stderr.write("[status-reconcile] killed after 3s timeout\n");
    }
  }, FIRE_FORGET_TIMEOUT_MS);

  proc.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[status-reconcile] stderr: ${chunk.toString()}`);
  });

  proc.on("close", (code) => {
    clearTimeout(timer);
    if (code !== 0 && code !== null) {
      process.stderr.write(`[status-reconcile] exited with code ${code}\n`);
    }
  });

  proc.on("error", (err) => {
    clearTimeout(timer);
    process.stderr.write(`[status-reconcile] error: ${err}\n`);
  });

  // Unref so the process doesn't keep Node alive
  proc.unref();
}
