/**
 * Which colour mode the window is in.
 *
 * `2026-09-01_ui-primer-not-github-clone.md` says light and dark are both
 * first-class and that Primer gives no excuse for one being an afterthought.
 * Following the operating system is what makes that true without anybody
 * choosing a default that is wrong half the time.
 *
 * There is deliberately no in-app toggle yet. A toggle is a stored preference,
 * and a preference stored before there is anywhere to store it would be
 * localStorage in a desktop app whose data lives in `.yukifile/`. It belongs
 * with library settings, not here.
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
