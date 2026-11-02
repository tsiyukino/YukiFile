import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { Api, Edge, FlatObject } from "../../src/plugin-host/commands.js";
import BoothPanel from "./booth-panel.js";
import VrchatPanel, { avatarsOf } from "./panel.js";

function object(property: string, fields: Record<string, string>): FlatObject {
  return {
    id: "1",
    shared: {},
    regions: [{ property, instance: 1, fields }],
    skipped: [],
    carries: [`${property}#1`],
    locations: [],
  };
}

const edges: Edge[] = [
  { kind: "supports", target: "term", vocab: "avatar", term: "manuka" },
  { kind: "owned", target: "term", vocab: "avatar", term: "manuka" },
  { kind: "supports", target: "term", vocab: "avatar", term: "nobody" },
  { kind: "contains", target: "object", id: "9" },
];
const terms = [{ vocab: "avatar", id: "manuka", label: "マヌカ" }];

describe("avatars from edges", () => {
  test("grouped by kind, labelled, and the id when there is no label", () => {
    const grouped = avatarsOf(edges, terms);

    expect(grouped.get("supports")).toEqual(["マヌカ", "nobody"]);
    expect(grouped.get("owned")).toEqual(["マヌカ"]);
    expect(grouped.has("contains")).toBe(false);
  });
});

describe("the VRChat panel", () => {
  test("says what it is, who made it, and what it fits", async () => {
    const api = {
      objectFlat: async () => object("vrchat", { category: "Clothing", vendor: "SKYMY Workshop" }),
      objectEdges: async () => edges,
      termList: async () => terms,
    } as unknown as Api;

    render(<VrchatPanel api={api} objectId="1" property="vrchat" instance={1} />);

    expect(await screen.findByText("Clothing · SKYMY Workshop")).toBeDefined();
    expect(screen.getAllByText("マヌカ")).toHaveLength(2);
  });

  test("an asset with nothing recorded says so", async () => {
    const api = {
      objectFlat: async () => object("vrchat", {}),
      objectEdges: async () => [],
      termList: async () => [],
    } as unknown as Api;

    render(<VrchatPanel api={api} objectId="1" property="vrchat" instance={1} />);

    expect(await screen.findByText("No category or vendor recorded.")).toBeDefined();
    expect(screen.getByText("No avatars recorded.")).toBeDefined();
  });
});

describe("the Booth panel", () => {
  test("the listing as a link, with its price", async () => {
    const api = {
      objectFlat: async () =>
        object("booth", { url: "https://booth.pm/ja/items/1", price: "800", title: "Low Ponytail" }),
    } as unknown as Api;

    render(<BoothPanel api={api} objectId="1" property="booth" instance={1} />);

    const link = await screen.findByRole("link", { name: "Low Ponytail" });
    expect(link.getAttribute("href")).toBe("https://booth.pm/ja/items/1");
    expect(screen.getByText(/¥800/)).toBeDefined();
  });
});

describe("the Booth panel, as the store really holds a listing", () => {
  // Title, price, url and vendor are shared: they arrive among the object's
  // sources, attributed to booth#1, not in the region's own fields.
  function stored(vendorFromFiles?: string) {
    return {
      objectFlat: async () => ({
        id: "1",
        shared: {
          title: [{ value: "Lace Swimsuit", from: "booth#1" }],
          price: [{ value: "500", from: "booth#1" }],
          url: [{ value: "https://booth.pm/ja/items/4377098", from: "booth#1" }],
          vendor: [
            { value: "黒鳥ケモノ工房", from: "booth#1" },
            ...(vendorFromFiles ? [{ value: vendorFromFiles, from: "vrchat#1" }] : []),
          ],
        },
        regions: [{ property: "booth", instance: 1, fields: { item_id: "4377098" } }],
        skipped: [],
        carries: ["booth#1"],
        locations: [],
      }),
    } as unknown as Api;
  }

  test("shows the listing rather than saying none is recorded", async () => {
    render(<BoothPanel api={stored()} objectId="1" property="booth" instance={1} />);
    const link = await screen.findByRole("link", { name: "Lace Swimsuit" });
    expect(link.getAttribute("href")).toBe("https://booth.pm/ja/items/4377098");
    expect(screen.getByText(/黒鳥ケモノ工房 · ¥500 · #4377098/)).toBeDefined();
    expect(screen.queryByText("No listing recorded.")).toBeNull();
  });

  test("warns when the shop is not the vendor the files name", async () => {
    render(<BoothPanel api={stored("Qrochairo Store")} objectId="1" property="booth" instance={1} />);
    expect(await screen.findByText(/This listing is by 黒鳥ケモノ工房, but this object says Qrochairo Store/)).toBeDefined();
  });
});
