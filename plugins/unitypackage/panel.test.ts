import { describe, expect, test } from "vitest";

import type { Api, UnityAsset } from "../../src/plugin-host/commands.js";
import { isProblem, open, summarise } from "./panel.js";

function asset(path: string, size: number | null = 10, has_preview = false): UnityAsset {
  return { guid: path, path, size, has_preview };
}

describe("summarising a package", () => {
  test("counts files and folders, and adds up bytes", () => {
    const view = summarise([asset("Assets/a", null), asset("Assets/a/b.fbx", 100), asset("Assets/a/c.png", 50, true)]);

    expect(view.files).toBe(2);
    expect(view.folders).toBe(1);
    expect(view.unpacked).toBe(150);
    expect(view.previews).toBe(1);
  });

  test("the folders under Assets are named once each, in order seen", () => {
    // Where a vendor's name sits. Reported as folders, not as "the vendor":
    // deciding that is the VRChat plugin's judgement.
    const view = summarise([
      asset("Assets/[meron-farm]/mochi-bob/body.fbx"),
      asset("Assets/lilToon/Editor/x.cs"),
      asset("Assets/[meron-farm]/mochi-bob/tex.png"),
      asset("Assets/loose.txt"),
      asset("Packages/com.x/y.cs"),
    ]);

    expect(view.top).toEqual(["[meron-farm]", "lilToon"]);
  });

  test("a long listing is truncated with a count of the rest", () => {
    const many = Array.from({ length: 95 }, (_, i) => asset(`Assets/v/${i}.png`));
    const view = summarise(many);

    expect(view.rows).toHaveLength(40);
    expect(view.hidden).toBe(55);
    // Counted over everything, not over the rows shown.
    expect(view.files).toBe(95);
  });
});

describe("opening", () => {
  test("a refusal becomes a sentence rather than a thrown error", async () => {
    const api = {
      unitypackageList: async () => {
        throw { kind: "not_an_archive", detail: "x" };
      },
    } as unknown as Api;

    const state = await open(api, "a.unitypackage");

    expect(isProblem(state) && state.problem).toBe("This file is not a readable Unity package.");
  });
});
