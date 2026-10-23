import { describe, expect, test } from "vitest";

import type { Entry } from "../../src/plugin-host/commands.js";
import { boothFields, boothItem, boothUrl, documentFor, productsFrom, vrchatFields } from "./vrchat.js";

function entry(path: string, kind: "file" | "folder" = "file"): Entry {
  return { path, kind, size: kind === "file" ? 100 : null, mtime: null };
}

describe("what counts as a product", () => {
  test("an entry directly under a category folder, with the category", () => {
    const proposed = productsFrom([
      entry("Clothing", "folder"),
      entry("Clothing/outfit.zip"),
      entry("Clothing/AW KLASSIK MAID", "folder"),
    ]);

    const outfit = proposed.find((p) => p.path === "Clothing/outfit.zip");
    expect(outfit?.values).toEqual({ "vrchat#1/category": "Clothing" });
    expect(outfit?.isFolder).toBe(false);
    expect(proposed.find((p) => p.path === "Clothing/AW KLASSIK MAID")?.isFolder).toBe(true);
  });

  test("the category folder holds its products and carries no category", () => {
    const proposed = productsFrom([entry("Clothing", "folder"), entry("Clothing/outfit.zip")]);

    const clothing = proposed.find((p) => p.path === "Clothing");
    expect(clothing?.contains).toEqual(["Clothing/outfit.zip"]);
    expect(clothing?.values).toEqual({});
  });

  test("nothing below a product is an object", () => {
    // The forty textures inside an outfit are the outfit's. Listing them is
    // what made the library impossible to organise.
    const proposed = productsFrom([
      entry("Clothing", "folder"),
      entry("Clothing/outfit", "folder"),
      entry("Clothing/outfit/skin.png"),
    ]);

    expect(proposed.map((p) => p.path)).toEqual(["Clothing", "Clothing/outfit"]);
  });

  test("a file at the root is a product nobody has filed yet", () => {
    const proposed = productsFrom([entry("T2 Collar.unitypackage")]);

    expect(proposed).toEqual([
      { path: "T2 Collar.unitypackage", isFolder: false, values: {}, contains: [] },
    ]);
  });

  test("a dot-prefixed category is a category", () => {
    // The seed library groups with a leading dot because a dot sorts first.
    const proposed = productsFrom([entry(".LAPWING", "folder"), entry(".LAPWING/hair.zip")]);

    expect(proposed.find((p) => p.path === ".LAPWING/hair.zip")?.values).toEqual({
      "vrchat#1/category": ".LAPWING",
    });
  });

  test("the document carries the category and the containment", () => {
    const document = JSON.parse(
      documentFor(productsFrom([entry("Hair", "folder"), entry("Hair/pony", "folder")])),
    ) as { objects: Array<Record<string, unknown>> };

    expect(document.objects[0]).toMatchObject({
      paths: ["Hair"],
      folders: ["Hair"],
      edges: [{ kind: "contains", object: "Hair/pony" }],
    });
    expect(document.objects[1]).toMatchObject({
      paths: ["Hair/pony"],
      folders: ["Hair/pony"],
      values: { "vrchat#1/category": "Hair" },
    });
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
