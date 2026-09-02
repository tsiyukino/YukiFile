/**
 * Where the frontend starts.
 *
 * Mounts the app inside Primer's theme provider and nothing else. Anything
 * that could fail — opening a library, loading plugins — already happened in
 * Rust before this window existed, so there is nothing to recover from here.
 */

import { BaseStyles, ThemeProvider } from "@primer/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./ui/App.js";
import { useColorMode } from "./ui/theme.js";

function Root(): React.JSX.Element {
  const colorMode = useColorMode();

  return (
    <StrictMode>
      <ThemeProvider colorMode={colorMode}>
        <BaseStyles>
          <App />
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
