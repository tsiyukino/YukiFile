import { describe, expect, test, vi } from "vitest";

import { load, loadAll, modulesOf, type Resolve } from "./loader.js";
import type { Manifest } from "./types.js";

/** A resolver backed by a map, standing in for `import()`. */
function resolver(modules: Record<string, unknown>): Resolve {
  return async (specifier) => {
    if (!(specifier in modules)) throw new Error(`cannot find ${specifier}`);
    return modules[specifier];
  };
}

const booth: Manifest = {
  id: "shop.booth",
  contributes: {
    properties: ["booth"],
    panels: { booth: "./panels/Booth" },
  },
};

describe("what a manifest needs", () => {
  test("panels and viewers are both modules", () => {
    const manifest: Manifest = {
      id: "yukifile.pdf",
      contributes: {
        properties: ["pdf"],
        panels: { pdf: "./panels/Pdf" },
        viewers: { pdf: "./viewers/Pdf" },
      },
    };

    expect(modulesOf(manifest)).toEqual([
      { slot: "panel", property: "pdf", specifier: "./panels/Pdf" },
      { slot: "viewer", property: "pdf", specifier: "./viewers/Pdf" },
    ]);
  });

  test("actions and columns are not modules", () => {
    // They are ids the plugin already holds, not code to fetch. Treating them
    // as specifiers would send the loader after files that do not exist.
    const manifest: Manifest = {
      id: "shop.booth",
      contributes: {
        properties: ["booth"],
        actions: { booth: ["fetch"] },
        columns: { booth: ["price"] },
      },
    };

    expect(modulesOf(manifest)).toEqual([]);
  });

  test("one module serving two properties is fetched once", () => {
    // Its top-level code runs once, which is what a plugin author writing one
    // component for two shops would expect.
    const manifest: Manifest = {
      id: "shop.multi",
      contributes: {
        properties: ["booth", "gumroad"],
        panels: { booth: "./panels/Shop", gumroad: "./panels/Shop" },
      },
    };

    expect(modulesOf(manifest)).toHaveLength(1);
  });

  test("a manifest contributing nothing needs nothing", () => {
    expect(modulesOf({ id: "tools.empty" })).toEqual([]);
  });

  test("an empty specifier is not something to go looking for", () => {
    const manifest: Manifest = {
      id: "shop.broken",
      contributes: { properties: ["booth"], panels: { booth: "" } },
    };

    expect(modulesOf(manifest)).toEqual([]);
  });
});

describe("loading", () => {
  test("a module that resolves is returned under its specifier", async () => {
    const panel = { default: () => null };
    const loaded = await load(booth, resolver({ "./panels/Booth": panel }));

    expect(loaded.modules.get("./panels/Booth")).toBe(panel);
    expect(loaded.failures).toEqual([]);
  });

  test("the manifest comes back with its modules", async () => {
    // A caller holding a Loaded needs to know whose it is without keeping a
    // parallel array.
    const loaded = await load(booth, resolver({ "./panels/Booth": {} }));

    expect(loaded.manifest).toBe(booth);
  });

  test("each specifier is fetched exactly once", async () => {
    const resolve = vi.fn(resolver({ "./panels/Shop": {} }));
    const manifest: Manifest = {
      id: "shop.multi",
      contributes: {
        properties: ["booth", "gumroad"],
        panels: { booth: "./panels/Shop", gumroad: "./panels/Shop" },
      },
    };

    await load(manifest, resolve);

    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe("a broken module is not a broken library", () => {
  test("one module failing leaves the others loaded", async () => {
    // The asymmetry with the Rust registry: dependencies were checked before
    // anything got here, so a syntax error in one third-party panel must not
    // take the application down.
    const manifest: Manifest = {
      id: "shop.booth",
      contributes: {
        properties: ["booth"],
        panels: { booth: "./panels/Booth" },
        viewers: { booth: "./viewers/Broken" },
      },
    };

    const loaded = await load(manifest, resolver({ "./panels/Booth": { ok: true } }));

    expect(loaded.modules.get("./panels/Booth")).toEqual({ ok: true });
    expect(loaded.failures).toHaveLength(1);
  });

  test("a failure says what failed and why", async () => {
    // A failure nobody can read is one that gets shipped.
    const loaded = await load(booth, resolver({}));

    expect(loaded.failures).toEqual([
      {
        slot: "panel",
        property: "booth",
        specifier: "./panels/Booth",
        reason: "cannot find ./panels/Booth",
      },
    ]);
  });

  test("a resolver that throws something other than an Error still reports", async () => {
    // Anything can be thrown in JavaScript, and `thrown.message` on a string
    // is undefined — a failure list full of `undefined` reasons.
    const loaded = await load(booth, async () => {
      throw "the bundler gave up";
    });

    expect(loaded.failures[0]?.reason).toBe("the bundler gave up");
  });

  test("resolving to nothing is a failure, not a module", async () => {
    // An undefined module reaches a slot as an undefined component, and the
    // error surfaces at render time pointing at the wrong place.
    const loaded = await load(booth, async () => undefined);

    expect(loaded.modules.size).toBe(0);
    expect(loaded.failures[0]?.reason).toBe("resolved to nothing");
  });

  test("a failed module is absent rather than present and empty", async () => {
    // The caller renders the rest of the page around what is missing, which
    // needs the key to be gone and not to hold an empty object that would
    // look loadable at the point it is used.
    const loaded = await load(booth, resolver({}));

    expect(loaded.modules.has("./panels/Booth")).toBe(false);
  });
});

describe("loading a set", () => {
  test("plugins come back in the order they were given", async () => {
    // The registry already computed load order. Recomputing it here would be
    // a second answer to a settled question.
    const gumroad: Manifest = {
      id: "shop.gumroad",
      contributes: { properties: ["gumroad"], panels: { gumroad: "./panels/Gumroad" } },
    };
    const resolve = resolver({ "./panels/Booth": {}, "./panels/Gumroad": {} });

    const loaded = await loadAll([gumroad, booth], resolve);

    expect(loaded.map((entry) => entry.manifest.id)).toEqual([
      "shop.gumroad",
      "shop.booth",
    ]);
  });

  test("one plugin failing entirely leaves the others loaded", async () => {
    const broken: Manifest = {
      id: "shop.broken",
      contributes: { properties: ["other"], panels: { other: "./panels/Gone" } },
    };

    const loaded = await loadAll([broken, booth], resolver({ "./panels/Booth": {} }));

    expect(loaded[0]?.failures).toHaveLength(1);
    expect(loaded[1]?.modules.size).toBe(1);
  });

  test("no plugins is not an error", async () => {
    expect(await loadAll([], resolver({}))).toEqual([]);
  });
});

describe("resolving is told which plugin is asking", () => {
  test("the plugin id comes with the specifier", async () => {
    // A manifest's `./panel` is relative to that plugin's directory. Without
    // the id the caller cannot know which directory, and `import("./panel")`
    // resolves against whatever file is importing -- a 404 for a file that
    // exists, reading as a missing plugin rather than a wrong base path.
    const seen: Array<[string, string]> = [];

    await load(booth, async (specifier, plugin) => {
      seen.push([specifier, plugin]);
      return {};
    });

    expect(seen).toEqual([["./panels/Booth", "shop.booth"]]);
  });

  test("each plugin is named with its own modules", async () => {
    const other: Manifest = {
      id: "shop.gumroad",
      contributes: { properties: ["gumroad"], panels: { gumroad: "./panel" } },
    };
    const seen: string[] = [];

    await loadAll([booth, other], async (_specifier, plugin) => {
      seen.push(plugin);
      return {};
    });

    expect(seen.sort()).toEqual(["shop.booth", "shop.gumroad"]);
  });
});
