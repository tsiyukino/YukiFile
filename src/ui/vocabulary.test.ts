import { describe, expect, test } from "vitest";

import type { Pointer, Summary } from "../plugin-host/commands.js";
import { byKind, countWording, objectsPointing } from "./vocabulary.js";

const outfit: Summary = { id: "1", name: "Cross Maid", path: "a.zip", kind: "file" };
const hair: Summary = { id: "2", name: "Low Ponytail", path: "b.zip", kind: "file" };

describe("grouping what points at a term", () => {
  test("by kind, kinds in first-seen order, objects in the order given", () => {
    const pointers: Pointer[] = [
      { object: "1", kind: "supports" },
      { object: "1", kind: "owned" },
      { object: "2", kind: "supports" },
    ];

    const groups = byKind(pointers, [outfit, hair]);

    expect(groups.map((g) => g.kind)).toEqual(["supports", "owned"]);
    expect(groups[0]?.objects.map((o) => o.name)).toEqual(["Cross Maid", "Low Ponytail"]);
    expect(groups[1]?.objects.map((o) => o.name)).toEqual(["Cross Maid"]);
  });

  test("an object nobody could name is kept, unnamed", () => {
    const groups = byKind([{ object: "9", kind: "supports" }], []);

    expect(groups[0]?.objects).toEqual([{ id: "9", name: null, path: null, kind: null }]);
  });

  test("objects are each asked for once", () => {
    expect(objectsPointing([{ object: "1", kind: "a" }, { object: "1", kind: "b" }])).toEqual(["1"]);
  });
});

describe("the count", () => {
  test("counts objects, not edges", () => {
    expect(countWording([{ object: "1", kind: "a" }, { object: "1", kind: "b" }])).toBe(
      "1 object points at this.",
    );
  });

  test("nothing says so", () => {
    expect(countWording([])).toBe("Nothing points at this yet.");
  });
});
