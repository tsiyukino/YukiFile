import { describe, expect, test } from "vitest";

import { nameOf, newObjectFrom, wording } from "./add.js";

const at = { path: "Papers/solubility.pdf", kind: "file" as const };

describe("building the object to create", () => {
  test("a property with a blank form is still listed", () => {
    // 2026-09-11_choosing-a-type-is-storable.md: the choice is a fact worth
    // keeping whether or not anything was typed. Dropping it here would repeat
    // the bug that decision exists to prevent, one layer up.
    const object = newObjectFrom(at, ["paper"], new Map());

    expect(object.properties).toEqual(["paper"]);
    expect(object.values).toEqual({});
  });

  test("a form's values land under the property it was scoped to", () => {
    // Nested, so the core spells `paper#1/doi` itself. A bare `doi` in the
    // shared space is what property namespaces exist to prevent.
    const object = newObjectFrom(
      at,
      ["paper"],
      new Map([["paper", { doi: "10.1000/x", title: "Solubility" }]]),
    );

    expect(object.values).toEqual({ paper: { doi: "10.1000/x", title: "Solubility" } });
    expect(object.shared).toBeUndefined();
  });

  test("a form that returned nothing contributes no entry", () => {
    // The core would accept `paper: {}`. A document saying "values for
    // paper: none" is saying something it does not mean.
    const object = newObjectFrom(at, ["paper", "dataset"], new Map([["paper", {}]]));

    expect(Object.keys(object.values ?? {})).toEqual([]);
    expect(object.properties).toEqual(["paper", "dataset"]);
  });

  test("values for a property that was unchosen are not sent", () => {
    // Going back and unticking leaves the form's answer in `collected`. The
    // core refuses values for a property the object was not given, so sending
    // them would turn an undo into a refusal.
    const object = newObjectFrom(at, [], new Map([["paper", { doi: "10.1000/x" }]]));

    expect(object.values).toEqual({});
    expect(object.properties).toEqual([]);
  });

  test("the location is carried with its kind", () => {
    // The browser already walked and knows; the core does not look twice.
    expect(newObjectFrom(at, [], new Map()).paths).toEqual([at]);
  });

  test("no location makes a grouping", () => {
    expect(newObjectFrom(undefined, ["collection"], new Map()).paths).toEqual([]);
  });

  test("the chosen list is copied, not shared", () => {
    const chosen = ["paper"];
    const object = newObjectFrom(at, chosen, new Map());
    chosen.push("dataset");

    expect(object.properties).toEqual(["paper"]);
  });
});

describe("how a choice reads", () => {
  test("a bare property is its own name and sits nowhere", () => {
    expect(wording({ property: "paper", path: ["paper"] })).toEqual({
      name: "paper",
      within: undefined,
    });
  });

  test("a dotted property is its last segment, within the rest", () => {
    // `vrchat.booth` is a sub-type: the dot is the model's own nesting, and
    // the picker shows it as such rather than as one long name.
    expect(wording({ property: "vrchat.booth", path: ["vrchat", "booth"] })).toEqual({
      name: "booth",
      within: "vrchat",
    });
  });
});

describe("naming a path", () => {
  test("the last segment is the name", () => {
    expect(nameOf("Papers/solubility.pdf")).toBe("solubility.pdf");
    expect(nameOf("Clothing")).toBe("Clothing");
  });

  test("a trailing separator does not make the name empty", () => {
    expect(nameOf("Clothing/")).toBe("Clothing");
  });
});
