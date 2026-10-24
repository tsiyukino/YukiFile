import { describe, expect, test } from "vitest";

import type { Entry } from "../../src/plugin-host/commands.js";
import {
  ACTIONS,
  boothFields,
  boothItem,
  boothUrl,
  categorySuggestedBy,
  documentFor,
  productsFrom,
  vrchatFields,
} from "./vrchat.js";

function entry(path: string, kind: "file" | "folder" = "file"): Entry {
  return { path, kind, size: kind === "file" ? 100 : null, mtime: null };
}

describe("what counts as a product", () => {
  test("one level of groupings: top folders group, what sits in them is a product", () => {
    const proposed = productsFrom([
      entry("Clothing", "folder"),
      entry("Clothing/outfit", "folder"),
      entry("Clothing/outfit/Textures", "folder"),
      entry("Clothing/outfit/Textures/skin.png"),
      entry("Clothing/Cross_Maid.zip"),
    ]);

    expect(proposed).toEqual([
      { path: "Clothing", isFolder: true, contains: ["Clothing/outfit", "Clothing/Cross_Maid.zip"] },
      { path: "Clothing/outfit", isFolder: true, contains: [] },
      { path: "Clothing/Cross_Maid.zip", isFolder: false, contains: [] },
    ]);
  });

  test("a product is a product whatever is inside it", () => {
    // The content rule this replaces made 800 objects of 174 products: an
    // unpacked package is a folder of folders, and read as a grouping.
    const proposed = productsFrom([
      entry("Bases", "folder"),
      entry("Bases/Airi_Ver1.00", "folder"),
      entry("Bases/Airi_Ver1.00/Assets", "folder"),
      entry("Bases/Airi_Ver1.00/Assets/Airi", "folder"),
      entry("Bases/Airi_Ver1.00/Assets/Airi/body.fbx"),
    ]);

    expect(proposed.map((p) => p.path)).toEqual(["Bases", "Bases/Airi_Ver1.00"]);
  });

  test("two levels of groupings read the layout sorted by avatar and then by kind", () => {
    const entries = [
      entry(".LAPWING", "folder"),
      entry(".LAPWING/Clothes", "folder"),
      entry(".LAPWING/Clothes/outfit", "folder"),
      entry(".LAPWING/Clothes/outfit/a.fbx"),
      entry(".LAPWING/Hair", "folder"),
      entry(".LAPWING/Hair/pony.unitypackage"),
    ];

    expect(productsFrom(entries, 2).map((p) => [p.path, p.contains.length])).toEqual([
      [".LAPWING", 2],
      [".LAPWING/Clothes", 1],
      [".LAPWING/Clothes/outfit", 0],
      [".LAPWING/Hair", 1],
      [".LAPWING/Hair/pony.unitypackage", 0],
    ]);
    // The same tree at one level makes .LAPWING/Clothes a product, which is
    // what the person asked for by saying one -- while .LAPWING/Hair still
    // groups, because Hair is a category's name and categories nest.
    expect(productsFrom(entries, 1).map((p) => p.path)).toEqual([
      ".LAPWING",
      ".LAPWING/Clothes",
      ".LAPWING/Hair",
      ".LAPWING/Hair/pony.unitypackage",
    ]);
  });

  test("a file at a grouping level is a product, since a file is never a grouping", () => {
    const proposed = productsFrom([entry("T2 Collar.unitypackage"), entry("_Archive", "folder"), entry("_Archive/a.zip")]);

    expect(proposed.map((p) => p.path)).toEqual(["T2 Collar.unitypackage", "_Archive", "_Archive/a.zip"]);
    expect(proposed[0]?.contains).toEqual([]);
  });

  test("a folder named like a category inside a grouping is a grouping at any depth", () => {
    // NSFW/BDSM/Accessory/ in the seed library. Read as a product, NSFW/BDSM
    // swallowed 21 real ones.
    const proposed = productsFrom([
      entry("NSFW", "folder"),
      entry("NSFW/BDSM", "folder"),
      entry("NSFW/BDSM/Accessory", "folder"),
      entry("NSFW/BDSM/Accessory/Gagak_Gagset_2.01", "folder"),
      entry("NSFW/BDSM/Accessory/Gagak_Gagset_2.01/Assets", "folder"),
      entry("NSFW/BodyPart", "folder"),
      entry("NSFW/BodyPart/DPS-SPS", "folder"),
    ]);

    expect(proposed.map((p) => [p.path, p.isFolder && p.contains.length > 0])).toEqual([
      ["NSFW", true],
      ["NSFW/BDSM", true],
      ["NSFW/BDSM/Accessory", true],
      ["NSFW/BDSM/Accessory/Gagak_Gagset_2.01", false],
      ["NSFW/BodyPart", true],
      ["NSFW/BodyPart/DPS-SPS", false],
    ]);
  });

  test("a category's name inside a product does not make it a grouping", () => {
    // Only a folder whose parent is a grouping can be one. A product named
    // Hair with a Hair folder inside it is still one product.
    const proposed = productsFrom([
      entry("Hair", "folder"),
      entry("Hair/pony", "folder"),
      entry("Hair/pony/Hair", "folder"),
      entry("Hair/pony/Hair/mesh.fbx"),
    ]);

    expect(proposed.map((p) => p.path)).toEqual(["Hair", "Hair/pony"]);
  });

  test("depth zero: everything at the root is a product, unless named like a category", () => {
    expect(productsFrom([entry("Stuff", "folder"), entry("Stuff/x.zip"), entry("a.zip")], 0)).toEqual([
      { path: "Stuff", isFolder: true, contains: [] },
      { path: "a.zip", isFolder: false, contains: [] },
    ]);
  });

  test("the document carries containment and no values", () => {
    // The scan knows where things are, not what they are. A category comes
    // by import or from a person.
    const document = JSON.parse(
      documentFor(productsFrom([entry("Hair", "folder"), entry("Hair/pony", "folder")])),
    ) as { objects: Array<Record<string, unknown>> };

    expect(document.objects[0]).toMatchObject({
      paths: ["Hair"],
      folders: ["Hair"],
      values: {},
      edges: [{ kind: "contains", object: "Hair/pony" }],
    });
    expect(document.objects[1]).toMatchObject({ paths: ["Hair/pony"], folders: ["Hair/pony"], values: {} });
  });

  test("each action names its depth", () => {
    expect(ACTIONS["scan products"]).toBe(1);
    expect(ACTIONS["scan products, groupings two deep"]).toBe(2);
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
