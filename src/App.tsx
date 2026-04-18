import { useCallback, useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { fetchVault, subscribeVaultEvents, type SSEConnectionState } from "./api.js";
import { useSidebarStore } from "./store.js";
import { AgendaView } from "./views/AgendaView.js";
import { ProjectsView } from "./views/ProjectsView.js";
import { QuickAdd } from "./components/QuickAdd.js";
import { SkeletonList } from "./components/SkeletonRow.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { OfflineCard } from "./components/OfflineCard.js";
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

// Sprint F P04 — sync pill lifecycle:
//   SSE event fires → "saving" for 400ms → "synced" for 800ms → hidden.
const SYNC_SAVING_MS = 400;
const SYNC_SYNCED_MS = 800;

// Sprint F E02 — show SSE reconnect banner after >10s disconnected.
const SSE_BANNER_THRESHOLD_MS = 10_000;

// Sprint F E06 — localStorage key for onboarding-dismissed flag.
const ONBOARDING_KEY = "vault-sidebar-onboarding-dismissed";

const THEME_LABELS: Record<ThemeChoice, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

type SyncState = "idle" | "saving" | "synced";

export function App() {
  const [error, setError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [sseState, setSseState] = useState<SSEConnectionState>("open");
  const [sseBannerVisible, setSseBannerVisible] = useState(false);
  const [showThemePopover, setShowThemePopover] = useState(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimerTwoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickAddRef = useRef<HTMLInputElement | null>(null);

  const vault = useSidebarStore((s) => s.vault);
  const setVault = useSidebarStore((s) => s.setVault);
  const activeTab = useSidebarStore((s) => s.activeTab);
  const setActiveTab = useSidebarStore((s) => s.setActiveTab);
  const selectedTaskId = useSidebarStore((s) => s.selectedTaskId);

  const { theme, setTheme, cycleTheme } = useTheme();
  const gearButtonRef = useRef<HTMLButtonElement | null>(null);

  // Sprint F E06 — first-launch onboarding card. Read once on mount; will
  // re-render on dismiss. Persists across reloads via localStorage.
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ONBOARDING_KEY) === "1";
    } catch {
      return true; // fail safe — don't show onboarding if storage broken
    }
  });

  function dismissOnboarding() {
    try { localStorage.setItem(ONBOARDING_KEY, "1"); } catch { /* ignore */ }
    setOnboardingDismissed(true);
  }

  // H14 — debounced live-region text: at most 1 announcement per 500ms
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const liveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sprint F — sync pill helper: flash saving → synced → hide.
  function pulseSyncPill() {
    setSyncState("saving");
    if (syncTimerRef.current !== null) clearTimeout(syncTimerRef.current);
    if (syncTimerTwoRef.current !== null) clearTimeout(syncTimerTwoRef.current);
    syncTimerRef.current = setTimeout(() => {
      setSyncState("synced");
      syncTimerTwoRef.current = setTimeout(() => {
        setSyncState("idle");
        syncTimerTwoRef.current = null;
      }, SYNC_SYNCED_MS);
      syncTimerRef.current = null;
    }, SYNC_SAVING_MS);
  }

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      if (syncTimerRef.current !== null) clearTimeout(syncTimerRef.current);
      if (syncTimerTwoRef.current !== null) clearTimeout(syncTimerTwoRef.current);
      if (sseBannerTimerRef.current !== null) clearTimeout(sseBannerTimerRef.current);
      if (liveDebounceRef.current !== null) clearTimeout(liveDebounceRef.current);
    };
  }, []);

  // M15 — stable reference via useCallback prevents stale closure in SSE effect
  const loadVault = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchVault();
      setVault(data);
      setError(null);
    } catch (err: unknown) {
      setError(String(err));
    }
  }, [setVault]);

  useEffect(() => {
    void loadVault();
  }, [loadVault]);

  useEffect(() => {
    const cleanup = subscribeVaultEvents(
      () => {
        pulseSyncPill();
        // H14 — debounce aria-live announcements
        if (liveDebounceRef.current === null) {
          // Sprint F E07 — include a richer announcement including counts
          // when available at announce time.
          const announceText = vault
            ? `Vault updated · ${vault.projects.length} projects`
            : "Syncing";
          setLiveAnnouncement(announceText);
          liveDebounceRef.current = setTimeout(() => {
            setLiveAnnouncement("");
            liveDebounceRef.current = null;
          }, 500);
        }
        void loadVault();
      },
      (state) => {
        setSseState(state);
        // Sprint F E02 — banner only if still disconnected after 10s.
        if (state === "open") {
          setSseBannerVisible(false);
          if (sseBannerTimerRef.current !== null) {
            clearTimeout(sseBannerTimerRef.current);
            sseBannerTimerRef.current = null;
          }
        } else if (sseBannerTimerRef.current === null) {
          sseBannerTimerRef.current = setTimeout(() => {
            setSseBannerVisible(true);
            sseBannerTimerRef.current = null;
          }, SSE_BANNER_THRESHOLD_MS);
        }
      }
    );
    return cleanup;
  }, [loadVault, vault]);

  // E08 — Close theme popover on outside click + return focus to gear button.
  useEffect(() => {
    if (!showThemePopover) return;
    function handleOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".theme-popover-wrap")) {
        setShowThemePopover(false);
        gearButtonRef.current?.focus();
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
    // no-op — Sprint D's ⌘K palette is wired in useKeyboardNav directly.
  }, []);

  const handleEnterEdit = useCallback(() => {
    if (!selectedTaskId) return;
    const row = document.querySelector<HTMLElement>(`[data-task-id="${selectedTaskId}"]`);
    if (row) {
      row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    }
  }, [selectedTaskId]);

  const handleEnterExpand = useCallback(() => {
    if (!selectedTaskId) return;
    const row = document.querySelector<HTMLElement>(`[data-task-id="${selectedTaskId}"]`);
    if (row) {
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

  // Sprint F — sync pill class + label.
  const syncPillClass =
    syncState === "idle"
      ? "sync-pill sync-pill--hidden"
      : `sync-pill sync-pill--${syncState}`;
  const syncPillLabel = syncState === "saving" ? "saving" : syncState === "synced" ? "synced" : "";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="sidebar">
      {/* Sprint F E02 — SSE reconnect banner */}
      {sseBannerVisible && sseState !== "open" && (
        <div className="sse-banner" role="status" aria-live="polite">
          <span className="sse-banner__dot" aria-hidden="true" />
          {sseState === "closed"
            ? "Disconnected from server"
            : "Reconnecting to vault…"}
        </div>
      )}

      <header className="header">
        <h1 className="header-title">
          {headerLabel}
          {/* P04 — sync pill (replaces sync-dot). Screen readers get the
              aria-live region below; the pill is visually redundant. */}
          <span className={syncPillClass} aria-hidden="true">{syncPillLabel}</span>
        </h1>
        <div className="theme-popover-wrap">
          <button
            ref={gearButtonRef}
            type="button"
            className="header-icon press-scale"
            title="Theme · ⌘D"
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
              {(["system", "light", "dark"] as ThemeChoice[]).map((choice) => (
                <button
                  key={choice}
                  className={`theme-option press-scale${theme === choice ? " active" : ""}`}
                  onClick={() => { setTheme(choice); setShowThemePopover(false); gearButtonRef.current?.focus(); }}
                  role="menuitemradio"
                  aria-checked={theme === choice}
                  // P05 — autoFocus current theme (not always first).
                  autoFocus={theme === choice}
                >
                  {THEME_LABELS[choice]}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <span role="status" aria-live="polite" className="sr-only">{liveAnnouncement}</span>

      <div className="tab-strip" role="tablist">
        <button
          id="tab-agenda"
          className={`tab press-scale${activeTab === "agenda" ? " active" : ""}`}
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
          className={`tab press-scale${activeTab === "projects" ? " active" : ""}`}
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

      {/* Sprint F E06 — first-launch onboarding (3 bullets + `a` hint) */}
      {vault && !onboardingDismissed && (
        <div className="onboarding-card" role="note" aria-label="Onboarding tips">
          <div className="onboarding-card__title">Welcome to vault-sidebar</div>
          <ul className="onboarding-card__list">
            <li>Press <kbd>a</kbd> to quick-add a task</li>
            <li>Press <kbd>⌘K</kbd> to search across all tasks</li>
            <li>Press <kbd>1</kbd> / <kbd>2</kbd> to switch tabs</li>
          </ul>
          <button
            type="button"
            className="onboarding-card__dismiss press-scale"
            onClick={dismissOnboarding}
          >
            Got it
          </button>
        </div>
      )}

      {/* A4 — class instead of inline style */}
      {error && !vault && (
        <OfflineCard message={error} onRetry={loadVault} />
      )}
      {error && vault && (
        <div className="empty-state empty-state--error">
          Vault stale: {error}
        </div>
      )}

      {!error && !vault && (
        <SkeletonList count={6} />
      )}

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
      <CommandPalette />
    </div>
  );
}
