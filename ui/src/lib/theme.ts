// Theme state: light | dark. First visit follows the OS preference; the user's choice is
// persisted to localStorage and applied by toggling data-theme on <html> (all colours are
// CSS tokens, so the switch is immediate — no reload, no re-styling of components in JS).

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "oemtracker-theme";

export function resolveInitialTheme(): Theme {
  // An inline bootstrap in index.html usually sets this before React mounts.
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* localStorage unavailable */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme(): [Theme, () => void, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggle = useCallback(() => setThemeState((t) => (t === "dark" ? "light" : "dark")), []);
  return [theme, toggle, setThemeState];
}
