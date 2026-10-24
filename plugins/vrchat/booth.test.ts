import { describe, expect, test, vi } from "vitest";

import type { ObjectActionProps } from "../../src/plugin-host/panel.js";
import { runObjectAction } from "./actions.js";
import { listingFrom, listingUrl, yen } from "./booth.js";

const answer = JSON.stringify({
  id: 6467347,
  name: "【23アバター対応】Wolf Float Hair",
  price: "¥ 1,200",
  shop: { name: "Pirouette", subdomain: "pirouette" },
  images: [{ original: "https://booth.pximg.net/x/original.jpg", resized: "https://booth.pximg.net/x/c/300x300/resized.jpg" }],
});

describe("reading a listing", () => {
  test("the fields the plugin stores, out of what the shop sends", () => {
    expect(listingFrom(answer)).toEqual({
      ok: true,
      listing: {
        title: "【23アバター対応】Wolf Float Hair",
        price: "1200",
        vendor: "Pirouette",
        image: "https://booth.pximg.net/x/c/300x300/resized.jpg",
      },
    });
  });

  test("a field that moved costs the field, not the fetch", () => {
    const read = listingFrom(JSON.stringify({ name: "x", price: null, shop: "gone", images: "none" }));
    expect(read).toEqual({ ok: true, listing: { title: "x" } });
  });

  test("not JSON, or no name, is not a listing", () => {
    expect(listingFrom("<html>")).toMatchObject({ ok: false });
    expect(listingFrom(JSON.stringify({ price: "¥ 100" }))).toMatchObject({ ok: false, problem: "the listing has no name" });
  });

  test("yen in every spelling, and nothing when there are no digits", () => {
    expect(yen("¥ 1,200")).toBe("1200");
    expect(yen("1200 JPY")).toBe("1200");
    expect(yen(800)).toBe("800");
    expect(yen("free")).toBeUndefined();
    expect(yen(null)).toBeUndefined();
  });

  test("the endpoint names the item", () => {
    expect(listingUrl("6467347")).toBe("https://booth.pm/en/items/6467347.json");
  });
});

describe("the fetch listing action", () => {
  function pressed(fields: Record<string, string>, locations = [{ path: "Hair/wolf.zip", kind: "file" as const, size: 1 }]) {
    const api = {
      objectFlat: vi.fn(async () => ({
        id: "1",
        shared: {},
        regions: [{ property: "booth", instance: 1, fields }],
        skipped: [],
        carries: ["booth#1"],
        locations,
      })),
      httpGet: vi.fn(async () => ({ status: 200, body: answer })),
      coverFetch: vi.fn(async () => ".yukifile/covers/abc.png"),
      importPropose: vi.fn(async (_label: string, _document: string) => ({ written: 4, unchanged: 0, objects_created: 0, terms: 0, edges: 0, pending: null })),
    };
    const props: ObjectActionProps = {
      api: api as unknown as ObjectActionProps["api"],
      action: "fetch listing",
      objectId: "1",
      property: "booth",
      instance: 1,
    };
    return { api, props };
  }

  test("fetches by item number, stores the picture, and proposes under booth#1", async () => {
    const { api, props } = pressed({ item_id: "6467347" });

    const result = await runObjectAction(props);

    expect(api.httpGet).toHaveBeenCalledWith("https://booth.pm/en/items/6467347.json");
    expect(api.coverFetch).toHaveBeenCalledWith("https://booth.pximg.net/x/c/300x300/resized.jpg");
    const document = JSON.parse(api.importPropose.mock.calls[0]?.[1] ?? "{}") as { objects: Array<{ paths: string[]; values: Record<string, string> }> };
    expect(document.objects[0]?.paths).toEqual(["Hair/wolf.zip"]);
    expect(document.objects[0]?.values).toEqual({
      "booth#1/title": "【23アバター対応】Wolf Float Hair",
      "booth#1/price": "1200",
      "booth#1/vendor": "Pirouette",
      "booth#1/cover": ".yukifile/covers/abc.png",
    });
    expect(result).toEqual({ summary: "4 written", changed: true });
  });

  test("the number is read out of the url when there is no item_id", async () => {
    const { api, props } = pressed({ url: "https://unya28.booth.pm/items/5848934" });
    await runObjectAction(props);
    expect(api.httpGet).toHaveBeenCalledWith("https://booth.pm/en/items/5848934.json");
  });

  test("no number, no location, or a shop that answers badly: said, not fetched or proposed", async () => {
    const none = pressed({});
    expect(await runObjectAction(none.props)).toMatchObject({ changed: false, summary: /no listing number/ });
    expect(none.api.httpGet).not.toHaveBeenCalled();

    const nowhere = pressed({ item_id: "1" }, []);
    expect(await runObjectAction(nowhere.props)).toMatchObject({ changed: false, summary: /no location/ });

    const gone = pressed({ item_id: "1" });
    gone.api.httpGet.mockImplementation(async () => ({ status: 404, body: "" }));
    expect(await runObjectAction(gone.props)).toMatchObject({ changed: false, summary: "Booth answered 404 for item 1" });
    expect(gone.api.importPropose).not.toHaveBeenCalled();
  });

  test("a picture that will not fetch costs the picture, not the listing", async () => {
    const { api, props } = pressed({ item_id: "1" });
    api.coverFetch.mockImplementation(async () => {
      throw { kind: "unreadable", detail: "x" };
    });

    await runObjectAction(props);

    const document = JSON.parse(api.importPropose.mock.calls[0]?.[1] ?? "{}") as { objects: Array<{ values: Record<string, string> }> };
    expect(document.objects[0]?.values["booth#1/cover"]).toBeUndefined();
    expect(document.objects[0]?.values["booth#1/title"]).toBeDefined();
  });
});
