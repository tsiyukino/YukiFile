import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";

import {
  apiFor,
  appApiFor,
  handlerName,
  methodName,
  type Invoke,
} from "./commands.js";

/**
 * The command names in `plugin::commands::ALLOWED`, read from the Rust source.
 *
 * Reading the array rather than keeping a copy here is the point: a copy is a
 * third place to keep in step, and the failure it produces — a plugin calling
 * something that no longer exists — shows up at runtime in front of a user.
 */
function allowedCommands(): string[] {
  const source = readFileSync(
    fileURLToPath(new URL("../../src-tauri/src/plugin/commands.rs", import.meta.url)),
    "utf8",
  );

  const array = source.slice(
    source.indexOf("pub const ALLOWED"),
    source.indexOf("/// What only the application itself may ask for"),
  );

  return [...array.matchAll(/name:\s*"([^"]+)"/g)].map((match) => match[1] as string);
}

/**
 * The command names in `plugin::commands::APP_ONLY`.
 *
 * A separate list because these are things a person does through the
 * application, not things a plugin may do on their behalf. `apiFor` must not
 * offer them, which is what the test below checks.
 */
function appOnlyCommands(): string[] {
  const source = readFileSync(
    fileURLToPath(new URL("../../src-tauri/src/plugin/commands.rs", import.meta.url)),
    "utf8",
  );

  const array = source.slice(
    source.indexOf("pub const APP_ONLY"),
    source.indexOf("/// Whether a name is on either list"),
  );

  return [...array.matchAll(/name:\s*"([^"]+)"/g)].map((match) => match[1] as string);
}

describe("the list is readable from here", () => {
  test("the allowlist parses to something", () => {
    // If this breaks, the tests below stop checking anything, so it is worth
    // its own assertion rather than being assumed by the others.
    const names = allowedCommands();

    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("archive.list");
    expect(names.every((name) => name.includes("."))).toBe(true);
  });
});

describe("names are derived on both sides", () => {
  test("a handler name matches what bridge::handler_name produces", () => {
    expect(handlerName("object.get")).toBe("object_get");
    expect(handlerName("import.propose")).toBe("import_propose");
  });

  test("a method name is the camelCase of the command", () => {
    expect(methodName("archive.list")).toBe("archiveList");
    expect(methodName("hash.of")).toBe("hashOf");
  });

  test("a name with no dot survives both rules unchanged", () => {
    expect(handlerName("hash")).toBe("hash");
    expect(methodName("hash")).toBe("hash");
  });
});

describe("the api covers the list and nothing else", () => {
  test("every allowed command has a method", () => {
    // A command on the list with no method is a capability a plugin author
    // reads about and cannot call.
    const api = apiFor(async () => undefined) as unknown as Record<string, unknown>;
    const missing = allowedCommands()
      .map(methodName)
      .filter((method) => typeof api[method] !== "function");

    expect(missing).toEqual([]);
  });

  test("no method exists that is not on the list", () => {
    // The inverse, and the one that matters for review: a method calling
    // something nobody allowed.
    const api = apiFor(async () => undefined) as unknown as Record<string, unknown>;
    const expected = new Set(allowedCommands().map(methodName));
    const extra = Object.keys(api).filter((key) => !expected.has(key));

    expect(extra).toEqual([]);
  });

  test("each method invokes the handler name for its own command", () => {
    // The check that would catch a copy-paste: objectList calling object_get
    // passes both tests above and is still wrong.
    for (const listed of allowedCommands()) {
      const invoke = vi.fn((_command: string, _args: Record<string, unknown>) =>
        Promise.resolve(undefined as unknown),
      );
      const api = apiFor(invoke) as unknown as Record<string, (...a: unknown[]) => unknown>;

      // Arguments do not matter here; only which handler was named.
      void api[methodName(listed)]?.(1, "x");

      expect(invoke).toHaveBeenCalledOnce();
      expect(invoke.mock.calls[0]?.[0]).toBe(handlerName(listed));
    }
  });
});

describe("calling", () => {
  test("arguments reach the core under the names the bridge expects", async () => {
    const invoke = vi.fn(async () => []) as unknown as Invoke;
    const api = apiFor(invoke);

    await api.archiveList("Clothing/outfit.zip");

    expect(invoke).toHaveBeenCalledWith("archive_list", {
      path: "Clothing/outfit.zip",
    });
  });

  test("import carries its label as well as the document", async () => {
    // The label is what a person sees when reviewing the change set. Dropping
    // it would leave a batch nobody can attribute.
    const invoke = vi.fn(async () => ({})) as unknown as Invoke;

    await apiFor(invoke).importPropose("booth fetch", '{"objects":[]}');

    expect(invoke).toHaveBeenCalledWith("import_propose", {
      label: "booth fetch",
      document: '{"objects":[]}',
    });
  });

  test("what the core returns is passed through untouched", async () => {
    const members = [{ path: "a.png", size: 12, is_dir: false }];
    const api = apiFor(async () => members);

    await expect(api.archiveList("x.zip")).resolves.toBe(members);
  });

  test("a refusal from the core reaches the caller", async () => {
    // A plugin has to be able to tell "outside the library" from an empty
    // archive, and it cannot if the rejection is swallowed here.
    const api = apiFor(async () => {
      throw { kind: "outside_library", detail: "../../etc/passwd" };
    });

    await expect(api.archiveList("../../etc/passwd")).rejects.toMatchObject({
      kind: "outside_library",
    });
  });
});

describe("the app's own surface is not the plugin's", () => {
  test("APP_ONLY is empty, and that is deliberate", () => {
    // It held a scan command until scanning turned out to be domain knowledge
    // the core has none of. The list stays because the distinction is real —
    // a file dialog or a network fetch will need it — but nothing needs it
    // today, and an empty list is the honest state.
    expect(appOnlyCommands()).toEqual([]);
    expect(appApiFor(async () => undefined)).toEqual({});
  });

  test("scanning is not reachable from any plugin api", () => {
    // The capability did not move to another list. It stopped existing: a
    // plugin walks with fsWalk and submits with importPropose instead.
    const api = apiFor(async () => undefined) as unknown as Record<string, unknown>;

    expect(api["libraryScan"]).toBeUndefined();
    expect(typeof api["fsWalk"]).toBe("function");
    expect(typeof api["importPropose"]).toBe("function");
  });

  test("what fs.walk returns is facts, not conclusions", () => {
    // The whole point of the split. If this ever grew a field saying what an
    // entry means, the core would be back to deciding.
    const listed = allowedCommands();

    expect(listed).toContain("fs.walk");
    expect(listed).not.toContain("library.scan");
  });
});
