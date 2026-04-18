import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RotateCcw } from "lucide-react";
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

  // Expose a global undo function for ⌘Z. This is the simplest cross-
  // component hook — the keyboard handler imports from store, we'd need
  // the revert closure. Route through store by calling revert directly.
  useEffect(() => {
    if (!pendingUndo) return;
    async function handleCmdZ(e: KeyboardEvent) {
      if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        // Don't steal ⌘Z from active text inputs (editing a task body,
        // notes textarea, etc.). If focus is inside an editable control,
        // let the native undo happen.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUndo]);

  if (!pendingUndo) return null;

  const node = (
    <div
      className="undo-toast"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="undo-toast__label">{pendingUndo.label}</span>
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
    </div>
  );

  return typeof document !== "undefined" ? createPortal(node, document.body) : node;
}
