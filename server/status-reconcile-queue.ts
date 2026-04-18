import { fireStatusReconcile } from "./status-reconcile.js";

/**
 * Sprint G — delayed + cancelable reconcile queue.
 *
 * Problem: status_reconcile.py fires the moment a task transitions to
 * "done". If the user hits Undo within 5s (Sprint G D31), the reconcile
 * has already committed its side-effects (stats delta, decisions log,
 * etc.), so undoing the done-transition leaves the reconcile trail as
 * phantom state.
 *
 * Fix: when a done-transition arrives, stage a reconcile with a 5s
 * delay. If another status change for the same entity comes in during
 * that window, cancel the pending reconcile. On the final firing we
 * only reconcile if the task is STILL done.
 *
 * Design intentionally coarse: one timer per entityPath. If the user
 * does done→open→done in 5s, the first cancel + second schedule is
 * what the user wants. The reconcile only fires once at the end.
 */

interface Pending {
  timer: ReturnType<typeof setTimeout>;
  queuedAt: number;
}

const RECONCILE_DELAY_MS = 5000;

const pending = new Map<string, Pending>();

/**
 * Queue a reconcile to fire 5s from now for the given entityPath.
 * Cancels any existing pending reconcile for the same path.
 */
export function queueReconcile(entityPath: string): void {
  cancelReconcile(entityPath);

  const timer = setTimeout(() => {
    pending.delete(entityPath);
    fireStatusReconcile();
  }, RECONCILE_DELAY_MS);

  // unref so pending reconciles don't keep Node alive at shutdown
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    (timer as { unref(): void }).unref();
  }

  pending.set(entityPath, { timer, queuedAt: Date.now() });
}

/**
 * Cancel a pending reconcile for the given entityPath. Returns true if
 * a pending reconcile was found + canceled, false if none was pending.
 */
export function cancelReconcile(entityPath: string): boolean {
  const existing = pending.get(entityPath);
  if (!existing) return false;
  clearTimeout(existing.timer);
  pending.delete(entityPath);
  return true;
}

/**
 * Test/debug helper: how many reconciles are currently pending?
 */
export function pendingReconcileCount(): number {
  return pending.size;
}
