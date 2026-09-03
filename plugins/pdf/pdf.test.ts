import { describe, expect, test, vi } from "vitest";

import type { Api, FlatObject } from "../../src/plugin-host/commands.js";
import { clampPage, isProblem, pdfLocation, sourceFor } from "./pdf.js";

function object(paths: string[]): FlatObject {
  return {
    id: "1",
    shared: {},
    regions: [],
    skipped: [],
    carries: ["pdf#1"],
    locations: paths.map((path) => ({ path, kind: "file" as const, size: 100 })),
  };
}

describe("finding the document", () => {
  test("the pdf among an object's locations is the one used", () => {
    // An object spans a folder and the file inside it; only one of those is
    // something pdf.js can open.
    expect(pdfLocation(object(["Papers", "Papers/thesis.pdf"]))).toBe(
      "Papers/thesis.pdf",
    );
  });

  test("the extension is matched whatever its case", () => {
    // `.PDF` is ordinary on Windows, and refusing it would make the plugin
    // fail on files it plainly handles.
    expect(pdfLocation(object(["THESIS.PDF"]))).toBe("THESIS.PDF");
  });

  test("an object with no pdf has none", () => {
    expect(pdfLocation(object(["notes.txt"]))).toBeUndefined();
  });

  test("a grouping has no location at all", () => {
    expect(pdfLocation(object([]))).toBeUndefined();
  });
});

describe("staying inside the document", () => {
  test("a page before the first is the first", () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(-5, 10)).toBe(1);
  });

  test("a page past the last is the last", () => {
    expect(clampPage(99, 10)).toBe(10);
  });

  test("a document with no pages still answers", () => {
    // getDocument can report zero before it has read the catalogue, and a
    // clamp returning 0 would ask for a page that does not exist.
    expect(clampPage(1, 0)).toBe(1);
  });

  test("a fractional page is truncated rather than rounded", () => {
    expect(clampPage(2.9, 10)).toBe(2);
  });
});

describe("asking for something to render", () => {
  test("a url comes back for a real pdf", async () => {
    const api = {
      fileUrl: async (path: string) => `asset://localhost/${path}`,
    } as unknown as Api;

    const source = await sourceFor(api, object(["thesis.pdf"]));

    expect(isProblem(source)).toBe(false);
    expect(source).toEqual({ url: "asset://localhost/thesis.pdf" });
  });

  test("the plugin asks for a url and never for bytes", async () => {
    // The whole point of the shape: a plugin that could read the file and
    // also call importPropose could encode what it read into what it
    // proposes. It is handed a handle instead.
    const fileUrl = vi.fn(async () => "asset://localhost/x.pdf");
    const api = { fileUrl } as unknown as Api;

    await sourceFor(api, object(["x.pdf"]));

    expect(fileUrl).toHaveBeenCalledWith("x.pdf");
  });

  test("an object with no pdf is a problem, not a throw", async () => {
    const api = { fileUrl: async () => "" } as unknown as Api;

    const source = await sourceFor(api, object(["notes.txt"]));

    expect(isProblem(source)).toBe(true);
  });

  test("a refusal from the core is shown in words", async () => {
    const api = {
      fileUrl: async () => {
        throw { kind: "outside_library" };
      },
    } as unknown as Api;

    const source = await sourceFor(api, object(["../escape.pdf"]));

    expect((source as { problem: string }).problem).toContain("outside the library");
  });

  test("an unrecognised failure still reads as words", async () => {
    const api = {
      fileUrl: async () => {
        throw new Error("the bridge is on fire");
      },
    } as unknown as Api;

    const source = await sourceFor(api, object(["x.pdf"]));

    expect((source as { problem: string }).problem).toBe("the bridge is on fire");
  });
});

describe("the manifest", () => {
  test("it contributes both a panel and a viewer", async () => {
    // The two slots are independent, and a plugin using both is what proves
    // it. This is also the first viewer contribution in the project.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");

    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL("./manifest.json", import.meta.url)), "utf8"),
    ) as { contributes: { panels: object; viewers: object; file_types: object } };

    expect(Object.keys(manifest.contributes.panels)).toEqual(["pdf"]);
    expect(Object.keys(manifest.contributes.viewers)).toEqual(["pdf"]);
    expect(Object.keys(manifest.contributes.file_types)).toEqual(["pdf"]);
  });
});
