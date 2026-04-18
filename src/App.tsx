import { useCallback, useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { fetchVault, subscribeVaultEvents } from "./api.js";
import { useSidebarStore } from "./store.js";
import { TodayView } from "./views/TodayView.js";
import { ProjectsView } from "./views/ProjectsView.js";
import { AllTasksView } from "./views/AllTasksView.js";
import { QuickAdd } from "./components/QuickAdd.js";
import { SkeletonList } from "./components/SkeletonRow.js";
import { useKeyboardNav } from "./lib/keyboard.js";
import { useTheme } from "./lib/theme.js";
import type { ThemeChoice } from "./lib/theme.js";

type Tab = "today" | "projects" | "tasks";

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
  const searchRef = useRef<HTMLInputElement | null>(null);

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

  const handleFocusSearch = useCallback(() => {
    setActiveTab("tasks");
    setTimeout(() => searchRef.current?.focus(), 50);
  }, [setActiveTab]);

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

  const todayCount = vault?.today.length ?? 0;
  const activeProjectCount =
    vault?.projects.filter((p) => p.status === "active").length ?? 0;
  const openTaskCount =
    vault?.projects.reduce(
      (sum, p) => sum + p.tasks.filter((t) => !t.done).length,
      0
    ) ?? 0;
  const firstActiveSlug =
    vault?.projects.find((p) => p.status === "active")?.slug ?? "";

  const headerLabel =
    activeTab === "projects"
      ? `Projects · ${activeProjectCount} active`
      : activeTab === "tasks"
      ? `Tasks · ${openTaskCount} open`
      : `Today · ${DATE_LABEL}`;

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

      {/* M22 — tablist + role="tab" with id + aria-controls linking to panels */}
      <div className="tab-strip" role="tablist">
        <button
          id="tab-today"
          className={`tab${activeTab === "today" ? " active" : ""}`}
          onClick={() => setActiveTab("today" as Tab)}
          data-tab="today"
          role="tab"
          aria-selected={activeTab === "today"}
          aria-controls="panel-today"
        >
          Today
          {todayCount > 0 && (
            <span className="count-badge" data-today-count={todayCount}>
              {todayCount}
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
        </button>
        <button
          id="tab-tasks"
          className={`tab${activeTab === "tasks" ? " active" : ""}`}
          onClick={() => setActiveTab("tasks" as Tab)}
          data-tab="tasks"
          role="tab"
          aria-selected={activeTab === "tasks"}
          aria-controls="panel-tasks"
        >
          Tasks
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

      {/* M22 — each view wrapped in role="tabpanel" with aria-labelledby matching tab id */}
      {!error && vault && (
        <div
          id="panel-today"
          role="tabpanel"
          aria-labelledby="tab-today"
          hidden={activeTab !== "today"}
        >
          {activeTab === "today" && (
            <TodayView tasks={vault.today} projects={vault.projects} />
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

      {!error && vault && (
        <div
          id="panel-tasks"
          role="tabpanel"
          aria-labelledby="tab-tasks"
          hidden={activeTab !== "tasks"}
        >
          {activeTab === "tasks" && (
            <AllTasksView projects={vault.projects} searchInputRef={searchRef} />
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
