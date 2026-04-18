import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ConfirmModalProps {
  /** Dialog heading — short, imperative. E.g. "Delete task?" */
  title: string;
  /** Body text explaining what happens + consequences. */
  body: string;
  /** Confirm button label. Default: "Delete". */
  confirmLabel?: string;
  /** Semantic variant. `"danger"` applies the accent color. */
  variant?: "danger" | "neutral";
  /**
   * Milliseconds the confirm button stays disabled after mount. Prevents
   * an in-flight Enter press on the row's Delete icon from firing through
   * to the modal's auto-focused confirm button and deleting immediately.
   * Default: 500ms (matches handoff spec).
   */
  armDelayMs?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal dialog primitive — portal to <body>, fixed overlay with backdrop,
 * focus trap, Esc/backdrop-click dismiss, destructive-action arming delay.
 *
 * Design brief (Sprint E cognitive-supremacy checklist):
 *
 *   - Focus entry lands on Cancel (safe default) — user must actively move
 *     to Confirm to destroy data.
 *   - Confirm button is `disabled` for `armDelayMs` after mount. Belt +
 *     braces against the "I hit Enter on the row's trash icon and the
 *     modal popped + consumed the same keystroke" failure mode.
 *   - Tab cycles inside the dialog; Shift+Tab reverses. No ancestor
 *     focus escape possible while the dialog is open.
 *   - Escape → onCancel. Mousedown outside the dialog panel → onCancel.
 *   - Restores focus to the element that had focus before the dialog
 *     opened. Without this, the user's place in the row list is lost
 *     on Cancel/Escape/Delete.
 *   - `role="alertdialog"` per WAI-ARIA APG for destructive confirms
 *     (non-alertdialog dialogs are for less-urgent interactions).
 */
export function ConfirmModal({
  title,
  body,
  confirmLabel = "Delete",
  variant = "danger",
  armDelayMs = 500,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [armed, setArmed] = useState(armDelayMs === 0);

  // Capture the pre-open focus target so we can restore it on close.
  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      // Restore focus on unmount unless the target has since disappeared
      // (e.g. the task row that triggered the modal was deleted).
      const target = returnFocusRef.current;
      if (target && document.contains(target)) {
        try { target.focus(); } catch { /* some elements refuse focus — tolerate */ }
      }
    };
  }, []);

  // Arm the confirm button after the delay.
  useEffect(() => {
    if (armDelayMs === 0) { setArmed(true); return; }
    const timer = setTimeout(() => setArmed(true), armDelayMs);
    return () => clearTimeout(timer);
  }, [armDelayMs]);

  // Entry focus → Cancel button (safe default; user has to Tab or Shift+Tab
  // to reach Confirm). Timed on next frame so the panel is painted.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      cancelRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Escape + focus trap. Backdrop dismiss is handled by the overlay's
  // onClick below (not document mousedown), so a drag that starts on the
  // panel and releases outside can't accidentally trigger cancel.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      // R1 MODAL-FOCUS-TRAP-SELECT — include <select> so future dialogs
      // (e.g. "move task to project" confirm) still trap correctly.
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusables.length === 0) return;

      const active = document.activeElement as HTMLElement | null;
      const idx = active ? focusables.indexOf(active) : -1;
      if (e.shiftKey) {
        // Shift+Tab: if at first (or outside), wrap to last.
        if (idx <= 0) {
          e.preventDefault();
          focusables[focusables.length - 1].focus();
        }
      } else {
        // Tab: if at last (or outside), wrap to first.
        if (idx === -1 || idx === focusables.length - 1) {
          e.preventDefault();
          focusables[0].focus();
        }
      }
    }

    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("keydown", handleKey, true);
    };
  }, [onCancel]);

  // R1 MODAL-BACKDROP-MOUSEDOWN-CANCEL — click-through safety: dismiss
  // only when BOTH mousedown AND mouseup land on the overlay (not the
  // panel). A drag that starts inside the panel and releases outside
  // should not cancel. Tracked via a ref that captures the mousedown
  // target; cleared on click regardless of target.
  const mouseDownOnOverlayRef = useRef(false);
  function handleOverlayMouseDown(e: React.MouseEvent) {
    mouseDownOnOverlayRef.current = e.target === e.currentTarget;
  }
  function handleOverlayClick(e: React.MouseEvent) {
    const originatedOnOverlay = mouseDownOnOverlayRef.current;
    mouseDownOnOverlayRef.current = false;
    if (originatedOnOverlay && e.target === e.currentTarget) {
      onCancel();
    }
  }

  const node = (
    <div
      className="confirm-modal-overlay"
      aria-hidden={false}
      onMouseDown={handleOverlayMouseDown}
      onClick={handleOverlayClick}
    >
      <div
        ref={panelRef}
        className={`confirm-modal confirm-modal--${variant}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-body"
      >
        <h2 id="confirm-modal-title" className="confirm-modal__title">{title}</h2>
        <p id="confirm-modal-body" className="confirm-modal__body">{body}</p>
        <div className="confirm-modal__actions">
          <button
            ref={cancelRef}
            type="button"
            className="confirm-modal__btn confirm-modal__btn--cancel press-scale"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`confirm-modal__btn confirm-modal__btn--confirm confirm-modal__btn--${variant} press-scale`}
            disabled={!armed}
            onClick={onConfirm}
            // R1 ARMING-VISUAL-CUE — "Arming…" in label while disabled so
            // keyboard Enter users see why it didn't fire.
            aria-label={armed ? confirmLabel : `${confirmLabel} (arming)`}
          >
            {armed ? confirmLabel : `${confirmLabel}…`}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(node, document.body) : node;
}
