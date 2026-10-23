import { describe, expect, test } from "vitest";

import type { Edge, FlatObject } from "../plugin-host/commands.js";
import type { Manifest } from "../plugin-host/types.js";
import {
  addableProperties,
  fieldPath,
  isFieldName,
  objectTargets,
  removableProperties,
  targetWording,
  vocabulariesOf,
} from "./edit.js";

const plugins: Manifest[] = [
  { id: "x.pdf", contributes: { properties: ["pdf"], file_types: { pdf: ["pdf"] } } },
  { id: "x.paper", contributes: { properties: ["paper"], vocabularies: ["author"] } },
  { id: "x.vrc", contributes: { properties: ["vrchat", "booth"], vocabularies: ["avatar", "author"] } },
];

function object(carries: string[]): FlatObject {
  return { id: "1", shared: {}, regions: [], skipped: [], carries, locations: [] };
}

describe("where a region's field is stored", () => {
  test("property, instance, field", () => {
    expect(fieldPath({ property: "paper", instance: 1 }, "doi")).toBe("paper#1/doi");
    expect(fieldPath({ property: "booth", instance: 2 }, "price")).toBe("booth#2/price");
  });
});

describe("whether a typed name is a field", () => {
  test("a plain word is", () => {
    expect(isFieldName("category")).toBe(true);
    expect(isFieldName("item_id")).toBe(true);
  });

  test("the store's separators and whitespace are not", () => {
    // The same rule `store::path` applies, checked before the round trip so
    // the message sits beside the box.
    for (const bad of ["", "a/b", "a#1", "has space", "tab\there"]) {
      expect(isFieldName(bad), bad).toBe(false);
    }
  });
});

describe("which properties a person may take off", () => {
  test("semantic ones they could have chosen", () => {
    expect(removableProperties(object(["paper#1", "vrchat#1"]), plugins)).toEqual(["paper", "vrchat"]);
  });

  test("a factual one is not offered", () => {
    // `pdf` is attached by what the file is. Detaching it would do nothing
    // the next read does not undo.
    expect(removableProperties(object(["pdf#1", "paper#1"]), plugins)).toEqual(["paper"]);
  });

  test("and which they may add: the semantic ones not carried", () => {
    expect(addableProperties(object(["paper#1"]), plugins)).toEqual(["booth", "vrchat"]);
  });
});

describe("vocabularies", () => {
  test("each declared one once, sorted", () => {
    expect(vocabulariesOf(plugins)).toEqual(["author", "avatar"]);
  });
});

describe("what an edge points at, in words", () => {
  const toTerm: Edge = { kind: "supports", target: "term", vocab: "avatar", term: "manuka" };
  const toObject: Edge = { kind: "contains", target: "object", id: "9" };

  test("a term by its label when known", () => {
    expect(targetWording(toTerm, [], [{ vocab: "avatar", id: "manuka", label: "Manuka" }])).toBe(
      "avatar: Manuka",
    );
  });

  test("a term by its id otherwise", () => {
    expect(targetWording(toTerm, [], [])).toBe("avatar: manuka");
  });

  test("an object by its name when known", () => {
    expect(targetWording(toObject, [{ id: "9", name: "outfit.zip", path: null, kind: null }], [])).toBe(
      "outfit.zip",
    );
  });

  test("an object by its id otherwise, never hidden", () => {
    // A target nobody can name is still a target, and hiding it would hide
    // the edge.
    expect(targetWording(toObject, [], [])).toBe("object 9");
  });

  test("the objects to name are each asked for once", () => {
    expect(objectTargets([toObject, toObject, toTerm])).toEqual(["9"]);
  });
});
