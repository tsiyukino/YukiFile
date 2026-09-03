import { describe, expect, test, vi } from "vitest";

import type { Api } from "../plugin-host/commands.js";
import { describe as inWords, gather } from "./App.js";

/** An api answering only what `gather` asks for. */
function fakeApi(over: Partial<Api> = {}): Api {
  return {
    pluginList: async () => [],
    mountOrder: async () => [],
    objectIds: async () => ({ ids: [], total: 0 }),
    objectFlat: async (id: string) => ({
      id,
      shared: {},
      regions: [],
      skipped: [],
      carries: [],
      locations: [],
    }),
    ...over,
  } as Api;
}

describe("gathering what the page needs", () => {
  test("an empty library yields no object rather than an error", () => {
    // A fresh library before its first scan. Treating that as a failure would
    // put an error on the screen somebody sees the moment they install.
    return expect(gather(fakeApi())).resolves.toMatchObject({
      object: undefined,
      total: 0,
    });
  });

  test("the first object is fetched and resolved", async () => {
    const objectFlat = vi.fn(async (id: string) => ({
      id,
      shared: { title: [{ value: "BE NATURAL", from: null }] },
      regions: [],
      skipped: [],
      carries: [],
      locations: [],
    }));

    const context = await gather(
      fakeApi({ objectIds: async () => ({ ids: ["42"], total: 7 }), objectFlat }),
    );

    expect(objectFlat).toHaveBeenCalledWith("42");
    expect(context.object?.id).toBe("42");
    // The page needs the total, not just the one object it drew.
    expect(context.total).toBe(7);
  });

  test("only one object is asked for", async () => {
    // There is no grid yet. Fetching the whole library to show one object is
    // the shape that stops working on somebody else's 1518 objects.
    const objectIds = vi.fn(async () => ({ ids: ["1"], total: 1500 }));

    await gather(fakeApi({ objectIds }));

    expect(objectIds).toHaveBeenCalledWith(null, 1);
  });

  test("a plugin whose module will not load does not stop the rest", async () => {
    // loadAll reports failures rather than throwing, and this is the call
    // site that would swallow that if it awaited wrongly.
    const context = await gather(
      fakeApi({
        pluginList: async () => [
          { id: "good.plugin", contributes: { properties: ["a"], panels: { a: "./nope" } } },
          { id: "quiet.plugin" },
        ],
      }),
    );

    expect(context.plugins).toHaveLength(2);
    expect(context.loaded).toHaveLength(2);
    expect(context.loaded[0]?.failures).toHaveLength(1);
  });

  test("mount order is carried through unchanged", async () => {
    // Slot ordering is mount order. Re-sorting it here would be a second
    // answer to a question the library already settled.
    const mounts = [
      { namespace: "gumroad", instance: 1 },
      { namespace: "booth", instance: 1 },
    ];

    const context = await gather(fakeApi({ mountOrder: async () => mounts }));

    expect(context.mounts).toEqual(mounts);
  });
});

describe("saying what went wrong", () => {
  test("a refusal from the core keeps its tag", () => {
    expect(inWords({ kind: "outside_library" })).toContain("outside_library");
  });

  test("an ordinary error keeps its message", () => {
    expect(inWords(new Error("the bridge is on fire"))).toBe("the bridge is on fire");
  });

  test("something thrown that is neither still reads as words", () => {
    expect(inWords("just a string")).toBe("just a string");
  });
});

describe("reloading after a scan", () => {
  test("gather is called again for a new generation", async () => {
    // Clearing the context alone left a spinner nothing would replace: the
    // effect ran once, had no reason to run again, and "reload" meant "show
    // the loading state forever". This is the property that was missing.
    const objectIds = vi.fn(async () => ({ ids: [], total: 0 }));
    const api = fakeApi({ objectIds });

    await gather(api);
    await gather(api);

    expect(objectIds).toHaveBeenCalledTimes(2);
  });

  test("a second gather sees what the first did not", async () => {
    // A scan is the thing that happens between the two, so the second call
    // has to read the library again rather than reuse an answer.
    let scanned = false;
    const api = fakeApi({
      objectIds: async () => (scanned ? { ids: ["1"], total: 441 } : { ids: [], total: 0 }),
    });

    expect((await gather(api)).object).toBeUndefined();
    scanned = true;
    expect((await gather(api)).object?.id).toBe("1");
  });
});
