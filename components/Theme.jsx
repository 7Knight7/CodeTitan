"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";

/* Light and dark themes. The choice is stored in this browser ("lbc-theme": "light" | "dark");
   with no stored choice the operating system's setting is used. THEME_SCRIPT runs in <head> before the page
   paints, so the right theme shows from the first frame. */
const KEY = "lbc-theme";

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${KEY}');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.classList.contains("dark")); }, []);
  const set = (next) => {
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem(KEY, next ? "dark" : "light"); } catch { /* storage blocked: still switches for this visit */ }
    setDark(next);
  };
  return [dark, set];
}

/** Sun/moon button for the top bar. */
export default function ThemeToggle({ className = "" }) {
  const [dark, set] = useTheme();
  return (
    <button onClick={() => set(!dark)} aria-pressed={dark} title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={`flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface/70 hover:text-ink ${className}`}>
      <Icon name={dark ? "sun" : "moon"} />
    </button>
  );
}
