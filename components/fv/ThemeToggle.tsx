"use client";
// Light/dark switch. The light palette is the design's own (fv.css :root tokens); dark is the mapped set.
// No saved choice → follow the system. A saved choice is applied before first paint by the script in
// app/layout.tsx (THEME_BOOT), so there is no flash of the other theme.
import { useSyncExternalStore } from "react";

export const THEME_KEY = "fv-theme";
type Theme = "light" | "dark";

const listeners = new Set<() => void>();
const DARK = "(prefers-color-scheme: dark)";

/** The theme on screen: an explicit data-theme wins, otherwise the system preference. */
function current(): Theme {
  const set = document.documentElement.getAttribute("data-theme");
  if (set === "light" || set === "dark") return set;
  return window.matchMedia?.(DARK).matches ? "dark" : "light";
}
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const mq = window.matchMedia?.(DARK);
  mq?.addEventListener?.("change", onChange); // follows the system until the owner chooses
  return () => {
    listeners.delete(onChange);
    mq?.removeEventListener?.("change", onChange);
  };
}

export function ThemeToggle({ size = 38 }: { size?: number }) {
  const theme = useSyncExternalStore(subscribe, current, () => "light" as Theme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  const flip = () => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private mode: the switch still applies for this visit */
    }
    listeners.forEach((l) => l());
  };
  return (
    <button
      type="button"
      onClick={flip}
      aria-label={"Switch to " + next + " mode"}
      title={"Switch to " + next + " mode"}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size + "px",
        height: size + "px",
        flexShrink: 0,
        padding: 0,
        borderRadius: size < 34 ? "8px" : "10px",
        border: "1px solid var(--fvb-E3E6DB)",
        background: "var(--fvb-FFFFFF)",
        color: "var(--fvc-1E2A22)",
        cursor: "pointer",
      }}
    >
      {/* Shows the mode you would switch to, like most theme switches. */}
      <span aria-hidden style={{ fontSize: size < 34 ? "13px" : "16px", lineHeight: 1 }}>
        {theme === "dark" ? "☀" : "☾"}
      </span>
    </button>
  );
}
