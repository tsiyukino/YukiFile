import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import type { Entry } from "../plugin-host/commands.js";
import { pathOf, rowsFor, showing, under } from "./disk.js";

/**
 * Every path the seed library holds an object at.
 *
 * The real library's *shape*, with its names replaced. What this module
 * compares is structure — how deep a path is, where its separators fall,
 * whether a segment holds CJK or a space — and that survives anonymising while
 * the filenames, which are somebody's private documents, do not travel.
 *
 * Derived rather than invented: a fixture written by whoever wrote the code
 * agrees with the code by construction, and the join bug below is exactly the
 * kind a hand-written fixture misses.
 */
function seedPaths(): string[] {
  return JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./__fixtures__/seed-paths.json", import.meta.url)),
      "utf8",
    ),
  ) as string[];
}

/** One entry as `fs.walk` reports it: named relative to the directory walked. */
function entry(name: string, kind: "file" | "folder" = "file"): Entry {
  return { path: name, kind, size: kind === "file" ? 10 : null, mtime: null };
}

describe("joining a name onto a directory", () => {
  test("a name at the root is itself", () => {
    // The library stores `Clothing`, never `/Clothing`. A leading slash makes
    // every row read as new, and adding one collides on a path already taken.
    expect(under("", "Clothing")).toBe("Clothing");
  });

  test("a name below the root carries its directory", () => {
    expect(under("Clothing", "outfit.zip")).toBe("Clothing/outfit.zip");
  });

  test("a trail is the directory it points at", () => {
    expect(pathOf([])).toBe("");
    expect(pathOf(["Clothing", "AW KLASSIK"])).toBe("Clothing/AW KLASSIK");
  });
});

describe("against the real library", () => {
  const known = new Set(seedPaths());

  test("the export is what it claims to be", () => {
    // If this breaks, every test below compares against an empty set and
    // passes by saying nothing.
    expect(known.size).toBe(441);
    expect(known.has("57ad57")).toBe(true);
  });

  test("a top-level folder already in the library is marked", () => {
    const rows = rowsFor([entry("57ad57", "folder")], "", known);

    expect(rows[0]?.known).toBe(true);
  });

  test("a folder one level down is marked too", () => {
    // The test that catches the join. `fs.walk` reports a bare name when
    // walking a directory, and the library stores the whole path. Comparing
    // unjoined looks right at the root — the spellings are identical there —
    // and then recognises nothing below it.
    const rows = rowsFor([entry("文件-24c698", "folder")], "a83d15", known);

    expect(rows[0]?.known).toBe(true);
    expect(rows[0]?.path).toBe("a83d15/文件-24c698");
    expect(rows[0]?.name).toBe("文件-24c698");
  });

  test("a file two levels down is marked", () => {
    const rows = rowsFor([entry("328642.pdf")], "a83d15/文件-24c698", known);

    expect(rows[0]?.known).toBe(true);
  });

  test("something not in the library is not marked", () => {
    const rows = rowsFor([entry("brand-new.pdf")], "57ad57", known);

    expect(rows[0]?.known).toBe(false);
  });

  test("every recorded path is recognised from its own directory", () => {
    // The whole library, one path at a time, split the way a browser would
    // have arrived at it. One unrecognised path is one row a person would be
    // invited to add twice.
    const missed = seedPaths().filter((path) => {
      const cut = path.lastIndexOf("/");
      const directory = cut === -1 ? "" : path.slice(0, cut);
      const name = cut === -1 ? path : path.slice(cut + 1);

      return !rowsFor([entry(name)], directory, known)[0]?.known;
    });

    expect(missed).toEqual([]);
  });
});

describe("a name that starts like another", () => {
  test("a sibling sharing a prefix is a different path", () => {
    // `Clothing2` is not inside `Clothing` and is not `Clothing`. Comparing on
    // a prefix rather than on the whole joined path would mark it.
    const known = new Set(["Clothing"]);
    const rows = rowsFor([entry("Clothing2", "folder")], "", known);

    expect(rows[0]?.known).toBe(false);
  });

  test("a child is not its parent", () => {
    const known = new Set(["Clothing"]);
    const rows = rowsFor([entry("outfit.zip")], "Clothing", known);

    expect(rows[0]?.known).toBe(false);
  });
});

describe("what to look at", () => {
  const rows = [
    { name: "a", path: "a", kind: "file" as const, size: 1, known: true },
    { name: "b", path: "b", kind: "file" as const, size: 1, known: false },
  ];

  test("everything, by default", () => {
    expect(showing(rows, false).map((row) => row.name)).toEqual(["a", "b"]);
  });

  test("only what is not recorded, when asked", () => {
    expect(showing(rows, true).map((row) => row.name)).toEqual(["b"]);
  });

  test("filtering does not change what was found", () => {
    // The toggle is a way of looking, not a fact about the disk, so a caller
    // that wants both counts has them without walking twice.
    showing(rows, true);

    expect(rows).toHaveLength(2);
  });
});

describe("what a row carries", () => {
  test("a folder has no size and a file does", () => {
    const rows = rowsFor([entry("f", "folder"), entry("g")], "", new Set());

    expect(rows[0]?.size).toBeNull();
    expect(rows[1]?.size).toBe(10);
  });

  test("an empty directory has no rows", () => {
    expect(rowsFor([], "Clothing", new Set())).toEqual([]);
  });

  test("the walk's order is kept", () => {
    // `fs.walk` already sorts, and sorting again would be a second answer to a
    // settled question.
    const rows = rowsFor([entry("z"), entry("a")], "", new Set());

    expect(rows.map((row) => row.name)).toEqual(["z", "a"]);
  });
});
