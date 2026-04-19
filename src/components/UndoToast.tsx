import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, X } from "lucide-react";
import { useSidebarStore } from "../store.js";

/**
 * Undo toast — bottom-right portal with 5s self-dismiss.
 *
 * Sprint G D31 signature moment. After any done / delete / cancel /
 * bulk-done action the store writes `pendingUndo`; this component picks
 * it up, renders a toast, and offers Undo via click or ⌘Z. On dismiss
 * (either via timer or explicit undo) the reverter is called and the
 * pending window clears.
 *
 * Implementation notes (cognitive-supremacy):
 *   - Only ONE toast at a time. If a new action queues while an old
 *     one is pending, we fire the old revert first? No — safer: the
 *     old window expires silently (server-side reconcile already
 *     committed at its own pace), and the new pending replaces it.
 *     The store setter makes this explicit.
 *   - Timer is owned by the component; closing the component cancels
 *     the timer. On mount, we start the 5s countdown from the
 *     `undoneAt` timestamp, NOT from mount — so if the toast remounts
 *     due to React re-render, the window doesn't reset.
 *   - ⌘Z binding lives in the global keyboard handler; the toast
 *     just provides the click path.
 */
export function UndoToast() {
  const pendingUndo = useSidebarStore((s) => s.pendingUndo);
  const setPendingUndo = useSidebarStore((s) => s.setPendingUndo);
  const [isUndoing, setIsUndoing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!pendingUndo) return;

    // Window expires 5s after `undoneAt` (action time), not mount.
    // If the caller queued with a stale undoneAt (e.g. reloaded), the
    // remaining window could be negative; in that case clear instantly.
    const WINDOW_MS = 5000;
    const elapsed = Date.now() - pendingUndo.undoneAt;
    const remaining = Math.max(0, WINDOW_MS - elapsed);

    if (remaining === 0) {
      // Already expired — drop the pending without calling revert.
      setPendingUndo(null);
      return;
    }

    timerRef.current = setTimeout(() => {
      setPendingUndo(null);
      timerRef.current = null;
    }, remaining);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [pendingUndo, setPendingUndo]);

  async function handleUndoClick() {
    if (!pendingUndo || isUndoing) return;
    // Plan II Sprint H R2 D1 — identity-guarded finally.
    // If the revert closure replaces pendingUndo with terminal feedback
    // (e.g. BulkBar restore-failed toast), the finally block MUST NOT
    // clear it. Capture the original reference by identity; only clear
    // if the store still points at the same object post-revert.
    const originalRef = pendingUndo;
    setIsUndoing(true);
    try {
      await pendingUndo.revert();
    } finally {
      setIsUndoing(false);
      if (useSidebarStore.getState().pendingUndo === originalRef) {
        setPendingUndo(null);
      }
    }
  }

  // Expose a global undo function for ⌘Z. Sprint H.3.8 — delete variant
  // now has a real revert (tombstone restore), so ⌘Z IS bound for it.
  // Sprint H R2 critic-fix: skip binding entirely when terminal (no-op
  // revert would mislead); also skip on <select> focus (Gemini
  // UNDO-CMDZ-SELECT-GUARD MEDIUM — native select Undo semantics should
  // not be hijacked by our global handler).
  useEffect(() => {
    if (!pendingUndo) return;
    if (pendingUndo.terminal === true) return; // no ⌘Z for terminal toasts
    async function handleCmdZ(e: KeyboardEvent) {
      if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        const active = document.activeElement as HTMLElement | null;
        const tag = active?.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          active?.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        await handleUndoClick();
      }
    }
    document.addEventListener("keydown", handleCmdZ);
    return () => document.removeEventListener("keydown", handleCmdZ);
    // handleUndoClick is stable within a pendingUndo window (it reads
    // pendingUndo from closure + only calls setPendingUndo/setIsUndoing);
    // re-binding every render is wasteful but not harmful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUndo]);

  if (!pendingUndo) return null;

  // Sprint H.3.8 — delete is no longer terminal. Tombstones survive for
  // ~5s and restoreFromTombstone is real. We render Undo (primary) AND
  // a small X (secondary dismiss) so the user can also opt to suppress
  // the notification without firing revert.
  //
  // Sprint H R2 critic-fix (Gemini UNDO-TOAST-TERMINAL-BTNS HIGH) — if
  // the caller flags this pending as `terminal: true` (e.g. "Restore
  // failed" from BulkBar revert), omit the Undo button because the
  // revert is a no-op and clicking it would mislead the user. X dismiss
  // stays; aria-live="assertive" on terminal so the failure is
  // announced immediately.
  const isTerminal = pendingUndo.terminal === true;
  const node = (
    <div
      className={isTerminal ? "undo-toast undo-toast--terminal" : "undo-toast"}
      role="status"
      aria-live={isTerminal ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <span className="undo-toast__label">{pendingUndo.label}</span>
      {!isTerminal && (
        <button
          type="button"
          className="undo-toast__btn press-scale"
          onClick={() => void handleUndoClick()}
          disabled={isUndoing}
          aria-label="Undo last action"
          title="Undo · ⌘Z"
        >
          <RotateCcw size={11} strokeWidth={2} aria-hidden="true" />
          <span>{isUndoing ? "Undoing…" : "Undo"}</span>
        </button>
      )}
      <button
        type="button"
        className="undo-toast__dismiss press-scale"
        onClick={() => setPendingUndo(null)}
        aria-label="Dismiss notification"
        title="Dismiss"
      >
        <X size={11} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(node, document.body) : node;
}
