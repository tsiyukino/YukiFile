import { describe, expect, test } from "vitest";

import {
  chipsOf,
  facetsOf,
  filterFor,
  headingFor,
  isNarrowed,
  NOTHING,
  onlyTerm,
  toggleField,
  toggleProperty,
  toggleTerm,
  valueLabel,
  withText,
} from "./filters.js";

describe("what the bridge is asked for", () => {
  test("nothing chosen browses the top of the tree", () => {
    expect(filterFor(NOTHING, null)).toEqual({ top: true });
  });

  test("nothing chosen inside a grouping browses that grouping", () => {
    expect(filterFor(NOTHING, "42")).toEqual({ within: "42" });
  });

  test("anything chosen searches the whole library, wherever the grid was", () => {
    // A match three groupings deep is as much a match as one at the top.
    const narrowed = toggleField(NOTHING, "category", "Hair");
    const filter = filterFor(narrowed, "42");
    expect(filter.within).toBeUndefined();
    expect(filter.top).toBeUndefined();
    expect(filter.fields).toEqual([{ field: "category", value: "Hair" }]);
  });

  test("whitespace alone is not a search", () => {
    expect(isNarrowed(withText(NOTHING, "   "))).toBe(false);
    expect(filterFor(withText(NOTHING, "  maid "), null).text).toBe("maid");
  });
});

describe("clicking in the sidebar", () => {
  test("a second click takes the choice back", () => {
    const once = toggleField(NOTHING, "category", "Hair");
    expect(once.fields).toHaveLength(1);
    expect(toggleField(once, "category", "Hair")).toEqual(NOTHING);
  });

  test("the unsorted bucket is a choice of its own", () => {
    const both = toggleField(toggleField(NOTHING, "category", null), "category", "Hair");
    expect(both.fields).toEqual([
      { field: "category", value: null },
      { field: "category", value: "Hair" },
    ]);
    expect(toggleField(both, "category", null).fields).toEqual([{ field: "category", value: "Hair" }]);
  });

  test("terms and properties toggle the same way", () => {
    expect(toggleTerm(toggleTerm(NOTHING, "avatar", "airi"), "avatar", "airi")).toEqual(NOTHING);
    expect(toggleProperty(toggleProperty(NOTHING, "vrchat"), "vrchat")).toEqual(NOTHING);
  });
});

describe("the chips above the grid", () => {
  test("every choice is a chip that removes itself", () => {
    let narrowing = withText(onlyTerm("avatar", "airi"), "maid");
    narrowing = toggleField(narrowing, "category", null);
    const chips = chipsOf(narrowing, new Map([["avatar:airi", "Airi"]]));
    expect(chips.map((chip) => chip.label)).toEqual(["“maid”", "Category: Not set", "Avatar: Airi"]);

    for (const chip of chips) narrowing = chip.remove(narrowing);
    expect(isNarrowed(narrowing)).toBe(false);
  });

  test("a term the counts did not name keeps its id", () => {
    const chips = chipsOf(onlyTerm("avatar", "manuka"), new Map());
    expect(chips[0]?.label).toBe("Avatar: manuka");
  });
});

describe("what the sidebar offers", () => {
  test("every plugin's facets and vocabularies, once each, in plugin order", () => {
    const offered = facetsOf([
      { id: "a", contributes: { facets: ["category", "vendor"], vocabularies: ["avatar"] } },
      { id: "b", contributes: { facets: ["vendor", "author"], vocabularies: ["avatar", "tag"] } },
      { id: "c" },
    ]);
    expect(offered).toEqual({ fields: ["category", "vendor", "author"], vocabularies: ["avatar", "tag"] });
  });

  test("names read as headings", () => {
    expect(headingFor("category")).toBe("Category");
    expect(headingFor("grouping_depth")).toBe("Grouping depth");
    expect(valueLabel(null)).toBe("Not set");
  });
});
