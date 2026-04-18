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
    setIsUndoing(true);
    try {
      await pendingUndo.revert();
    } finally {
      setIsUndoing(false);
      setPendingUndo(null);
    }
  }

  // Expose a global undo function for ⌘Z. R1 HIGH fix — only bind when
  // the action is actually undoable (skip when terminal delete variant
  // is up, so ⌘Z doesn't fire a no-op revert).
  useEffect(() => {
    if (!pendingUndo) return;
    if (pendingUndo.action === "delete") return; // terminal — no ⌘Z
    async function handleCmdZ(e: KeyboardEvent) {
      if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        const active = document.activeElement as HTMLElement | null;
        const tag = active?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || active?.isContentEditable) {
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

  // R1 HIGH (Opus #3) — Delete is TERMINAL. Showing an "Undo" button whose
  // click is a no-op is a dark pattern. For delete: render a non-undoable
  // confirmation variant with a Dismiss (X) button instead. The toast
  // still auto-dismisses after 5s; user gets explicit feedback without
  // the lie.
  const isTerminal = pendingUndo.action === "delete";

  const node = (
    <div
      className={`undo-toast${isTerminal ? " undo-toast--terminal" : ""}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="undo-toast__label">{pendingUndo.label}</span>
      {isTerminal ? (
        <button
          type="button"
          className="undo-toast__dismiss press-scale"
          onClick={() => setPendingUndo(null)}
          aria-label="Dismiss notification"
          title="Dismiss"
        >
          <X size={11} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : (
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
    </div>
  );

  return typeof document !== "undefined" ? createPortal(node, document.body) : node;
}
