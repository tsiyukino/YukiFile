/**
 * Where the frontend starts.
 *
 * Mounts the app inside Primer's theme provider and nothing else. Anything
 * that could fail — opening a library, loading plugins — already happened in
 * Rust before this window existed, so there is nothing to recover from here.
 */

import { BaseStyles, ThemeProvider } from "@primer/react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

// Primer's components read their colours, sizes and type from CSS variables
// these files define. Without them every component falls back to the light
// values it was compiled with, which is why the dark theme never appeared:
// the provider said "dark" and nothing was listening.
import "@primer/primitives/dist/css/base/size/size.css";
import "@primer/primitives/dist/css/base/typography/typography.css";
import "@primer/primitives/dist/css/base/motion/motion.css";
import "@primer/primitives/dist/css/functional/size/border.css";
import "@primer/primitives/dist/css/functional/size/breakpoints.css";
import "@primer/primitives/dist/css/functional/size/radius.css";
import "@primer/primitives/dist/css/functional/size/size.css";
import "@primer/primitives/dist/css/functional/size/viewport.css";
import "@primer/primitives/dist/css/functional/size/z-index.css";
import "@primer/primitives/dist/css/functional/spacing/space.css";
import "@primer/primitives/dist/css/functional/motion/motion.css";
import "@primer/primitives/dist/css/functional/typography/typography.css";
import "@primer/primitives/dist/css/functional/themes/light.css";
import "@primer/primitives/dist/css/functional/themes/dark.css";
import "./ui/app.css";

import { api, App } from "./ui/App.js";
import { modeFor, parsePreference, useColorMode, type ThemePreference } from "./ui/theme.js";

function Root(): React.JSX.Element {
  const system = useColorMode();
  const [preference, setPreference] = useState<ThemePreference>("system");

  // The stored choice, read once. Until it arrives the window follows the
  // OS, which is the default anyway; the settings page changes it live.
  useEffect(() => {
    api
      .settingGet("theme")
      .then((stored) => setPreference(parsePreference(stored)))
      .catch(() => undefined);
  }, []);

  const mode = modeFor(preference, system);

  // On the document too, not only on the provider's element: the body's
  // background and the scrollbars are outside it, and a dark page with a
  // white strip below the last row is the theme half-applied.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset["colorMode"] = mode === "night" ? "dark" : "light";
    root.dataset["lightTheme"] = "light";
    root.dataset["darkTheme"] = "dark";
    root.style.colorScheme = mode === "night" ? "dark" : "light";
  }, [mode]);

  return (
    <StrictMode>
      <ThemeProvider colorMode={mode}>
        <BaseStyles>
          <App onTheme={setPreference} />
        </BaseStyles>
      </ThemeProvider>
    </StrictMode>
  );
}

const container = document.getElementById("root");
if (!container) {
  // index.html is ours, so this cannot happen from a user action -- but
  // failing loudly beats rendering into nothing and leaving a blank window.
  throw new Error("index.html has no #root to mount into");
}

createRoot(container).render(<Root />);
