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

  return (
    <StrictMode>
      <ThemeProvider colorMode={modeFor(preference, system)}>
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
