"use client";

import { useEffect, useState } from "react";

/**
 * Dark/light toggle. The theme class is applied before hydration by the
 * inline script in the root layout (no flash); this component just flips
 * the class + localStorage afterwards.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("ss-theme", next ? "dark" : "light");
    setDark(next);
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="rounded-lg border border-edge px-2 py-1 text-sm text-ink-secondary hover:bg-hairline/40"
    >
      {dark === null ? "◐" : dark ? "☀" : "☾"}
    </button>
  );
}
