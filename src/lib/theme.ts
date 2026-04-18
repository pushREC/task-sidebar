import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "vault-sidebar-theme";

function readStoredTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // localStorage unavailable
  }
  return "system";
}

function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === "light") return "light";
  if (choice === "dark") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute("data-theme", resolved);
}

const CYCLE: ThemeChoice[] = ["system", "light", "dark"];

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeChoice>(readStoredTheme);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readStoredTheme()));

  // Apply on mount and when theme changes
  useEffect(() => {
    const newResolved = resolveTheme(theme);
    setResolved(newResolved);
    applyTheme(newResolved);

    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }

    if (theme !== "system") return;

    // Watch system preference when in system mode
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange() {
      const updated = resolveTheme("system");
      setResolved(updated);
      applyTheme(updated);
    }
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  function setTheme(next: ThemeChoice): void {
    setThemeState(next);
  }

  function cycleTheme(): void {
    setThemeState((current) => {
      const idx = CYCLE.indexOf(current);
      return CYCLE[(idx + 1) % CYCLE.length];
    });
  }

  return { theme, setTheme, cycleTheme, resolved };
}
