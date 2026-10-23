import { describe, expect, test } from "vitest";

import type { Entry } from "../../src/plugin-host/commands.js";
import { boothFields, boothItem, boothUrl, categorySuggestedBy, documentFor, productsFrom, vrchatFields } from "./vrchat.js";

function entry(path: string, kind: "file" | "folder" = "file"): Entry {
  return { path, kind, size: kind === "file" ? 100 : null, mtime: null };
}

describe("what counts as a product", () => {
  test("a folder that holds a file is a product, and nothing below it is", () => {
    // The forty textures inside an outfit are the outfit's. Listing them is
    // what made the library impossible to organise.
    const proposed = productsFrom([
      entry("Clothing", "folder"),
      entry("Clothing/outfit", "folder"),
      entry("Clothing/outfit/skin.png"),
      entry("Clothing/outfit/Texture", "folder"),
      entry("Clothing/outfit/Texture/a.png"),
    ]);

    expect(proposed.map((p) => p.path)).toEqual(["Clothing", "Clothing/outfit"]);
    expect(proposed[1]).toEqual({ path: "Clothing/outfit", isFolder: true, contains: [] });
  });

  test("a folder that holds only folders is a grouping, holding each of them", () => {
    const proposed = productsFrom([
      entry("Clothing", "folder"),
      entry("Clothing/a", "folder"),
      entry("Clothing/a/x.fbx"),
      entry("Clothing/b", "folder"),
      entry("Clothing/b/y.fbx"),
    ]);

    expect(proposed[0]).toEqual({ path: "Clothing", isFolder: true, contains: ["Clothing/a", "Clothing/b"] });
  });

  test("the rule is the same at any depth, so an unorganised library reads too", () => {
    // Before a library is organised nobody knows what any of it is. The old
    // layout grouped by avatar, then by a word for the kind, then products.
    const proposed = productsFrom([
      entry(".AASHAREE", "folder"),
      entry(".AASHAREE/CLOTHS", "folder"),
      entry(".AASHAREE/CLOTHS/AW KLASSIK MAID", "folder"),
      entry(".AASHAREE/CLOTHS/AW KLASSIK MAID/outfit.unitypackage"),
      entry(".AASHAREE/CLOTHS/Cross_Maid.zip"),
    ]);

    expect(proposed.map((p) => p.path)).toEqual([
      ".AASHAREE",
      ".AASHAREE/CLOTHS",
      ".AASHAREE/CLOTHS/AW KLASSIK MAID",
      ".AASHAREE/CLOTHS/Cross_Maid.zip",
    ]);
    expect(proposed[1]?.contains).toEqual([".AASHAREE/CLOTHS/AW KLASSIK MAID", ".AASHAREE/CLOTHS/Cross_Maid.zip"]);
  });

  test("a file beside product folders is a product by itself", () => {
    const proposed = productsFrom([
      entry("Hair", "folder"),
      entry("Hair/pony", "folder"),
      entry("Hair/pony/a.fbx"),
      entry("Hair/loose.unitypackage"),
    ]);

    // Hair holds a file, so by the rule it is a product. That is the rule's
    // known cost, and the person fixes it by hand; the alternative, judging
    // by the file's name, is the mistake the lessons made twice.
    expect(proposed.map((p) => p.path)).toEqual(["Hair"]);
  });

  test("a file at the root is a product", () => {
    expect(productsFrom([entry("T2 Collar.unitypackage")])).toEqual([
      { path: "T2 Collar.unitypackage", isFolder: false, contains: [] },
    ]);
  });

  test("an empty folder is a thing somebody made, not a grouping", () => {
    expect(productsFrom([entry("New", "folder")])).toEqual([{ path: "New", isFolder: true, contains: [] }]);
  });

  test("the document carries containment and no values", () => {
    // The scan knows where things are, not what they are. A category comes
    // by import or from a person.
    const document = JSON.parse(
      documentFor(productsFrom([entry("Hair", "folder"), entry("Hair/pony", "folder"), entry("Hair/pony/a.fbx")])),
    ) as { objects: Array<Record<string, unknown>> };

    expect(document.objects[0]).toMatchObject({
      paths: ["Hair"],
      folders: ["Hair"],
      values: {},
      edges: [{ kind: "contains", object: "Hair/pony" }],
    });
    expect(document.objects[1]).toMatchObject({ paths: ["Hair/pony"], values: {} });
  });
});

describe("the category a folder suggests", () => {
  test("only when the folder is spelled like one", () => {
    expect(categorySuggestedBy("Clothing/outfit.zip")).toBe("Clothing");
    expect(categorySuggestedBy("clothing/outfit.zip")).toBe("Clothing");
    expect(categorySuggestedBy("NSFW/BDSM/x.zip")).toBeUndefined();
    expect(categorySuggestedBy(".LAPWING/outfit.zip")).toBeUndefined();
    expect(categorySuggestedBy("outfit.zip")).toBeUndefined();
  });
});

describe("a Booth listing", () => {
  test("every spelling of one listing gives one id", () => {
    for (const typed of [
      "https://booth.pm/ja/items/6467347",
      "https://booth.pm/en/items/6467347",
      "https://unya28.booth.pm/items/6467347",
      "  booth.pm/items/6467347 ".replace("booth", "https://booth"),
      "6467347",
    ]) {
      expect(boothItem(typed), typed).toBe("6467347");
    }
  });

  test("something that is not one is nothing", () => {
    for (const typed of ["https://gumroad.com/l/x", "lilToon", "", "https://booth.pm/ja/"]) {
      expect(boothItem(typed), typed).toBeUndefined();
    }
  });

  test("the canonical page is stored beside the id", () => {
    expect(boothUrl("6467347")).toBe("https://booth.pm/ja/items/6467347");
  });

  test("the form refuses a URL that is not a listing rather than dropping it", () => {
    expect(boothFields({ url: "https://gumroad.com/l/x", price: "", title: "" })).toEqual({
      ok: false,
      problem: "https://gumroad.com/l/x is not a Booth listing",
    });
  });

  test("the form stores the id, the canonical url, a whole-yen price and a title", () => {
    expect(
      boothFields({ url: "https://unya28.booth.pm/items/5848934", price: "800", title: "Low Ponytail" }),
    ).toEqual({
      ok: true,
      values: {
        item_id: "5848934",
        url: "https://booth.pm/ja/items/5848934",
        price: "800",
        title: "Low Ponytail",
      },
    });
  });

  test("a price that is not whole yen is refused", () => {
    expect(boothFields({ url: "", price: "8.5", title: "" })).toMatchObject({ ok: false });
  });

  test("everything blank is allowed", () => {
    expect(boothFields({ url: "", price: "", title: "" })).toEqual({ ok: true, values: {} });
  });
});

describe("the VRChat form", () => {
  test("keeps what was typed and leaves out what was not", () => {
    expect(vrchatFields({ category: " Hair ", vendor: "" })).toEqual({ category: "Hair" });
  });
});
