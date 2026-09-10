import { describe, expect, test } from "vitest";

import { choosable, formsFor } from "./picker.js";
import type { Mount } from "./slots.js";
import type { Manifest } from "./types.js";

const pdf: Manifest = {
  id: "yukifile.pdf",
  contributes: {
    properties: ["pdf"],
    file_types: { pdf: ["pdf"] },
    viewers: { pdf: "./viewer" },
  },
};

const paper: Manifest = {
  id: "yukifile.paper",
  contributes: { properties: ["paper"], forms: { paper: "./newpaper" } },
};

const vrc: Manifest = {
  id: "yukifile.vrc",
  contributes: {
    properties: ["vrchat", "vrchat.booth"],
    forms: { vrchat: "./newvrc" },
  },
};

function names(plugins: readonly Manifest[]): string[] {
  return choosable(plugins).map((choice) => choice.property);
}

describe("what a person may choose", () => {
  test("a semantic property is offered", () => {
    expect(names([paper])).toEqual(["paper"]);
  });

  test("a factual property is not", () => {
    // A file either is a PDF or is not, and nobody decides it. Offering `pdf`
    // would invite marking a `.docx` as one and getting a viewer that cannot
    // read it.
    expect(names([pdf])).toEqual([]);
  });

  test("the factual list comes from every plugin, not just the declaring one", () => {
    // `pdf` is factual because the PDF plugin maps an extension to it. A
    // second plugin declaring the same property does not make it choosable.
    const other: Manifest = { id: "x.other", contributes: { properties: ["pdf"] } };

    expect(names([pdf, other])).toEqual([]);
  });

  test("a plugin with no properties offers nothing", () => {
    expect(names([{ id: "x.empty" }])).toEqual([]);
  });

  test("no plugins at all offers nothing", () => {
    expect(choosable([])).toEqual([]);
  });

  test("the same property declared twice appears once", () => {
    expect(names([paper, paper])).toEqual(["paper"]);
  });

  test("the list is sorted, so it does not shuffle between runs", () => {
    expect(names([vrc, paper])).toEqual(["paper", "vrchat", "vrchat.booth"]);
  });
});

describe("domains are the dots already in the name", () => {
  test("a dotted property carries its path", () => {
    const choice = choosable([vrc]).find((c) => c.property === "vrchat.booth");

    expect(choice?.path).toEqual(["vrchat", "booth"]);
  });

  test("an undotted property is its own path", () => {
    expect(choosable([paper])[0]?.path).toEqual(["paper"]);
  });

  test("a sub-type sorts next to what it extends", () => {
    // `vrchat.booth` under `vrchat`, not somewhere else alphabetically.
    const listed = names([vrc, paper]);

    expect(listed.indexOf("vrchat.booth")).toBe(listed.indexOf("vrchat") + 1);
  });
});

describe("which forms to show", () => {
  const mounts: Mount[] = [
    { namespace: "vrchat", instance: 1 },
    { namespace: "paper", instance: 1 },
  ];

  test("a chosen property with a form contributes it", () => {
    const forms = formsFor([paper], ["paper"], mounts);

    expect(forms).toEqual([
      { plugin: "yukifile.paper", property: "paper", instance: 1, value: "./newpaper" },
    ]);
  });

  test("a chosen property with no form contributes nothing", () => {
    // Declaring a type without a form is legal; the core draws a plain one.
    const bare: Manifest = { id: "x.bare", contributes: { properties: ["thing"] } };

    expect(formsFor([bare], ["thing"], [{ namespace: "thing", instance: 1 }])).toEqual([]);
  });

  test("choosing nothing shows nothing", () => {
    expect(formsFor([paper, vrc], [], mounts)).toEqual([]);
  });

  test("several chosen properties come back in mount order", () => {
    // Not in the order they were clicked, and not alphabetically. Mount order
    // is the rule every other slot uses and the one the user can already see.
    const forms = formsFor([paper, vrc], ["paper", "vrchat"], mounts);

    expect(forms.map((f) => f.property)).toEqual(["vrchat", "paper"]);
  });

  test("a property the library has never mounted still gets its form", () => {
    // The first object to be a paper is exactly when the form matters, and
    // that is before anything mounted `paper`.
    const forms = formsFor([paper], ["paper"], []);

    expect(forms.map((f) => f.property)).toEqual(["paper"]);
  });

  test("an unmounted property sorts after a mounted one", () => {
    const forms = formsFor([paper, vrc], ["paper", "vrchat"], [
      { namespace: "vrchat", instance: 1 },
    ]);

    expect(forms.map((f) => f.property)).toEqual(["vrchat", "paper"]);
  });

  test("a second instance does not rank the first", () => {
    // A new object carries instance 1. Ranking on `booth#2` would order the
    // forms by a page that does not exist yet.
    const forms = formsFor([paper, vrc], ["paper", "vrchat"], [
      { namespace: "paper", instance: 2 },
      { namespace: "vrchat", instance: 1 },
    ]);

    expect(forms.map((f) => f.property)).toEqual(["vrchat", "paper"]);
  });

  test("a chosen instance path is matched by its bare name", () => {
    // Whatever the caller passes, `booth#1` and `booth` name one property.
    const forms = formsFor([paper], ["paper#1"], mounts);

    expect(forms.map((f) => f.property)).toEqual(["paper"]);
  });
});
