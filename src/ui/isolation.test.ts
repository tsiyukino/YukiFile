import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Tauri is reachable from exactly one file.
 *
 * `plugin-host/commands.ts` takes an injected `Invoke` so that panels and the
 * host can be tested without a running app. That only holds while there is one
 * supplier: a second `import { invoke } from "@tauri-apps/api"` anywhere would
 * give some code a direct line to the runtime, and whatever imports it stops
 * being testable without one.
 *
 * The Rust side has the same rule enforced the same way -- boundary.rs keeps
 * `#[tauri::command]` inside `src/bridge/`.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The one file allowed to reach the runtime. */
const SUPPLIER = join("src", "ui", "invoke.ts");

/** Every TypeScript source file, tests included. */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "target") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sources(path, found);
    } else if (/\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

/** Strip comments, so a file explaining the rule does not break it. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("the Tauri runtime has one door", () => {
  test("only invoke.ts imports @tauri-apps", () => {
    const offenders = [join(ROOT, "src"), join(ROOT, "plugins")]
      .flatMap((dir) => sources(dir))
      .filter((path) => !path.endsWith(SUPPLIER))
      .filter((path) => /from\s+["']@tauri-apps/.test(code(readFileSync(path, "utf8"))));

    expect(
      offenders.map((path) => path.slice(ROOT.length)),
      "a second file reaches Tauri directly, so whatever imports it can no " +
        "longer be tested without a running app",
    ).toEqual([]);
  });

  test("the supplier this test guards actually exists", () => {
    // Without this, renaming invoke.ts would make the check above vacuous:
    // no file is exempt, and no file imports Tauri, so it passes.
    const supplier = readFileSync(join(ROOT, SUPPLIER), "utf8");

    expect(supplier).toMatch(/from\s+["']@tauri-apps/);
  });

  test("no plugin reaches the runtime", () => {
    // A plugin calling Tauri directly would bypass the allowlist entirely,
    // which is the boundary the whole command surface exists to hold.
    const offenders = sources(join(ROOT, "plugins")).filter((path) =>
      /@tauri-apps/.test(code(readFileSync(path, "utf8"))),
    );

    expect(offenders).toEqual([]);
  });
});
