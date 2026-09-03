import { describe, expect, test, vi } from "vitest";

import type { Api, Entry } from "../../src/plugin-host/commands.js";
import { documentFor, objectsFrom, planFrom } from "./folder.js";

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
