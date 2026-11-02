import { describe, expect, test, vi } from "vitest";

import type { LibraryActionProps } from "../../src/plugin-host/panel.js";
import { fetchAllListings, runLibraryAction } from "./action.js";

const answer = JSON.stringify({
  name: "Wolf Float Hair",
  price: "¥ 1,200",
  shop: { name: "Pirouette" },
  images: [{ resized: "https://booth.pximg.net/x/resized.jpg" }],
});

/** Three Booth objects: one to fetch, one fetched already, one with no number. */
function world() {
  const regions: Record<string, Record<string, string>> = {
    "1": { item_id: "6467347" },
    "2": { item_id: "1" },
    "3": {},
  };
  const api = {
    objectQuery: vi.fn(async () => ({ ids: ["1", "2", "3"], total: 3 })),
    objectFlat: vi.fn(async (id: string) => ({
      id,
      // Object 2 was fetched before: the shop's cover is among its sources.
      shared: id === "2" ? { cover: [{ value: ".yukifile/covers/done.png", from: "booth#1" }] } : {},
      regions: [{ property: "booth", instance: 1, fields: regions[id] ?? {} }],
      skipped: [],
      carries: ["booth#1"],
      locations: [{ path: `Hair/${id}`, kind: "folder", size: null }],
    })),
    httpGet: vi.fn(async () => ({ status: 200, body: answer })),
    coverFetch: vi.fn(async () => ".yukifile/covers/new.png"),
    importPropose: vi.fn(async (_label: string, _document: string) => ({
      written: 4,
      unchanged: 0,
      objects_created: 0,
      terms: 0,
      edges: 0,
      pending: null,
    })),
  };
  return api;
}

describe("fetching every listing", () => {
  test("fetches only what has a number and no shop cover yet", async () => {
    const api = world();
    const pause = vi.fn(async () => undefined);
    const result = await fetchAllListings(api as unknown as LibraryActionProps["api"], pause);

    expect(api.httpGet).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ summary: "1 of 1 listings fetched", changed: true });
    const document = JSON.parse(api.importPropose.mock.calls[0]?.[1] ?? "{}") as { objects: { values: Record<string, string> }[] };
    expect(document.objects[0]?.values["booth#1/cover"]).toBe(".yukifile/covers/new.png");
    expect(pause).not.toHaveBeenCalled();
  });

  test("waits between requests and keeps going past a failure", async () => {
    const api = world();
    api.objectFlat.mockImplementation(async (id: string) => ({
      id,
      shared: {},
      regions: [{ property: "booth", instance: 1, fields: { item_id: id } }],
      skipped: [],
      carries: ["booth#1"],
      locations: [{ path: `Hair/${id}`, kind: "folder", size: null }],
    }));
    api.httpGet.mockImplementationOnce(async () => ({ status: 404, body: "" }));
    const pause = vi.fn(async () => undefined);
    const result = await fetchAllListings(api as unknown as LibraryActionProps["api"], pause);

    expect(api.httpGet).toHaveBeenCalledTimes(3);
    expect(pause).toHaveBeenCalledTimes(2);
    expect(result.summary).toBe("2 of 3 listings fetched, 1 gave nothing new or failed");
  });

  test("says how far it got", async () => {
    const api = world();
    const progress = vi.fn();
    await fetchAllListings(api as unknown as LibraryActionProps["api"], async () => undefined, progress);
    expect(progress).toHaveBeenCalledWith(0, 1);
    expect(progress).toHaveBeenLastCalledWith(1, 1);
  });

  test("is one of the plugin's library actions", async () => {
    const api = world();
    api.objectQuery.mockImplementation(async () => ({ ids: [], total: 0 }));
    const result = await runLibraryAction({ api: api as unknown as LibraryActionProps["api"], action: "fetch booth listings" });
    expect(result.summary).toBe("every recorded listing is fetched already");
  });
});
