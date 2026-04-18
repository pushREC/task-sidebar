import { useEffect, useRef } from "react";

interface PopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}

/**
 * Minimal popover primitive shared by DuePopover + PriorityPopover.
 *
 * Positioning: anchored absolutely below the passed `anchorRef` rect,
 * clamped inside the viewport so it doesn't clip at narrow sidebar
 * widths. Close on: outside click (mousedown), Escape, or scroll.
 *
 * Deliberate choices:
 *   - No portal — the parent's stacking context is fine at this scale.
 *   - No focus trap — the popover is a transient menu; Escape restores
 *     focus to the anchor (caller's responsibility).
 *   - role="menu" + children render their own role="menuitem" buttons.
 */
export function Popover({ anchorRef, onClose, ariaLabel, children }: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Position: below the anchor, left-aligned. Clamp to viewport so it
    // doesn't overflow the right edge at narrow widths.
    function position() {
      const anchor = anchorRef.current;
      const pop = popoverRef.current;
      if (!anchor || !pop) return;
      const a = anchor.getBoundingClientRect();
      const viewportW = document.documentElement.clientWidth;
      const popW = pop.offsetWidth || 180;
      let left = a.left;
      if (left + popW > viewportW - 8) left = viewportW - popW - 8;
      if (left < 8) left = 8;
      pop.style.position = "fixed";
      pop.style.left = `${left}px`;
      pop.style.top = `${a.bottom + 4}px`;
    }
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [anchorRef, onClose]);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const pop = popoverRef.current;
      const anchor = anchorRef.current;
      const target = e.target as Node;
      if (!pop) return;
      if (pop.contains(target) || anchor?.contains(target)) return;
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
    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey, true);
    };
  }, [anchorRef, onClose]);

  return (
    <div
      ref={popoverRef}
      className="popover"
      role="menu"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}
