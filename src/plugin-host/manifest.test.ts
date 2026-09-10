import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import type { Contributes, Manifest } from "./types.js";

/**
 * The fields of a Rust struct, read from the source.
 *
 * Reading rather than keeping a copy, the same stance `commands.test.ts`
 * takes on the allowlist and for the same reason: a copy is a third place to
 * keep in step, and what it produces when it drifts — a manifest field the
 * core reads and this side cannot see — shows up as a contribution that
 * silently does nothing.
 */
function fieldsOf(struct: string): string[] {
  const source = readFileSync(
    fileURLToPath(new URL("../../src-tauri/src/plugin/manifest.rs", import.meta.url)),
    "utf8",
  );

  const start = source.indexOf(`pub struct ${struct} {`);
  const body = source.slice(start, source.indexOf("\n}", start));

  return [...body.matchAll(/^\s*pub (\w+):/gm)].map((match) => match[1] as string);
}

/**
 * The property names of a TypeScript interface, read from its own source.
 *
 * The types are erased at runtime, so there is nothing to reflect over. This
 * reads the declaration for the same reason the Rust side is read.
 */
function propertiesOf(name: string): string[] {
  const source = readFileSync(
    fileURLToPath(new URL("./types.ts", import.meta.url)),
    "utf8",
  );

  const start = source.indexOf(`export interface ${name} {`);
  const body = source.slice(start, source.indexOf("\n}", start));

  return [...body.matchAll(/^\s*readonly (\w+)\??:/gm)].map((match) => match[1] as string);
}

describe("both sides describe the same manifest", () => {
  test("the sources parse to something", () => {
    // If either regex stops matching, every test below passes by comparing
    // two empty lists.
    expect(fieldsOf("Contributes").length).toBeGreaterThan(5);
    expect(propertiesOf("Contributes").length).toBeGreaterThan(5);
  });

  test("Contributes has the same fields on both sides", () => {
    // A field the core reads and this side does not know about is a
    // contribution a plugin author writes, the core accepts, and nothing
    // draws. `forms` was the field that made this worth checking.
    expect(propertiesOf("Contributes").sort()).toEqual(fieldsOf("Contributes").sort());
  });

  test("Requires has the same fields on both sides", () => {
    expect(propertiesOf("Requires").sort()).toEqual(fieldsOf("Requires").sort());
  });

  test("a manifest declaring a form typechecks", () => {
    // The shape a picker's second step arrives as.
    const manifest: Manifest = {
      id: "yukifile.paper",
      contributes: { properties: ["paper"], forms: { paper: "./newpaper" } },
    };

    expect(manifest.contributes?.forms?.["paper"]).toBe("./newpaper");
  });

  test("forms is optional, like every other contribution", () => {
    const contributes: Contributes = { properties: ["paper"] };

    expect(contributes.forms).toBeUndefined();
  });
});
