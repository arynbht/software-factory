import type { Theme } from "../../shared/ipc";

/** Whether the OS currently prefers a dark color scheme. */
function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Resolve a theme setting ("system" follows the OS) to a concrete light/dark. */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") return systemPrefersDark() ? "dark" : "light";
  return theme;
}

/** Apply a theme to the document root (toggles the `dark` class, used by Tailwind). */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle(
    "dark",
    resolveTheme(theme) === "dark",
  );
}
