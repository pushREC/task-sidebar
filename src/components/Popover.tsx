import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface PopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}

/**
 * Popover primitive shared by DuePopover + PriorityPopover.
 *
 * Round-1 convergence fixes:
 *   - UX-POPOVER-CLIPPING-CONTEXT — rendered via createPortal to document.body
 *     so ancestor `backdrop-filter` / `transform` / `filter` containing-block
 *     rules can't clip the fixed-position panel. (Agenda's .bucket-header
 *     uses `backdrop-filter: blur(8px)` which creates a new containing block
 *     for fixed descendants.)
 *   - Opus F1 — anchor position is tracked with ResizeObserver + rAF so
 *     the popover follows row shifts caused by SSE refetches without
 *     getting stranded at stale coordinates.
 *   - Gemini A11Y-POPOVER-FOCUS-MANAGEMENT — focus moves to the first
 *     menu item on open; Tab / Shift+Tab cycles within the menu
 *     (ArrowDown/Up also work). Escape restores focus to the anchor.
 *   - Gemini A11Y-POPOVER-BLUR-CLOSE — focusout leaving the panel closes
 *     the popover (unless focus moved INTO another menu item).
 *   - Opus F2 — scroll capture filters out scrolls that come from inside
 *     the popover itself; an external scroll (window / agenda-view /
 *     any other scroller) still closes. Closing on scroll keeps the
 *     popover's apparent position from drifting.
 */
export function Popover({ anchorRef, onClose, ariaLabel, children }: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // ─── Position tracking ────────────────────────────────────────────────────
  useEffect(() => {
    function position() {
      const anchor = anchorRef.current;
      const pop = popoverRef.current;
      if (!anchor || !pop) return;
      const a = anchor.getBoundingClientRect();
      const viewportW = document.documentElement.clientWidth;
      const viewportH = document.documentElement.clientHeight;
      const popW = pop.offsetWidth || 180;
      const popH = pop.offsetHeight || 200;
      let left = a.left;
      if (left + popW > viewportW - 8) left = viewportW - popW - 8;
      if (left < 8) left = 8;
      // Prefer below; flip above if there's no room below.
      let top = a.bottom + 4;
      if (top + popH > viewportH - 8) {
        top = Math.max(8, a.top - popH - 4);
      }
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
    }
    position();

    // Re-position on any layout-affecting change.
    let raf = 0;
    function schedulePosition() {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        position();
      });
    }

    const anchor = anchorRef.current;
    const ro = anchor ? new ResizeObserver(schedulePosition) : null;
    if (anchor && ro) ro.observe(anchor);
    window.addEventListener("resize", schedulePosition);

    // Watch DOM mutations on the anchor's ancestor chain — cheap and covers
    // SSE-driven row reorders.
    const mo = anchor
      ? new MutationObserver(schedulePosition)
      : null;
    if (anchor && mo) {
      mo.observe(document.body, { childList: true, subtree: true, attributes: true });
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedulePosition);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [anchorRef]);

  // ─── Outside-click, scroll, Escape ────────────────────────────────────────
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const pop = popoverRef.current;
      const anchor = anchorRef.current;
      const target = e.target as Node;
      if (!pop) return;
      if (pop.contains(target) || anchor?.contains(target)) return;
      onClose();
    }
    function handleScroll(e: Event) {
      const pop = popoverRef.current;
      // Opus F2 — if the scroll event originated INSIDE the popover, ignore.
      // Any other scroll (agenda, window, etc.) closes so the panel doesn't
      // drift away from its anchor.
      if (pop && e.target instanceof Node && pop.contains(e.target)) return;
      onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        anchorRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("scroll", handleScroll, true);
    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("keydown", handleKey, true);
    };
  }, [anchorRef, onClose]);

  // ─── Focus entry + trap + close-on-focus-leave ────────────────────────────
  useEffect(() => {
    const pop = popoverRef.current;
    if (!pop) return;

    // Move focus to the first menu item on open.
    const items = pop.querySelectorAll<HTMLElement>('[role="menuitem"], input, button');
    const first = items[0];
    first?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      const focusables = Array.from(
        pop!.querySelectorAll<HTMLElement>('[role="menuitem"], input, button')
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? focusables.indexOf(active) : -1;

      if (e.key === "Tab" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = focusables[(idx + 1 + focusables.length) % focusables.length];
        next.focus();
      } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
        e.preventDefault();
        const prev = focusables[(idx - 1 + focusables.length) % focusables.length];
        prev.focus();
      }
    }

    function handleFocusOut(e: FocusEvent) {
      const next = e.relatedTarget as Node | null;
      if (!next) return; // no incoming focus target (window blur) — ignore
      if (pop && pop.contains(next)) return; // focus moved within popover
      // Gemini A11Y-POPOVER-BLUR-CLOSE — focus left the menu → close.
      onClose();
    }

    pop.addEventListener("keydown", handleKeyDown);
    pop.addEventListener("focusout", handleFocusOut);
    return () => {
      pop.removeEventListener("keydown", handleKeyDown);
      pop.removeEventListener("focusout", handleFocusOut);
    };
  }, [onClose]);

  // ─── Render ───────────────────────────────────────────────────────────────
  // Portal to body — escapes any ancestor containing-block caused by
  // backdrop-filter / transform / filter (see bucket-header).
  const node = (
    <div
      ref={popoverRef}
      className="popover"
      role="menu"
      aria-label={ariaLabel}
      style={{ position: "fixed" }}
    >
      {children}
    </div>
  );
  return typeof document !== "undefined" ? createPortal(node, document.body) : node;
}
