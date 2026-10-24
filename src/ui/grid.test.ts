import { describe, expect, test } from "vitest";

import { pathUnder, placeholderFor, titleOf } from "./grid.js";

describe("the placeholder for a missing cover", () => {
  test("by what the thing is on disk", () => {
    expect(placeholderFor({ path: "Clothing/outfit", kind: "folder" })).toBe("folder");
    expect(placeholderFor({ path: "a/x.unitypackage", kind: "file" })).toBe("package");
    expect(placeholderFor({ path: "a/x.ZIP", kind: "file" })).toBe("archive");
    expect(placeholderFor({ path: "a/promo.png", kind: "file" })).toBe("image");
    expect(placeholderFor({ path: "a/readme.pdf", kind: "file" })).toBe("document");
    expect(placeholderFor({ path: "a/model.fbx", kind: "file" })).toBe("file");
    expect(placeholderFor({ path: null, kind: null })).toBe("grouping");
  });
});

describe("what a card says", () => {
  test("a name, or untitled", () => {
    expect(titleOf({ name: "Cross Maid" })).toBe("Cross Maid");
    expect(titleOf({ name: null })).toBe("Untitled");
  });

  test("the path under the name, unless it would repeat it", () => {
    expect(pathUnder({ name: "Cross Maid", path: "Clothing/Cross_Maid_Fullset" })).toBe("Clothing/Cross_Maid_Fullset");
    // Named by its filename: the folder is what is left to say.
    expect(pathUnder({ name: "outfit.zip", path: "Clothing/outfit.zip" })).toBe("Clothing");
    expect(pathUnder({ name: "outfit.zip", path: "outfit.zip" })).toBeUndefined();
    expect(pathUnder({ name: "Clothing", path: "Clothing" })).toBeUndefined();
    expect(pathUnder({ name: "Favourites", path: null })).toBeUndefined();
  });
});
