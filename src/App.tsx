import { useCallback, useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { fetchVault, subscribeVaultEvents } from "./api.js";
import { useSidebarStore } from "./store.js";
import { AgendaView } from "./views/AgendaView.js";
import { ProjectsView } from "./views/ProjectsView.js";
import { QuickAdd } from "./components/QuickAdd.js";
import { SkeletonList } from "./components/SkeletonRow.js";
import { useKeyboardNav } from "./lib/keyboard.js";
import { useTheme } from "./lib/theme.js";
import type { ThemeChoice } from "./lib/theme.js";
import { AGENDA_PROJECT_STATUSES } from "./lib/project-scopes.js";

// Sprint B D16 — tabs become Agenda + Projects only.
type Tab = "agenda" | "projects";

const DATE_LABEL = new Date().toLocaleDateString("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

const SYNC_DOT_DURATION_MS = 400;

const THEME_LABELS: Record<ThemeChoice, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export function App() {
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showThemePopover, setShowThemePopover] = useState(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickAddRef = useRef<HTMLInputElement | null>(null);

  const vault = useSidebarStore((s) => s.vault);
  const setVault = useSidebarStore((s) => s.setVault);
  const activeTab = useSidebarStore((s) => s.activeTab);
  const setActiveTab = useSidebarStore((s) => s.setActiveTab);
  const selectedTaskId = useSidebarStore((s) => s.selectedTaskId);

  const { theme, setTheme, cycleTheme } = useTheme();
  const gearButtonRef = useRef<HTMLButtonElement | null>(null);

  // H14 — debounced live-region text: at most 1 announcement per 500ms
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const liveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // M15 — stable reference via useCallback prevents stale closure in SSE effect
  const loadVault = useCallback((): void => {
    fetchVault()
      .then((data) => {
        setVault(data);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(String(err));
      });
  }, [setVault]);

  useEffect(() => {
    loadVault();
  }, [loadVault]);

  useEffect(() => {
    const cleanup = subscribeVaultEvents(() => {
      setSyncing(true);
      if (syncTimerRef.current !== null) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        setSyncing(false);
        syncTimerRef.current = null;
      }, SYNC_DOT_DURATION_MS);
      // H14 — debounce aria-live announcements to ≤2 per second
      if (liveDebounceRef.current === null) {
        setLiveAnnouncement("Syncing");
        liveDebounceRef.current = setTimeout(() => {
          setLiveAnnouncement("");
          liveDebounceRef.current = null;
        }, 500);
      }
      loadVault();
    });
    return cleanup;
  }, [loadVault]);

  // Close theme popover on outside click
  useEffect(() => {
    if (!showThemePopover) return;
    function handleOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".theme-popover-wrap")) {
        setShowThemePopover(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showThemePopover]);

  // ── Keyboard callbacks ────────────────────────────────────────────────────

  const handleFocusQuickAdd = useCallback(() => {
    quickAddRef.current?.focus();
  }, []);

  // Sprint B — search UI was on AllTasksView; Agenda has none in v1.
  // Sprint D will wire `/` to focus the Command Palette search input.
  const handleFocusSearch = useCallback(() => {
    // no-op until Sprint D
  }, []);

  const handleEnterEdit = useCallback(() => {
    if (!selectedTaskId) return;
    const row = document.querySelector<HTMLElement>(`[data-task-id="${selectedTaskId}"]`);
    if (row) {
      // e — trigger double-click to start inline edit
      row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    }
  }, [selectedTaskId]);

  const handleEnterExpand = useCallback(() => {
    if (!selectedTaskId) return;
    const row = document.querySelector<HTMLElement>(`[data-task-id="${selectedTaskId}"]`);
    if (row) {
      // Enter — toggle inline-expand detail panel
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  }, [selectedTaskId]);

  const handleToggleSelected = useCallback(() => {
    if (!selectedTaskId) return;
    const row = document.querySelector<HTMLElement>(`[data-task-id="${selectedTaskId}"]`);
    if (row) {
      const circle = row.querySelector<HTMLElement>(".task-circle");
      circle?.click();
    }
  }, [selectedTaskId]);

  useKeyboardNav(
    handleFocusQuickAdd,
    handleFocusSearch,
    handleEnterEdit,
    handleToggleSelected,
    cycleTheme,
    handleEnterExpand
  );

  // ── Derived values ────────────────────────────────────────────────────────

  const activeProjectCount =
    vault?.projects.filter((p) => p.status === "active").length ?? 0;
  // C-8 — single source of truth for the Agenda scope. Previously this
  // used a narrower ["active","backlog","blocked","paused"] list which
  // disagreed with AgendaView's legacy-enum support, so the badge count
  // undercounted tasks on projects with status="on-track"/"at-risk"/etc.
  const agendaCount =
    vault?.projects.reduce((sum, p) => {
      if (!AGENDA_PROJECT_STATUSES.has(p.status)) return sum;
      return sum + p.tasks.filter((t) => !t.done && t.status !== "cancelled").length;
    }, 0) ?? 0;
  const firstActiveSlug =
    vault?.projects.find((p) => p.status === "active")?.slug ?? "";

  const headerLabel =
    activeTab === "projects"
      ? `Projects · ${activeProjectCount} active`
      : `Agenda · ${DATE_LABEL}`;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="sidebar">
      <header className="header">
        <h1 className="header-title">
          {headerLabel}
          {/* H14 — sync dot is presentational; screen readers get the live region below */}
          {syncing && <span className="sync-dot" aria-hidden="true" />}
        </h1>
        {/* H11 — gear is a proper <button> with ARIA popup semantics */}
        <div className="theme-popover-wrap">
          <button
            ref={gearButtonRef}
            type="button"
            className="header-icon"
            title="Theme"
            aria-haspopup="menu"
            aria-expanded={showThemePopover}
            aria-label="Theme selector"
            onClick={() => setShowThemePopover((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setShowThemePopover((v) => !v);
              }
            }}
          >
            <Settings size={14} strokeWidth={1.5} />
          </button>
          {showThemePopover && (
            <div
              className="theme-popover"
              role="menu"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setShowThemePopover(false);
                  gearButtonRef.current?.focus();
                }
              }}
            >
              {(["system", "light", "dark"] as ThemeChoice[]).map((choice, index) => (
                <button
                  key={choice}
                  className={`theme-option${theme === choice ? " active" : ""}`}
                  onClick={() => { setTheme(choice); setShowThemePopover(false); gearButtonRef.current?.focus(); }}
                  role="menuitemradio"
                  aria-checked={theme === choice}
                  autoFocus={index === 0}
                >
                  {THEME_LABELS[choice]}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* H14 — sr-only aria-live region: debounced so ≤2 announcements/second */}
      <span role="status" aria-live="polite" className="sr-only">{liveAnnouncement}</span>

      {/* Sprint B D16 — Today tab killed. Tabs: Agenda + Projects. */}
      <div className="tab-strip" role="tablist">
        <button
          id="tab-agenda"
          className={`tab${activeTab === "agenda" ? " active" : ""}`}
          onClick={() => setActiveTab("agenda" as Tab)}
          data-tab="agenda"
          role="tab"
          aria-selected={activeTab === "agenda"}
          aria-controls="panel-agenda"
        >
          Agenda
          {agendaCount > 0 && (
            <span className="count-badge" data-agenda-count={agendaCount}>
              {agendaCount}
            </span>
          )}
        </button>
        <button
          id="tab-projects"
          className={`tab${activeTab === "projects" ? " active" : ""}`}
          onClick={() => setActiveTab("projects" as Tab)}
          data-tab="projects"
          role="tab"
          aria-selected={activeTab === "projects"}
          aria-controls="panel-projects"
        >
          Projects
          {activeProjectCount > 0 && (
            <span className="count-badge">{activeProjectCount}</span>
          )}
        </button>
      </div>

      {error && (
        <div className="empty-state" style={{ color: "var(--accent)" }}>
          Failed to load vault: {error}
        </div>
      )}

      {!error && !vault && (
        <SkeletonList count={6} />
      )}

      {/* Sprint B — Agenda + Projects tabpanels (Today + Tasks killed) */}
      {!error && vault && (
        <div
          id="panel-agenda"
          role="tabpanel"
          aria-labelledby="tab-agenda"
          hidden={activeTab !== "agenda"}
        >
          {activeTab === "agenda" && (
            <AgendaView projects={vault.projects} />
          )}
        </div>
      )}

      {!error && vault && (
        <div
          id="panel-projects"
          role="tabpanel"
          aria-labelledby="tab-projects"
          hidden={activeTab !== "projects"}
        >
          {activeTab === "projects" && (
            <ProjectsView projects={vault.projects} />
          )}
        </div>
      )}

      {vault && (
        <QuickAdd
          projects={vault.projects}
          defaultSlug={firstActiveSlug}
          inputRef={quickAddRef}
        />
      )}
    </div>
  );
}
