import { describe, expect, test } from "vitest";

import type { ArchiveMember, Location } from "../plugin-host/commands.js";
import { fromFolder, fromPackage, fromZip, isImage, packagesIn } from "./covers.js";

const folder: Location = { path: "Clothing/outfit", kind: "folder", size: null };
const zip: Location = { path: "Clothing/outfit.zip", kind: "file", size: 10 };

function member(path: string, over: Partial<ArchiveMember> = {}): ArchiveMember {
  return { path, size: 1, compressed_size: 1, is_dir: false, escapes_root: false, ...over };
}

describe("what is an image", () => {
  test("by extension, case aside", () => {
    expect(isImage("promo.PNG")).toBe(true);
    expect(isImage("a.webp")).toBe(true);
    expect(isImage("a.psd")).toBe(false);
    expect(isImage("readme")).toBe(false);
  });
});

describe("choices from a folder", () => {
  test("the images at its top, as files under the location", () => {
    const choices = fromFolder(folder, [
      { path: "promo.png", kind: "file", size: 1, mtime: null },
      { path: "readme.txt", kind: "file", size: 1, mtime: null },
      { path: "Textures", kind: "folder", size: null, mtime: null },
    ]);

    expect(choices).toEqual([
      { label: "promo.png", source: { from: "file", path: "Clothing/outfit/promo.png" } },
    ]);
  });
});

describe("choices from a zip", () => {
  test("its image members, never one that escapes the root", () => {
    const choices = fromZip(zip, [member("promo/cover.jpg"), member("x.png", { escapes_root: true }), member("a/", { is_dir: true })]);

    expect(choices).toEqual([
      { label: "promo/cover.jpg", source: { from: "member", path: "Clothing/outfit.zip", member: "promo/cover.jpg" } },
    ]);
  });

  test("the packages it holds, for their previews", () => {
    expect(packagesIn([member("x/outfit.unitypackage"), member("readme.txt")])).toEqual(["x/outfit.unitypackage"]);
  });
});

describe("choices from a package", () => {
  test("every asset with a preview, on disk or inside a zip", () => {
    const assets = [
      { guid: "a", path: "Assets/x/outfit.prefab", size: 1, has_preview: true },
      { guid: "b", path: "Assets/x/body.fbx", size: 1, has_preview: false },
    ];
    const onDisk: Location = { path: "outfit.unitypackage", kind: "file", size: 1 };

    expect(fromPackage(onDisk, assets)).toEqual([
      { label: "Assets/x/outfit.prefab", source: { from: "preview", path: "outfit.unitypackage", guid: "a" } },
    ]);
    expect(fromPackage(zip, assets, "x/outfit.unitypackage")[0]?.source).toEqual({
      from: "preview",
      path: "Clothing/outfit.zip",
      member: "x/outfit.unitypackage",
      guid: "a",
    });
  });
});
