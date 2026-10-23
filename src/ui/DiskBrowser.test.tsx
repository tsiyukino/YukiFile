import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Api, Entry, KnownPath } from "../plugin-host/commands.js";
import { descriptionOf, DiskBrowser } from "./DiskBrowser.js";

/** One entry as `fs.walk` reports it, named relative to the directory walked. */
function entry(name: string, kind: "file" | "folder" = "file", size = 2048): Entry {
  return { path: name, kind, size: kind === "file" ? size : null, mtime: null };
}

/**
 * A disk with a root and one folder, and a library holding some of it.
 *
 * `fsWalk` answers by directory the way the real one does: a bare name for
 * whatever sits inside what was walked.
 */
function diskApi(known: KnownPath[] = [], fsWalk?: Api["fsWalk"]): {
  api: Api;
  fsWalk: ReturnType<typeof vi.fn>;
} {
  const walk = vi.fn(
    fsWalk ??
      (async (under: string | null) => {
        if (under === null) return [entry("Clothing", "folder"), entry("notes.txt")];
        if (under === "Clothing") return [entry("outfit.zip"), entry("AW KLASSIK", "folder")];
        return [];
      }),
  );
  return {
    api: { fsWalk: walk, pathList: async () => known } as unknown as Api,
    fsWalk: walk,
  };
}

function show(api: Api, over: { onSelect?: (id: string) => void; onAdd?: (at: unknown) => void } = {}) {
  return render(
    <DiskBrowser
      api={api}
      generation={0}
      onSelect={over.onSelect ?? (() => undefined)}
      onAdd={over.onAdd ?? (() => undefined)}
    />,
  );
}

describe("listing a directory", () => {
  test("one level is asked for, not the tree", async () => {
    // The root of the seed library holds 10 entries and 441 below them.
    // Drawing ten rows must not read the rest.
    const { api, fsWalk } = diskApi();
    show(api);

    await screen.findByText("Clothing");
    expect(fsWalk).toHaveBeenCalledWith(null, 1);
  });

  test("every entry gets a row", async () => {
    show(diskApi().api);

    expect(await screen.findByText("Clothing")).toBeDefined();
    expect(screen.getByText("notes.txt")).toBeDefined();
    expect(screen.getByText("2 entries, 0 recorded")).toBeDefined();
  });

  test("a recorded entry is marked and counted", async () => {
    show(diskApi([{ path: "notes.txt", object: "7" }]).api);

    await screen.findByText("notes.txt");
    expect(screen.getByText("recorded")).toBeDefined();
    expect(screen.getByText("2 entries, 1 recorded")).toBeDefined();
  });

  test("an empty directory says so rather than showing nothing", async () => {
    const { api } = diskApi([], async () => []);
    show(api);

    expect(await screen.findByText("Nothing here.")).toBeDefined();
  });
});

describe("opening a folder", () => {
  test("walks the folder and marks against the joined path", async () => {
    // The join. Inside `Clothing` the walk reports `outfit.zip`; the library
    // holds `Clothing/outfit.zip`. Compared unjoined, nothing below the root
    // is ever recognised.
    const { api, fsWalk } = diskApi([{ path: "Clothing/outfit.zip", object: "3" }]);
    show(api);

    await screen.findByText("Clothing");
    fireEvent.click(screen.getByLabelText("Open"));

    await screen.findByText("outfit.zip");
    expect(fsWalk).toHaveBeenLastCalledWith("Clothing", 1);
    expect(screen.getByText("recorded")).toBeDefined();
  });

  test("back returns to where the browser came from", async () => {
    show(diskApi().api);

    await screen.findByText("Clothing");
    fireEvent.click(screen.getByLabelText("Open"));
    await screen.findByText("outfit.zip");

    fireEvent.click(screen.getByText("Back"));

    expect(await screen.findByText("notes.txt")).toBeDefined();
    expect(screen.queryByText("Back")).toBeNull();
  });

  test("opening is not choosing", async () => {
    // The chevron goes inside; the name is the thing. A person opening a
    // folder to look has not asked to add it.
    const onAdd = vi.fn();
    show(diskApi().api, { onAdd });

    await screen.findByText("Clothing");
    fireEvent.click(screen.getByLabelText("Open"));
    await screen.findByText("outfit.zip");

    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe("choosing a row", () => {
  test("a new row offers to add it, with its full path and kind", async () => {
    // The kind comes from the walk. The core does not look twice, so what
    // the browser saw is what it has to say.
    const onAdd = vi.fn();
    show(diskApi().api, { onAdd });

    await screen.findByText("Clothing");
    fireEvent.click(screen.getByLabelText("Open"));
    await screen.findByText("AW KLASSIK");
    fireEvent.click(screen.getByText("AW KLASSIK"));

    expect(onAdd).toHaveBeenCalledWith({ path: "Clothing/AW KLASSIK", kind: "folder" });
  });

  test("a recorded row opens its object instead", async () => {
    // The browser is also a way of finding an object by where it sits.
    const onAdd = vi.fn();
    const onSelect = vi.fn();
    show(diskApi([{ path: "notes.txt", object: "7" }]).api, { onAdd, onSelect });

    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByText("notes.txt"));

    expect(onSelect).toHaveBeenCalledWith("7");
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe("hiding what is recorded", () => {
  test("the toggle leaves only what could be added", async () => {
    show(diskApi([{ path: "notes.txt", object: "7" }]).api);

    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByLabelText("Hide recorded"));

    expect(screen.queryByText("notes.txt")).toBeNull();
    expect(screen.getByText("Clothing")).toBeDefined();
    // The count still describes the directory, not the filtered view.
    expect(screen.getByText("2 entries, 1 recorded")).toBeDefined();
  });

  test("a directory that is entirely recorded says so", async () => {
    show(
      diskApi([
        { path: "Clothing", object: "1" },
        { path: "notes.txt", object: "7" },
      ]).api,
    );

    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByLabelText("Hide recorded"));

    expect(await screen.findByText("Everything here is recorded.")).toBeDefined();
  });
});

describe("what a row says beside its name", () => {
  const row = { name: "a", path: "a", kind: "file" as const, size: 2048, known: false };

  test("a recorded row says so, whatever else is true of it", () => {
    expect(descriptionOf({ ...row, known: true })).toBe("recorded");
  });

  test("a new file shows its size", () => {
    expect(descriptionOf(row)).toBe("2.0 KB");
  });

  test("a new folder shows nothing", () => {
    expect(descriptionOf({ ...row, kind: "folder", size: null })).toBe("");
  });
});

describe("when the disk cannot be read", () => {
  test("the refusal is shown in words", async () => {
    const { api } = diskApi([], async () => {
      throw { kind: "unreadable", detail: "Clothing" };
    });
    show(api);

    expect(await screen.findByText("the core refused: unreadable")).toBeDefined();
  });
});
