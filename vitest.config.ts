import { defineConfig } from "vitest/config";

/**
 * Tests run in two environments.
 *
 * Most of the code under test is pure and runs in node, which is faster and
 * makes an accidental DOM dependency show up as a failure rather than passing
 * quietly. Component tests need a document, so `.tsx` files get jsdom through
 * a project of their own — `environmentMatchGlobs` did this in vitest 2 and
 * is gone in 4.
 *
 * `server.deps.inline` puts Primer through Vite's transform rather than
 * letting node import it directly. Primer's components import their own CSS,
 * and node has no idea what a `.css` file is — without this the component
 * tests do not fail, they refuse to run at all, which is worse because the
 * suite still reports a passing count.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["**/*.test.ts"],
        },
      },
      {
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["**/*.test.tsx"],
          setupFiles: ["./src/ui/setup.ts"],
          server: { deps: { inline: [/@primer\/react/] } },
        },
      },
    ],
  },
});
