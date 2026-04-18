import { spawn } from "child_process";

const RECONCILE_SCRIPT = "/Users/robertzinke/.claude/skills/life-os/scripts/status_reconcile.py";
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
