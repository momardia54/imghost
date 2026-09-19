import { useState } from "react";
import { MoonIcon, SunIcon } from "../icons";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export default function ThemeToggle({ className = "", label = false }: { className?: string; label?: boolean }) {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";

  function toggle() {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("imghost-theme", next);
    } catch {
      /* storage unavailable: theme still applies for this session */
    }
    setTheme(next);
  }

  return (
    <button
      className={label ? className : `icon-btn ${className}`.trim()}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      onClick={toggle}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      {label && (theme === "dark" ? "Light mode" : "Dark mode")}
    </button>
  );
}
