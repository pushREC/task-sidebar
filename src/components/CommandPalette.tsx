import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckSquare, FolderKanban, Layout, Plus, Search } from "lucide-react";
import { useSidebarStore } from "../store.js";
import { fuzzyFilter, fuzzyScore } from "../lib/fuzzy.js";
import { addTaskApi } from "../api.js";

/**
 * Command Palette (Sprint D F01).
 *
 * Keyboard:
 *   ⌘K / Ctrl+K — open (handled in keyboard.ts)
 *   Esc         — close
 *   ↑ / ↓       — navigate flat result list
 *   Enter       — activate highlighted result
 *   Tab         — focus cycles within the palette (input → list → input)
 *
 * Scopes (all searched in parallel; results grouped under scope headers):
 *   - Tasks     (click: open TaskDetailPanel for that task)
 *   - Projects  (click: switch Projects tab + expand the project)
 *   - Tabs      (click: switch tab)
 *   - Create    ("+ new task: {query}" — synthetic, only if no matches or + prefix)
 *
 * ARIA: role="dialog" + aria-modal="true" + combobox input +
 *       aria-activedescendant tracking the highlighted row.
 *
 * Perf: fuzzy only runs for query length ≥ 2 (below that we cap to the
 *       most-recent 20 tasks which is effectively free).
 */

type ResultKind = "task" | "project" | "tab" | "create";

interface Result {
  id: string;
  kind: ResultKind;
  label: string;
  detail?: string;
  score: number;
  action: () => void;
}

const SCOPE_LABEL: Record<ResultKind, string> = {
  task: "Tasks",
  project: "Projects",
  tab: "Tabs",
  create: "Create",
};

const MAX_RESULTS = 20;

export function CommandPalette() {
  const open = useSidebarStore((s) => s.paletteOpen);
  const setOpen = useSidebarStore((s) => s.setPaletteOpen);
  const vault = useSidebarStore((s) => s.vault);
  const setActiveTab = useSidebarStore((s) => s.setActiveTab);
  const setExpandedProjectSlug = useSidebarStore((s) => s.setExpandedProjectSlug);
  const setExpandedTaskId = useSidebarStore((s) => s.setExpandedTaskId);
  const setSelectedTaskId = useSidebarStore((s) => s.setSelectedTaskId);
  const toggleProjectExpanded = useSidebarStore((s) => s.toggleProjectExpanded);
  const expandedProjects = useSidebarStore((s) => s.expandedProjects);
  const expandedProjectSlug = useSidebarStore((s) => s.expandedProjectSlug);

  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Sprint J.2.14 — snapshot the focus owner at open time so close can
  // restore it. Without this, ⌘K → Esc dropped focus to <body>, which
  // killed `j`/`k` keyboard nav until the user manually re-clicked a row.
  // Pattern matches the focus restoration audit (J.1.5) — applied here
  // as a self-contained fix on the palette's well-defined open/close.
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus the input on open + reset state. Snapshot prior focus owner.
  // On close, restore focus to the snapshot if it is still in the DOM
  // (SSE refetches can remove rows mid-palette; fall back to body via
  // the natural no-op when contains() is false).
  useEffect(() => {
    if (open) {
      const active = document.activeElement;
      previousFocusRef.current = active instanceof HTMLElement ? active : null;
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      const target = previousFocusRef.current;
      if (target && document.body.contains(target)) {
        target.focus();
      }
      previousFocusRef.current = null;
    }
  }, [open]);

  // Build the flat result list.
  const results = useMemo<Result[]>(() => {
    if (!vault) return [];
    const q = query.trim();
    const hasPlusPrefix = q.startsWith("+");
    const searchQuery = hasPlusPrefix ? q.slice(1).trim() : q;
    const out: Result[] = [];

    // ── Tabs ───────────────────────────────────────────────────────────────
    const tabOptions = [
      { id: "agenda", label: "Agenda", detail: `${vault.projects.reduce((sum, p) => {
        if (!["active", "backlog", "blocked", "paused"].includes(p.status)) return sum;
        return sum + p.tasks.filter((t) => !t.done && t.status !== "cancelled").length;
      }, 0)} open` },
      { id: "projects", label: "Projects", detail: `${vault.projects.filter((p) => p.status === "active").length} active` },
    ];
    for (const t of tabOptions) {
      if (searchQuery.length === 0 || fuzzyScore(t.label, searchQuery) !== null) {
        const score = fuzzyScore(t.label, searchQuery) ?? 0;
        out.push({
          id: `tab:${t.id}`,
          kind: "tab",
          label: t.label,
          detail: t.detail,
          score,
          action: () => {
            setActiveTab(t.id as "agenda" | "projects");
            setOpen(false);
          },
        });
      }
    }

    // ── Projects ───────────────────────────────────────────────────────────
    const projectHits = fuzzyFilter(vault.projects, searchQuery, (p) => p.title, MAX_RESULTS);
    for (const hit of projectHits) {
      const slug = hit.item.slug;
      out.push({
        id: `project:${slug}`,
        kind: "project",
        label: hit.item.title,
        detail: hit.item.status,
        score: hit.score,
        action: () => {
          setActiveTab("projects");
          if (!expandedProjects.has(slug)) toggleProjectExpanded(slug);
          setExpandedProjectSlug(slug);
          setOpen(false);
        },
      });
    }

    // ── Tasks ──────────────────────────────────────────────────────────────
    const allTasks: Array<{ id: string; action: string; projectSlug: string; projectTitle: string }> = [];
    for (const p of vault.projects) {
      for (const t of p.tasks) {
        if (t.status === "cancelled") continue;
        allTasks.push({
          id: t.id,
          action: t.action,
          projectSlug: p.slug,
          projectTitle: p.title,
        });
      }
    }
    const taskHits = fuzzyFilter(
      allTasks,
      searchQuery,
      (t) => `${t.action} ${t.projectTitle}`,
      MAX_RESULTS
    );
    for (const hit of taskHits) {
      out.push({
        id: `task:${hit.item.id}`,
        kind: "task",
        label: hit.item.action,
        detail: hit.item.projectTitle,
        score: hit.score,
        action: () => {
          const sanitized = hit.item.id.replace(/[^a-zA-Z0-9-_]/g, "_");
          setActiveTab("agenda");
          setSelectedTaskId(sanitized);
          setExpandedTaskId(sanitized);
          setOpen(false);
        },
      });
    }

    // ── Create ─────────────────────────────────────────────────────────────
    // Show "+ new task …" when the user explicitly typed `+ …` OR typed
    // ≥3 chars with no other results.
    const hasOtherResults = out.length > 0;
    const createText = hasPlusPrefix ? searchQuery : q;
    if (createText.length >= 3 && (hasPlusPrefix || !hasOtherResults)) {
      // Target project: use last-expanded in Projects view > first active.
      const targetSlug =
        expandedProjectSlug ??
        vault.projects.find((p) => p.status === "active")?.slug;
      if (targetSlug) {
        const targetProject = vault.projects.find((p) => p.slug === targetSlug);
        out.push({
          id: "create:new",
          kind: "create",
          label: `+ new task: ${createText}`,
          detail: targetProject ? `in ${targetProject.title}` : undefined,
          score: 10, // low but visible
          action: async () => {
            await addTaskApi({ slug: targetSlug, text: createText });
            setOpen(false);
          },
        });
      }
    }

    // Sort by scope order (task > project > tab > create), then score desc.
    const SCOPE_RANK: Record<ResultKind, number> = { task: 0, project: 1, tab: 2, create: 3 };
    out.sort((a, b) => {
      const sa = SCOPE_RANK[a.kind] - SCOPE_RANK[b.kind];
      if (sa !== 0) return sa;
      return b.score - a.score;
    });

    return out.slice(0, MAX_RESULTS);
  }, [
    vault,
    query,
    setActiveTab,
    setOpen,
    expandedProjects,
    toggleProjectExpanded,
    setExpandedProjectSlug,
    setSelectedTaskId,
    setExpandedTaskId,
    expandedProjectSlug,
  ]);

  // Keep activeIdx within bounds.
  useEffect(() => {
    if (activeIdx >= results.length) setActiveIdx(Math.max(0, results.length - 1));
  }, [results.length, activeIdx]);

  // Scroll the active row into view.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (!open) return null;

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[activeIdx]?.action();
    }
  }

  // Group results by scope for rendering, preserving flat index for keyboard nav.
  const grouped: Array<{ kind: ResultKind; rows: Array<{ row: Result; flatIdx: number }> }> = [];
  for (const kind of ["task", "project", "tab", "create"] as const) {
    const rows = results
      .map((row, idx) => ({ row, flatIdx: idx }))
      .filter(({ row }) => row.kind === kind);
    if (rows.length > 0) grouped.push({ kind, rows });
  }

  const activedescendant =
    results.length > 0 ? `cmdp-row-${activeIdx}` : undefined;

  const node = (
    <div
      className="cmdp-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="cmdp"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleKey}
      >
        <div className="cmdp-header">
          <Search size={14} strokeWidth={1.5} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            className="cmdp-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            placeholder="Search tasks, projects, or + new task…"
            aria-label="Command palette search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls="cmdp-results"
            aria-activedescendant={activedescendant}
          />
        </div>
        <div
          ref={listRef}
          id="cmdp-results"
          className="cmdp-results"
          role="listbox"
          aria-label="Results"
        >
          {results.length === 0 && (
            <div className="cmdp-empty">No matches. Type <kbd>+</kbd> to add a new task.</div>
          )}
          {grouped.map(({ kind, rows }) => (
            <div key={kind} className="cmdp-scope">
              <div className="cmdp-scope-header">{SCOPE_LABEL[kind]}</div>
              {rows.map(({ row, flatIdx }) => {
                const Icon =
                  row.kind === "task" ? CheckSquare :
                  row.kind === "project" ? FolderKanban :
                  row.kind === "tab" ? Layout :
                  Plus;
                return (
                  <div
                    key={row.id}
                    id={`cmdp-row-${flatIdx}`}
                    role="option"
                    aria-selected={flatIdx === activeIdx}
                    data-idx={flatIdx}
                    className={`cmdp-row${flatIdx === activeIdx ? " active" : ""}`}
                    onMouseEnter={() => setActiveIdx(flatIdx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      row.action();
                    }}
                  >
                    <Icon size={12} strokeWidth={1.5} />
                    <span className="cmdp-row-label">{row.label}</span>
                    {row.detail && <span className="cmdp-row-detail">{row.detail}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="cmdp-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(node, document.body)
    : node;
}
