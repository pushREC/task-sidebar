import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { Pencil, Trash2, Link2 } from "lucide-react";
import { pulse } from "../lib/haptics.js";

/**
 * Sprint J.2.10 — long-press context menu.
 *
 * Touch / trackpad parity for right-click menus on environments where
 * right-click is not ergonomic. Fires after 400ms of stationary
 * pointerdown; cancels on >8px pointer movement (so scroll never opens
 * the menu). Three actions: Edit (opens detail panel + edit mode),
 * Delete (opens detail panel + scrolls trash), Copy link (writes a
 * vault-relative wikilink to clipboard).
 *
 * Architecture Lock #1 — single accent color, no new visual roles.
 * Lock #3 — Lucide icons only (Pencil, Trash2, Link2 already in deps).
 *
 * Reduced-motion: no animation introduced; menu fades via the existing
 * .cmdp-reveal keyframe (already reduced-motion-guarded at file end of
 * styles.css).
 */

const LONG_PRESS_MS = 400;
const MOVE_THRESHOLD_PX = 8;

interface UseLongPressArgs {
  /** Called when the long-press completes (timer fires without cancellation). */
  onLongPress: (x: number, y: number) => void;
  /** Disable detection (e.g. while editing inline). */
  disabled?: boolean;
}

interface PointerHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
}

/**
 * Hook returning a tuple of pointer handlers to spread onto any element
 * that should support long-press. Self-contained — no shared state.
 */
export function useLongPress({ onLongPress, disabled }: UseLongPressArgs): PointerHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  // Cleanup on unmount so a long-press timer never fires after the row
  // has been recycled (e.g. via SSE refetch + lazy-mount unmount).
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  function cancel(): void {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }

  return {
    onPointerDown(e) {
      if (disabled) return;
      // Only primary mouse / touch / pen — ignore secondary buttons (which
      // are already handled by the browser's native contextmenu event).
      if (e.button !== undefined && e.button !== 0) return;
      startRef.current = { x: e.clientX, y: e.clientY };
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const start = startRef.current;
        if (!start) return;
        startRef.current = null;
        pulse(15); // slightly longer pulse than the 10ms tap to read as "menu opened"
        onLongPress(start.x, start.y);
      }, LONG_PRESS_MS);
    },
    onPointerMove(e) {
      const start = startRef.current;
      if (!start) return;
      const dx = Math.abs(e.clientX - start.x);
      const dy = Math.abs(e.clientY - start.y);
      if (dx > MOVE_THRESHOLD_PX || dy > MOVE_THRESHOLD_PX) {
        cancel();
      }
    },
    onPointerUp() {
      cancel();
    },
    onPointerCancel() {
      cancel();
    },
    onPointerLeave() {
      cancel();
    },
  };
}

export type LongPressAction = "edit" | "delete" | "copy-link";

interface LongPressMenuProps {
  /** Anchor point in viewport coords (clientX/Y from the originating pointer). */
  x: number;
  y: number;
  open: boolean;
  onClose: () => void;
  onPick: (action: LongPressAction) => void;
}

/**
 * Portaled menu rendered at the long-press anchor. Esc and outside click
 * close. Arrow keys nav, Enter selects. Self-positioning is naive: clamp
 * to viewport bounds with an 8px safety margin.
 */
export function LongPressMenu(props: LongPressMenuProps): ReactElement | null {
  const { x, y, open, onClose, onPick } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (!open) return;
    setActiveIdx(0);
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % 3);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + 3) % 3);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const actions: LongPressAction[] = ["edit", "delete", "copy-link"];
        onPick(actions[activeIdx]);
        return;
      }
    }
    function onDocPointer(e: PointerEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    // pointerdown (not click) so the menu closes the instant the user
    // taps outside, before the next gesture's long-press timer starts.
    window.addEventListener("pointerdown", onDocPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDocPointer, true);
    };
  }, [open, onClose, onPick, activeIdx]);

  if (!open) return null;

  // Naive viewport clamp; menu max ~160x110.
  const left = Math.max(8, Math.min(x, window.innerWidth - 168));
  const top = Math.max(8, Math.min(y, window.innerHeight - 118));

  const items: { id: LongPressAction; label: string; Icon: typeof Pencil }[] = [
    { id: "edit", label: "Edit", Icon: Pencil },
    { id: "delete", label: "Delete", Icon: Trash2 },
    { id: "copy-link", label: "Copy link", Icon: Link2 },
  ];

  return createPortal(
    <div
      ref={ref}
      className="long-press-menu"
      role="menu"
      aria-label="Task actions"
      style={{ left, top }}
    >
      {items.map((item, idx) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={
            "long-press-menu__item press-scale" +
            (idx === activeIdx ? " long-press-menu__item--active" : "")
          }
          onClick={() => onPick(item.id)}
          onMouseEnter={() => setActiveIdx(idx)}
        >
          <item.Icon size={12} strokeWidth={2} aria-hidden="true" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
