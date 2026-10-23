import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * No two source files may differ only by case.
 *
 * `review.ts` beside `Review.tsx` worked on Linux and opened a blank window
 * on Windows: the filesystem there is case-insensitive, so `./Review.js`
 * resolved to the pure module and the component's export was not there.
 * The convention -- pure modules lower-case, components capitalised -- makes
 * this collision easy to write, which is why a test guards it rather than
 * a note.
 */
function collisions(directory: string): string[] {
  const seen = new Map<string, string>();
  const found: string[] = [];
  for (const name of readdirSync(directory)) {
    const stem = name.replace(/\.(test\.)?tsx?$/, "").toLowerCase();
    const previous = seen.get(stem);
    if (previous !== undefined && previous.replace(/\.(test\.)?tsx?$/, "") !== name.replace(/\.(test\.)?tsx?$/, "")) {
      found.push(`${previous} and ${name}`);
    }
    seen.set(stem, name);
  }
  return found;
}

describe("file names survive a case-insensitive filesystem", () => {
  for (const directory of ["../ui", "../plugin-host"]) {
    test(directory.replace("../", "src/"), () => {
      expect(collisions(fileURLToPath(new URL(directory, import.meta.url)))).toEqual([]);
    });
  }
});
