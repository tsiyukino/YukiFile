import { describe, expect, test, vi } from "vitest";

import type { ObjectActionProps } from "../../src/plugin-host/panel.js";
import { runObjectAction } from "./actions.js";
import { hostAllowed, type FlatObject } from "../../src/plugin-host/commands.js";
import manifest from "./manifest.json";
import { listingFrom, listingUrl, listingValues, sameShop, shopMismatch, yen } from "./booth.js";

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
        // The original first: a cover is kept at up to 512 pixels.
        image: "https://booth.pximg.net/x/original.jpg",
        images: ["https://booth.pximg.net/x/original.jpg", "https://booth.pximg.net/x/c/300x300/resized.jpg"],
      },
    });
  });

  test("the pictures a listing names are on a host the plugin may reach", () => {
    // They are not on booth.pm. Every fetch once came back without its
    // picture because the image host was missing from this list, and the
    // refusal was swallowed.
    const hosts = manifest.contributes.hosts;
    expect(hostAllowed(hosts, "https://booth.pximg.net/c/300x300_a2_g5/abc/i/4377098/x_base_resized.jpg")).toBe(true);
    expect(hostAllowed(hosts, "https://booth.pm/en/items/4377098.json")).toBe(true);
    expect(hostAllowed(hosts, "https://qrochairo.booth.pm/items/4377098")).toBe(true);
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
      objectFlat: vi.fn(async (): Promise<FlatObject> => ({
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
    expect(api.coverFetch).toHaveBeenCalledWith("https://booth.pximg.net/x/original.jpg");
    const document = JSON.parse(api.importPropose.mock.calls[0]?.[1] ?? "{}") as { objects: Array<{ paths: string[]; values: Record<string, string> }> };
    expect(document.objects[0]?.paths).toEqual(["Hair/wolf.zip"]);
    expect(document.objects[0]?.values).toEqual({
      "booth#1/title": "【23アバター対応】Wolf Float Hair",
      "booth#1/price": "1200",
      "booth#1/vendor": "Pirouette",
      "booth#1/url": "https://booth.pm/ja/items/6467347",
      "booth#1/cover": ".yukifile/covers/abc.png",
    });
    expect(result).toMatchObject({ summary: "4 written", changed: true });
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

  test("a picture that will not fetch costs the picture, not the listing, and says why", async () => {
    const { api, props } = pressed({ item_id: "1" });
    api.coverFetch.mockImplementation(async () => {
      throw { kind: "unreadable", detail: "x" };
    });

    const result = await runObjectAction(props);

    const document = JSON.parse(api.importPropose.mock.calls[0]?.[1] ?? "{}") as { objects: Array<{ values: Record<string, string> }> };
    expect(document.objects[0]?.values["booth#1/cover"]).toBeUndefined();
    expect(document.objects[0]?.values["booth#1/title"]).toBeDefined();
    expect(result.summary).toContain("no picture: unreadable: x");
    // Both sizes were tried before giving up.
    expect(api.coverFetch).toHaveBeenCalledTimes(2);
  });

  test("the smaller picture is tried when the original will not come", async () => {
    const { api, props } = pressed({ item_id: "1" });
    api.coverFetch.mockImplementationOnce(async () => {
      throw new Error("too large");
    });
    await runObjectAction(props);
    const document = JSON.parse(api.importPropose.mock.calls[0]?.[1] ?? "{}") as { objects: Array<{ values: Record<string, string> }> };
    expect(document.objects[0]?.values["booth#1/cover"]).toBe(".yukifile/covers/abc.png");
    expect(api.coverFetch).toHaveBeenLastCalledWith("https://booth.pximg.net/x/c/300x300/resized.jpg");
  });

  test("a listing by another shop than the object says is written when pressed, with a warning", async () => {
    const { api, props } = pressed({ item_id: "1564788" });
    api.objectFlat.mockImplementation(async () => ({
      id: "1",
      shared: { vendor: [{ value: "Qrochairo Store", from: "vrchat#1" }] },
      regions: [{ property: "booth", instance: 1, fields: { item_id: "1564788" } }],
      skipped: [],
      carries: ["booth#1"],
      locations: [{ path: "Clothing/Lace Swimsuit", kind: "folder", size: null }],
    }));
    const result = await runObjectAction(props);
    expect(api.importPropose).toHaveBeenCalled();
    expect(result.summary).toContain("item 1564788 is by Pirouette, but this object says Qrochairo Store: check the listing number");
  });
});

describe("checking a listing against the object", () => {
  const object = (vendor: string | undefined) => ({
    regions: [{ property: "booth", instance: 1, fields: { item_id: "4377098" } }],
    shared: {
      title: [{ value: "Lace Swimsuit", from: "booth#1" }],
      ...(vendor ? { vendor: [{ value: vendor, from: "vrchat#1" }] } : {}),
    },
  });

  test("a region's values are its own fields and its shared ones", () => {
    expect(listingValues(object(undefined), "booth", 1)).toEqual({ item_id: "4377098", title: "Lace Swimsuit" });
  });

  test("two spellings of one shop are one shop", () => {
    expect(sameShop("Qrochairo Store", "qrochairo store")).toBe(true);
    expect(sameShop("_Applause", "Applause")).toBe(true);
    expect(sameShop("MARX", "MARX shop")).toBe(true);
    expect(sameShop("黒鳥ケモノ工房", "Qrochairo Store")).toBe(false);
  });

  test("a shop that disagrees with the vendor is named; with nothing to compare, nothing is", () => {
    expect(shopMismatch("黒鳥ケモノ工房", object("Qrochairo Store"), "booth", 1)).toEqual({
      shop: "黒鳥ケモノ工房",
      files: "Qrochairo Store",
    });
    expect(shopMismatch("Qrochairo Store", object("Qrochairo Store"), "booth", 1)).toBeUndefined();
    expect(shopMismatch("黒鳥ケモノ工房", object(undefined), "booth", 1)).toBeUndefined();
  });
});
