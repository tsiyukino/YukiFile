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
