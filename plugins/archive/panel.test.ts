import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";

import { apiFor, type ArchiveMember } from "../../src/plugin-host/commands.js";
import { isProblem, open, summarise, type View } from "./panel.js";

function member(path: string, over: Partial<ArchiveMember> = {}): ArchiveMember {
  return {
    path,
    size: 100,
    compressed_size: 40,
    is_dir: false,
    escapes_root: false,
    ...over,
  };
}

/** `summarise` result, narrowed past the problem case. */
function viewOf(state: ReturnType<typeof summarise>): View {
  return state;
}

describe("summarising a listing", () => {
  test("files and folders are counted apart", () => {
    const view = summarise([
      member("Assets/".concat("Textures/"), { is_dir: true }),
      member("Assets/skin.png"),
      member("Assets/body.png"),
    ]);

    expect(view.files).toBe(2);
    expect(view.folders).toBe(1);
  });

  test("unpacked size counts files and not directory entries", () => {
    // A directory entry's size is zero in a zip, but relying on that rather
    // than on is_dir would break on an archive that writes something else.
    const view = summarise([
      member("d/", { is_dir: true, size: 4096 }),
      member("a.png", { size: 300 }),
      member("b.png", { size: 200 }),
    ]);

    expect(view.unpacked).toBe(500);
  });

  test("an empty archive is a view, not a problem", () => {
    // A zip with nothing in it is a real thing to own and says something
    // about the object. It is not a failure to open.
    const view = summarise([]);

    expect(view.rows).toEqual([]);
    expect(view.files).toBe(0);
    expect(view.hidden).toBe(0);
  });
});

describe("truncation", () => {
  test("a long listing is cut and says how much is missing", () => {
    const many = Array.from({ length: 4000 }, (_, i) => member(`f${i}.png`));

    const view = summarise(many);

    expect(view.rows).toHaveLength(50);
    expect(view.hidden).toBe(3950);
  });

  test("counts are over the whole archive, not the visible rows", () => {
    // Reporting 50 files because 50 rows fit would be a number that quietly
    // means something other than what it says.
    const many = Array.from({ length: 4000 }, (_, i) => member(`f${i}.png`, { size: 10 }));

    const view = summarise(many);

    expect(view.files).toBe(4000);
    expect(view.unpacked).toBe(40_000);
  });

  test("an archive that fits exactly hides nothing", () => {
    const exact = Array.from({ length: 50 }, (_, i) => member(`f${i}.png`));

    expect(summarise(exact).hidden).toBe(0);
  });
});

describe("entries that escape the archive root", () => {
  test("an escaping entry is reported by name", () => {
    const view = summarise([
      member("normal.png"),
      member("../../autoexec.bat", { escapes_root: true }),
    ]);

    expect(view.escaping).toEqual(["../../autoexec.bat"]);
  });

  test("an escaping entry beyond the visible rows is still reported", () => {
    // The warning must not depend on where in the archive the entry sits.
    // Scanning only the truncated rows would hide exactly the case worth
    // seeing in a 4000-entry archive.
    const many = Array.from({ length: 200 }, (_, i) => member(`f${i}.png`));
    many.push(member("../escape.sh", { escapes_root: true }));

    const view = summarise(many);

    expect(view.rows).toHaveLength(50);
    expect(view.escaping).toEqual(["../escape.sh"]);
  });

  test("a well-behaved archive reports nothing", () => {
    expect(summarise([member("a.png"), member("b/", { is_dir: true })]).escaping).toEqual(
      [],
    );
  });
});

describe("opening one", () => {
  test("a readable archive becomes a view", async () => {
    const api = apiFor(async () => [member("a.png"), member("b.png")]);

    const state = await open(api, "Clothing/outfit.zip");

    expect(isProblem(state)).toBe(false);
    expect((state as View).files).toBe(2);
  });

  test("the path is passed through to the core untouched", async () => {
    // The core resolves it against the library root. A panel that normalised
    // or absolutised it first would be doing the confinement check's job with
    // none of its care.
    const invoke = vi.fn(async () => []);
    const api = apiFor(invoke);

    await open(api, "Clothing/outfit.zip");

    expect(invoke).toHaveBeenCalledWith("archive_list", {
      path: "Clothing/outfit.zip",
    });
  });

  test("a file that is not an archive is a problem, not a throw", async () => {
    // The seed library has a RAR that cannot be opened at all. A panel that
    // threw would take the whole object page down over one unreadable file.
    const api = apiFor(async () => {
      throw { kind: "not_an_archive", detail: "unsupported" };
    });

    const state = await open(api, "weird.rar");

    expect(isProblem(state)).toBe(true);
    expect((state as { problem: string }).problem).toContain("cannot be read");
  });

  test("a refusal from the confinement check is shown as one", async () => {
    const api = apiFor(async () => {
      throw { kind: "outside_library" };
    });

    const state = await open(api, "../../etc/passwd");

    expect((state as { problem: string }).problem).toContain("outside the library");
  });

  test("an unrecognised failure still says something readable", async () => {
    // Not [object Object]. Whatever reaches a screen has to be words.
    const api = apiFor(async () => {
      throw new Error("the bridge is on fire");
    });

    const state = await open(api, "x.zip");

    expect((state as { problem: string }).problem).toBe("the bridge is on fire");
  });
});

describe("the manifest", () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL("./manifest.json", import.meta.url)), "utf8"),
  ) as {
    id: string;
    contributes: {
      properties: string[];
      file_types: Record<string, string[]>;
      panels: Record<string, string>;
      columns: Record<string, string[]>;
    };
  };

  test("the panel specifier names no file extension", () => {
    // Which extension the module has on disk is the resolver's business. A
    // manifest naming ./panel.js has to be edited when the build changes.
    for (const specifier of Object.values(manifest.contributes.panels)) {
      expect(specifier).not.toMatch(/\.(js|mjs|cjs|ts|mts|cts|tsx|jsx)$/);
    }
  });

  test("the file type is an extension without a dot", () => {
    // Manifest::check refuses a leading dot. Catching it here as well means a
    // TypeScript-side edit fails before anyone runs the Rust tests.
    for (const extension of Object.keys(manifest.contributes.file_types)) {
      expect(extension.startsWith(".")).toBe(false);
    }
  });

  test("everything contributed is keyed to a property this plugin declares", () => {
    // Requiring or declaring a property is the ticket into its region.
    const declared = new Set(manifest.contributes.properties);

    for (const keyed of [manifest.contributes.panels, manifest.contributes.columns]) {
      for (const property of Object.keys(keyed)) {
        expect(declared.has(property)).toBe(true);
      }
    }
  });

  test("the property it declares is the one its file type brings", () => {
    // A plugin registering `zip` as bringing a property it does not define
    // would put a panel in someone else's region.
    const brought = new Set(Object.values(manifest.contributes.file_types).flat());

    for (const property of brought) {
      expect(manifest.contributes.properties).toContain(property);
    }
  });
});
