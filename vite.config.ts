import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite serves the frontend; Tauri points a webview at it.
 *
 * The fixed port matters: `tauri.conf.json` names `devUrl` explicitly, and a
 * port that moved when 5173 was busy would leave the window pointed at
 * nothing. `strictPort` turns that into a startup failure instead of a blank
 * window nobody can explain.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  // Tauri reads the build output from here; tauri.conf.json says `../dist`
  // relative to src-tauri, which is this.
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
