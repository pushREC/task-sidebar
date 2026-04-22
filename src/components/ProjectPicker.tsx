import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { fuzzyFilter } from "../lib/fuzzy.js";
import type { Project } from "../shared/types.js";

/**
 * ProjectPicker (Sprint I.6.3).
 *
 * Portaled combobox anchored to a caller-provided ref. Used by Bulk Move
 * (I.6.4) to pick a destination project. Future consumers: single-task
 * move UI, "move to" keyboard affordance.
 *
 * Behavior:
 *   - Input autoFocus on mount.
 *   - Fuzzy filter via src/lib/fuzzy.ts against the projects array.
 *   - Recent-N (up to 5) persisted to localStorage under
 *     `vault-sidebar:picker-recents`; recents surface at the top when the
 *     input is empty.
 *   - Arrow Up / Down navigate highlighted option. Enter picks. Esc closes
 *     and restores focus to the anchor.
 *   - `excludeSlugs` (typically the source project slug for bulk move)
 *     filters projects OUT before fuzzy runs.
 *
 * ARIA:
 *   - role="combobox" on input, aria-autocomplete="list",
 *     aria-expanded="true", aria-controls on input points at listbox id.
 *   - role="listbox" on options container, role="option" on each item,
 *     aria-selected on the highlighted option, aria-activedescendant on
 *     input references the highlighted option's id.
 *   - The picker is rendered via createPortal to body so ancestor
 *     `backdrop-filter` (bucket-header) doesn't clip the fixed positioning.
 *   - Adds `.project-picker` class to the panel — registered in
 *     src/lib/keyboard.ts stand-down list so global `j/k` don't hijack
 *     while the picker is open.
 *
 * Anchor position tracking copied from Popover.tsx (ResizeObserver +
 * MutationObserver + requestAnimationFrame). Flips above when no room
 * below.
 *
 * Scrolling inside the options list does NOT close the picker; any
 * ancestor scroll does (consistent with Popover.tsx Opus F2 rule).
 */

const RECENT_KEY = "vault-sidebar:picker-recents";
const RECENT_LIMIT = 5;
const VISIBLE_LIMIT = 20;

export interface ProjectPickerProps {
  anchorRef: RefObject<HTMLElement | null>;
  projects: Project[];
  onPick: (slug: string) => void;
  onClose: () => void;
  /** Slugs to exclude from results (typically the source project in bulk move). */
  excludeSlugs?: string[];
  /** Only projects matching these statuses are shown. Defaults to all active-ish statuses. */
  acceptStatuses?: string[];
}

// Accept default statuses for Move destination: active / backlog / blocked.
// Paused/done/cancelled projects are filtered out to reduce noise; the user
// can still unpause/revive before moving if desired.
const DEFAULT_STATUSES = ["active", "backlog", "blocked", "paused"];

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === "string").slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

function saveRecent(slug: string): void {
  try {
    const current = loadRecents();
    const next = [slug, ...current.filter((s) => s !== slug)].slice(0, RECENT_LIMIT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Best-effort; missing localStorage is not fatal.
  }
}

export function ProjectPicker({
  anchorRef,
  projects,
  onPick,
  onClose,
  excludeSlugs,
  acceptStatuses = DEFAULT_STATUSES,
}: ProjectPickerProps) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const excludeSet = useMemo(() => new Set(excludeSlugs ?? []), [excludeSlugs]);

  // ─── Filter + rank results ────────────────────────────────────────────
  const results = useMemo(() => {
    const eligible = projects.filter(
      (p) => !excludeSet.has(p.slug) && acceptStatuses.includes(p.status),
    );

    // No query → recents first, then the rest alphabetically.
    if (query.trim().length === 0) {
      const recents = loadRecents();
      const bySlug = new Map(eligible.map((p) => [p.slug, p]));
      const recentHits = recents
        .map((slug) => bySlug.get(slug))
        .filter((p): p is Project => p !== undefined);
      const recentSet = new Set(recentHits.map((p) => p.slug));
      const rest = eligible
        .filter((p) => !recentSet.has(p.slug))
        .sort((a, b) => a.title.localeCompare(b.title));
      return [...recentHits, ...rest].slice(0, VISIBLE_LIMIT);
    }

    // With query → fuzzy by title, fall back to slug.
    const ranked = fuzzyFilter(
      eligible,
      query.trim(),
      (p) => `${p.title} ${p.slug}`,
      VISIBLE_LIMIT,
    );
    return ranked.map((r) => r.item);
  }, [projects, query, excludeSet, acceptStatuses]);

  // Clamp activeIdx when results shrink.
  useEffect(() => {
    if (activeIdx >= results.length) {
      setActiveIdx(Math.max(0, results.length - 1));
    }
  }, [results.length, activeIdx]);

  // ─── Position tracking (copied from Popover.tsx) ──────────────────────
  useEffect(() => {
    function position() {
      const anchor = anchorRef.current;
      const pop = panelRef.current;
      if (!anchor || !pop) return;
      const a = anchor.getBoundingClientRect();
      const viewportW = document.documentElement.clientWidth;
      const viewportH = document.documentElement.clientHeight;
      const popW = pop.offsetWidth || 260;
      const popH = pop.offsetHeight || 280;
      let left = a.left;
      if (left + popW > viewportW - 8) left = viewportW - popW - 8;
      if (left < 8) left = 8;
      let top = a.bottom + 4;
      if (top + popH > viewportH - 8) {
        top = Math.max(8, a.top - popH - 4);
      }
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
    }
    position();

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

    const mo = anchor ? new MutationObserver(schedulePosition) : null;
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

  // ─── Outside click + ancestor scroll + Escape ─────────────────────────
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const pop = panelRef.current;
      const anchor = anchorRef.current;
      const target = e.target as Node;
      if (!pop) return;
      if (pop.contains(target) || anchor?.contains(target)) return;
      onClose();
    }
    function handleScroll(e: Event) {
      const pop = panelRef.current;
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

  // ─── Focus input on mount ─────────────────────────────────────────────
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ─── Scroll highlighted option into view ──────────────────────────────
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const opt = list.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    if (opt) opt.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  function commitPick(slug: string): void {
    saveRecent(slug);
    onPick(slug);
  }

  function handleInputKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length === 0) return;
      setActiveIdx((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length === 0) return;
      setActiveIdx((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[activeIdx];
      if (pick) commitPick(pick.slug);
    }
    // Escape handled by window keydown (above) so all escape paths converge.
  }

  const listboxId = "project-picker-listbox";
  const activeOptionId =
    activeIdx < results.length ? `project-picker-opt-${activeIdx}` : undefined;

  const node = (
    <div
      ref={panelRef}
      className="project-picker"
      role="dialog"
      aria-label="Move to project"
      style={{ position: "fixed" }}
    >
      <input
        ref={inputRef}
        type="text"
        className="project-picker__input"
        placeholder="Move to project…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIdx(0);
        }}
        onKeyDown={handleInputKey}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
      />
      <div
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label="Projects"
        className="project-picker__list"
      >
        {results.length === 0 ? (
          <div className="project-picker__empty">
            {projects.length === 0 ? "No projects." : "No matches."}
          </div>
        ) : (
          results.map((p, idx) => {
            const isActive = idx === activeIdx;
            return (
              <button
                key={p.slug}
                id={`project-picker-opt-${idx}`}
                type="button"
                role="option"
                aria-selected={isActive}
                data-idx={idx}
                className={
                  isActive
                    ? "project-picker__option project-picker__option--active"
                    : "project-picker__option"
                }
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => commitPick(p.slug)}
              >
                <span className="project-picker__title">{p.title}</span>
                <span className="project-picker__slug">{p.slug}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
  return typeof document !== "undefined" ? createPortal(node, document.body) : node;
}
