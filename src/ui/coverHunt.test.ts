import { describe, expect, test, vi } from "vitest";

import type { Api, AppApi, FlatObject, Summary } from "../plugin-host/commands.js";
import { findCovers } from "./coverHunt.js";

function flat(id: string, locations: FlatObject["locations"]): FlatObject {
  return { id, shared: {}, regions: [], skipped: [], carries: [], locations };
}

const summaries: Summary[] = [
  { id: "1", name: "Outfit", path: "Clothing/Outfit", kind: "folder", cover: null },
  { id: "2", name: "Shader pack", path: "Editor/shader.zip", kind: "file", cover: null },
  { id: "3", name: "Has one", path: "Hair/a", kind: "folder", cover: ".yukifile/covers/x.png" },
  { id: "4", name: "Clothing", path: null, kind: null, cover: null, children: 3 },
  { id: "5", name: "Broken", path: "Bad/b.zip", kind: "file", cover: null },
  { id: "6", name: "Package only", path: "Hair/h.unitypackage", kind: "file", cover: null },
];

function world() {
  const api = {
    objectQuery: vi.fn(async () => ({ ids: summaries.map((s) => s.id), total: summaries.length })),
    objectSummaries: vi.fn(async () => summaries),
    objectFlat: vi.fn(async (id: string) => {
      const row = summaries.find((s) => s.id === id);
      return flat(id, row?.path ? [{ path: row.path, kind: row.kind ?? "file", size: null }] : []);
    }),
    fsWalk: vi.fn(async () => [
      { path: "Textures/body_normal.png", kind: "file", size: 9_000_000, mtime: null },
      { path: "thumbnail.png", kind: "file", size: 300_000, mtime: null },
    ]),
    archiveList: vi.fn(async (path: string) => {
      if (path.startsWith("Bad")) throw { kind: "unreadable", detail: path };
      return [{ path: "Tex/mask.png", size: 10, compressed_size: 10, is_dir: false, escapes_root: false }];
    }),
    unitypackageList: vi.fn(async () => [{ guid: "g1", path: "Assets/Hair/Hair.prefab", size: 100, has_preview: true }]),
  };
  const app = { coverSet: vi.fn(async () => "stored.png") };
  return { api, app };
}

describe("finding covers for the whole library", () => {
  test("covers what has a picture, skips what has a cover or is a grouping, and keeps going past a failure", async () => {
    const { api, app } = world();
    const result = await findCovers(api as unknown as Api, app as unknown as AppApi, {
      packages: true,
      stopped: () => false,
      onProgress: () => undefined,
    });

    expect(result.looked).toBe(4);
    expect(result.found).toBe(2);
    expect(result.unreadable).toEqual(["Broken"]);
    expect(app.coverSet).toHaveBeenCalledWith("1", { from: "file", path: "Clothing/Outfit/thumbnail.png" });
    expect(app.coverSet).toHaveBeenCalledWith("6", { from: "preview", path: "Hair/h.unitypackage", guid: "g1" });
    // A zip holding nothing but a mask gets no cover rather than a bad one.
    expect(app.coverSet).not.toHaveBeenCalledWith("2", expect.anything());
    expect(api.objectFlat).not.toHaveBeenCalledWith("3");
    expect(api.objectFlat).not.toHaveBeenCalledWith("4");
  });

  test("packages are left unread unless asked", async () => {
    const { api, app } = world();
    const result = await findCovers(api as unknown as Api, app as unknown as AppApi, {
      packages: false,
      stopped: () => false,
      onProgress: () => undefined,
    });
    expect(api.unitypackageList).not.toHaveBeenCalled();
    expect(result.found).toBe(1);
  });

  test("a stop is honoured between objects", async () => {
    const { api, app } = world();
    let calls = 0;
    const result = await findCovers(api as unknown as Api, app as unknown as AppApi, {
      packages: true,
      stopped: () => ++calls > 1,
      onProgress: () => undefined,
    });
    expect(result.stopped).toBe(true);
    expect(result.looked).toBe(1);
  });
});
