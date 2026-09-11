import { describe, expect, test } from "vitest";

import { fieldsFrom, normaliseDoi, titleFrom } from "./paper.js";

describe("a DOI is stored in one form", () => {
  test("a bare id survives", () => {
    expect(normaliseDoi("10.1000/example")).toBe("10.1000/example");
  });

  test("a doi: prefix is dropped", () => {
    expect(normaliseDoi("doi:10.1000/example")).toBe("10.1000/example");
    expect(normaliseDoi("DOI: 10.1000/example")).toBe("10.1000/example");
  });

  test("a resolver URL is dropped", () => {
    // All three spellings name one document. Storing them as typed would make
    // two copies of one paper look like two papers to anything comparing.
    expect(normaliseDoi("https://doi.org/10.1000/example")).toBe("10.1000/example");
    expect(normaliseDoi("http://dx.doi.org/10.1000/example")).toBe("10.1000/example");
  });

  test("surrounding whitespace is dropped", () => {
    expect(normaliseDoi("  10.1000/example  ")).toBe("10.1000/example");
  });

  test("the prefix is lowercased and the suffix is not", () => {
    // The registrant code is case-insensitive by the handbook; the suffix is
    // not guaranteed to be, and lowercasing it would change what some
    // publishers issue.
    expect(normaliseDoi("10.1000/ExAmPlE")).toBe("10.1000/ExAmPlE");
  });

  test("something that is not a DOI is not one", () => {
    for (const typed of [
      "",
      "   ",
      "example",
      "10.1000",
      "10.1000/",
      "11.1000/example",
      "10.12/example",
      "10.1000/with space",
    ]) {
      expect(normaliseDoi(typed), `${typed} was accepted`).toBeUndefined();
    }
  });
});

describe("a title guessed from a filename", () => {
  test("the extension goes", () => {
    expect(titleFrom("papers/Attention is all you need.pdf")).toBe(
      "Attention is all you need",
    );
  });

  test("separators become spaces", () => {
    expect(titleFrom("deep_learning-for_chemistry.pdf")).toBe(
      "deep learning for chemistry",
    );
  });

  test("a file with no extension is its own name", () => {
    expect(titleFrom("notes")).toBe("notes");
  });

  test("nothing guessable gives nothing", () => {
    expect(titleFrom("")).toBe("");
  });

  test("a dotted name keeps everything but the last part", () => {
    // `v1.2` is a version, not an extension followed by a name.
    expect(titleFrom("survey.v1.2.pdf")).toBe("survey.v1.2");
  });
});

describe("what the form hands back", () => {
  test("both fields, when both are filled", () => {
    const result = fieldsFrom({ doi: "10.1000/x", title: "A paper" });

    expect(result).toEqual({ ok: true, values: { doi: "10.1000/x", title: "A paper" } });
  });

  test("an empty field is left out rather than written blank", () => {
    // A blank is the absence of a value, and the store drops it anyway.
    // Including it would make the document say something it does not mean.
    const result = fieldsFrom({ doi: "", title: "A paper" });

    expect(result).toEqual({ ok: true, values: { title: "A paper" } });
  });

  test("both empty is allowed and writes nothing", () => {
    // The property was still chosen, and `store::carried` keeps that decision
    // whether or not it has values.
    expect(fieldsFrom({ doi: "", title: "" })).toEqual({ ok: true, values: {} });
  });

  test("a DOI that does not parse is refused, not dropped", () => {
    // Somebody who typed one and got an object without it would have no idea
    // why.
    const result = fieldsFrom({ doi: "not a doi", title: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain("not a doi");
  });

  test("a title is trimmed", () => {
    expect(fieldsFrom({ doi: "", title: "  A paper  " })).toEqual({
      ok: true,
      values: { title: "A paper" },
    });
  });
});
