import { describe, expect, test, vi } from "vitest";

import type { Api, Entry } from "../../src/plugin-host/commands.js";
import { childrenOf, documentFor, objectsFrom, planFrom, topLevel } from "./folder.js";

function entry(path: string, kind: "file" | "folder" = "file"): Entry {
  return { path, kind, size: kind === "file" ? 100 : null, mtime: null };
}

describe("what counts as an object here", () => {
  test("every file becomes one", () => {
    const proposed = objectsFrom([entry("a.txt"), entry("b.txt")]);

    expect(proposed.map((p) => p.paths[0])).toEqual(["a.txt", "b.txt"]);
  });

  test("a folder becomes one too", () => {
    // Somebody who put forty textures in `Clothing/AW KLASSIK MAID` named that
    // folder for a reason, and it is what they would open.
    const proposed = objectsFrom([entry("Clothing", "folder")]);

    expect(proposed).toHaveLength(1);
  });

  test("a folder and its contents are separate objects", () => {
    // This plugin's answer, and the one a VRChat library would replace: there
    // the product folder is the object and its contents are not. Nothing in
    // the core prefers either.
    const proposed = objectsFrom([
      entry("Outfit", "folder"),
      entry("Outfit/skin.png"),
    ]);

    expect(proposed).toHaveLength(2);
  });

  test("nothing on disk proposes nothing", () => {
    expect(objectsFrom([])).toEqual([]);
  });
});

describe("staying idempotent", () => {
  test("each object carries its path as a stable identity", () => {
    // Without it a second walk proposes everything again and the import
    // creates a duplicate library.
    const proposed = objectsFrom([entry("Clothing/outfit.zip")]);

    expect(proposed[0]?.key).toBe("Clothing/outfit.zip");
  });

  test("the document names that identity where the contract expects it", () => {
    // The contract's field is `id`. Writing `key` would parse as an object
    // with no identity at all, and every scan would create new objects.
    const document = JSON.parse(
      documentFor({ proposed: objectsFrom([entry("a.txt")]), skipped: [] }),
    ) as { objects: Array<{ id?: string; paths: string[] }> };

    expect(document.objects[0]?.id).toBe("a.txt");
    expect(document.objects[0]?.paths).toEqual(["a.txt"]);
  });

  test("the document declares the contract version", () => {
    // The core refuses a document without one, so a scan that omitted it
    // would fail on submission rather than on writing.
    const document = JSON.parse(documentFor({ proposed: [], skipped: [] })) as {
      version: number;
    };

    expect(document.version).toBe(1);
  });
});

describe("reading the disk", () => {
  test("the walk is what the plan is built from", async () => {
    const fsWalk = vi.fn(async () => [entry("a.txt"), entry("b", "folder")]);
    const api = { fsWalk } as unknown as Api;

    const plan = await planFrom(api, null);

    expect(fsWalk).toHaveBeenCalledWith(null);
    expect(plan.proposed).toHaveLength(2);
  });

  test("an empty library plans nothing", async () => {
    const api = { fsWalk: async () => [] } as unknown as Api;

    expect((await planFrom(api, null)).proposed).toEqual([]);
  });
});

describe("what holds what", () => {
  test("a folder contains what sits directly inside it", () => {
    const proposed = objectsFrom([
      entry("Clothing", "folder"),
      entry("Clothing/outfit.zip"),
      entry("Clothing/notes.txt"),
    ]);

    const folder = proposed.find((p) => p.key === "Clothing");
    expect(folder?.contains).toEqual(["Clothing/outfit.zip", "Clothing/notes.txt"]);
  });

  test("a folder does not contain its grandchildren", () => {
    // A library root containing all 1518 objects is true and useless. Direct
    // children are what makes a tree navigable one level at a time.
    const proposed = objectsFrom([
      entry("a", "folder"),
      entry("a/b", "folder"),
      entry("a/b/deep.txt"),
    ]);

    expect(proposed.find((p) => p.key === "a")?.contains).toEqual(["a/b"]);
  });

  test("a file contains nothing", () => {
    expect(objectsFrom([entry("a.txt")])[0]?.contains).toEqual([]);
  });

  test("a path that looks like a child but was not walked is left out", () => {
    // childrenOf matches on a prefix, and a prefix match is not proof the
    // thing exists. An edge to an object nothing proposed would dangle.
    const walked = [entry("a", "folder"), entry("a/real.txt")];
    const known = new Set(walked.map((e) => e.path));

    expect(childrenOf("a", walked, known)).toEqual(["a/real.txt"]);
  });

  test("a sibling whose name starts with the folder's name is not inside it", () => {
    // `Clothing2` is not in `Clothing`. Matching on the name rather than on
    // the name plus a separator would put it there.
    const proposed = objectsFrom([
      entry("Clothing", "folder"),
      entry("Clothing2", "folder"),
    ]);

    expect(proposed.find((p) => p.key === "Clothing")?.contains).toEqual([]);
  });
});

describe("what a list should show first", () => {
  test("only what nothing else contains", () => {
    // The answer to "441 rows, how does anybody organise this": most of them
    // are inside something, and the top of the tree is a handful.
    const proposed = objectsFrom([
      entry("Clothing", "folder"),
      entry("Clothing/outfit.zip"),
      entry("Clothing/AW", "folder"),
      entry("Clothing/AW/skin.png"),
      entry("thesis.pdf"),
    ]);

    expect(topLevel(proposed).map((p) => p.key)).toEqual(["Clothing", "thesis.pdf"]);
  });

  test("a flat library is all top level", () => {
    const proposed = objectsFrom([entry("a.txt"), entry("b.txt")]);

    expect(topLevel(proposed)).toHaveLength(2);
  });

  test("nothing at all has no top", () => {
    expect(topLevel([])).toEqual([]);
  });
});

describe("the document carries the hierarchy", () => {
  test("a folder's contents become contains edges", () => {
    const document = JSON.parse(
      documentFor({
        proposed: objectsFrom([entry("a", "folder"), entry("a/b.txt")]),
        skipped: [],
      }),
    ) as { objects: Array<{ id?: string; edges?: Array<{ kind: string; object: string }> }> };

    const folder = document.objects.find((o) => o.id === "a");
    expect(folder?.edges).toEqual([{ kind: "contains", object: "a/b.txt" }]);
  });

  test("a file carries no edges", () => {
    const document = JSON.parse(
      documentFor({ proposed: objectsFrom([entry("a.txt")]), skipped: [] }),
    ) as { objects: Array<{ edges?: unknown[] }> };

    expect(document.objects[0]?.edges).toEqual([]);
  });
});
