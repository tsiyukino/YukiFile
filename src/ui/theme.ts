/**
 * Which colour mode the window is in.
 *
 * `2026-09-01_ui-primer-not-github-clone.md` says light and dark are both
 * first-class and that Primer gives no excuse for one being an afterthought.
 * Following the operating system is what makes that true without anybody
 * choosing a default that is wrong half the time.
 *
 * The toggle is a library setting, `theme`: `system`, `light` or `dark`. It
 * lives in the library's own table rather than in localStorage, so copying
 * the library copies the choice, and so it sits with the other settings.
 * `system` is the default and means what this file always did.
 */

import { useEffect, useState } from "react";

/** What Primer's `ThemeProvider` takes. */
export type ColorMode = "day" | "night";

/** The media query the OS answers. */
const DARK = "(prefers-color-scheme: dark)";

/** The mode the OS is asking for right now. */
export function currentMode(matcher: MediaQueryList | undefined): ColorMode {
  return matcher?.matches ? "night" : "day";
}

/**
 * Follow the operating system, including while the window is open.
 *
 * Reading the query once at startup would leave the window in the wrong theme
 * for anyone whose system switches at sunset — which is most people who use
 * dark mode at all.
 */
export function useColorMode(): ColorMode {
  const [mode, setMode] = useState<ColorMode>(() =>
    currentMode(typeof window === "undefined" ? undefined : window.matchMedia(DARK)),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const matcher = window.matchMedia(DARK);
    const update = (): void => setMode(currentMode(matcher));

    update();
    matcher.addEventListener("change", update);
    return () => matcher.removeEventListener("change", update);
  }, []);

  return mode;
}

/** What a person may choose. */
export type ThemePreference = "system" | "light" | "dark";

/** The preference a stored setting names, with anything else read as `system`. */
export function parsePreference(stored: string | null | undefined): ThemePreference {
  return stored === "light" || stored === "dark" ? stored : "system";
}

/** The mode to draw, given the preference and what the OS asks for. */
export function modeFor(preference: ThemePreference, system: ColorMode): ColorMode {
  if (preference === "light") return "day";
  if (preference === "dark") return "night";
  return system;
}
