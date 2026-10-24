import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Api, Summary } from "../plugin-host/commands.js";
import { ObjectGrid } from "./ObjectGrid.js";

function row(id: string, over: Partial<Summary> = {}): Summary {
  return { id, name: `object ${id}`, path: `folder/${id}.txt`, kind: "file", cover: null, ...over };
}

/** An api answering only what the grid asks for. */
function gridApi(rows: Summary[], total = rows.length): Api {
  return {
    objectIds: async (after: string | null, limit: number) => {
      const start = after ? rows.findIndex((r) => r.id === after) + 1 : 0;
      return { ids: rows.slice(start, start + limit).map((r) => r.id), total };
    },
    objectSummaries: async (ids: readonly string[]) => rows.filter((r) => ids.includes(r.id)),
    fileUrl: async (path: string) => `asset://${path}`,
  } as unknown as Api;
}

/** An api with a folder holding one child. */
function treeApi(): Api {
  const top: Summary = { id: "1", name: "Clothing", path: "Clothing", kind: "folder", cover: null };
  const child: Summary = { id: "2", name: "outfit.zip", path: "Clothing/outfit.zip", kind: "file", cover: null };
  return {
    objectIds: async (_after: string | null, _limit: number, within?: string | null) =>
      within === "1" ? { ids: ["2"], total: 1 } : { ids: ["1"], total: 1 },
    objectSummaries: async (ids: readonly string[]) => [top, child].filter((r) => ids.includes(r.id)),
    fileUrl: async (path: string) => `asset://${path}`,
  } as unknown as Api;
}

function show(api: Api, over: { selected?: string; onSelect?: (id: string) => void } = {}) {
  return render(<ObjectGrid api={api} selected={over.selected} onSelect={over.onSelect ?? (() => {})} generation={0} />);
}

describe("a grid of what the library holds", () => {
  test("every object in the page gets a card", async () => {
    show(gridApi([row("1"), row("2"), row("3")]));
    expect(await screen.findByText("object 1")).toBeDefined();
    expect(screen.getByText("object 3")).toBeDefined();
  });

  test("the total counts the library, not the page", async () => {
    show(gridApi([row("1")], 441));
    expect(await screen.findByText("441 objects")).toBeDefined();
  });

  test("a card with a cover draws it through file.url", async () => {
    show(gridApi([row("1", { cover: ".yukifile/covers/a.png" })]));
    await waitFor(() => expect(document.querySelector("img")?.getAttribute("src")).toBe("asset://.yukifile/covers/a.png"));
  });

  test("a card without a cover draws no image, and still its name", async () => {
    show(gridApi([row("1")]));
    expect(await screen.findByText("object 1")).toBeDefined();
    expect(document.querySelector("img")).toBeNull();
  });

  test("an object with no name is untitled rather than blank", async () => {
    show(gridApi([row("1", { name: null })]));
    expect(await screen.findByText("Untitled")).toBeDefined();
  });

  test("the folder is shown under a name that is the filename", async () => {
    show(gridApi([row("1", { name: "1.txt", path: "folder/1.txt" })]));
    await screen.findByText("1.txt");
    expect(screen.getByText("folder")).toBeDefined();
  });

  test("choosing a card reports which one, and the chosen one is marked", async () => {
    const onSelect = vi.fn();
    show(gridApi([row("1"), row("2")]), { onSelect, selected: "2" });
    (await screen.findByText("object 1")).click();
    expect(onSelect).toHaveBeenCalledWith("1");
    expect(screen.getByText("object 2").closest("button")?.getAttribute("aria-current")).toBe("true");
  });

  test("an empty library says so without failing", async () => {
    show(gridApi([]));
    expect(await screen.findByText("This library holds no objects yet.")).toBeDefined();
  });

  test("a refusal is shown rather than swallowed", async () => {
    const api = { objectIds: async () => { throw new Error("the bridge is on fire"); } } as unknown as Api;
    show(api);
    expect(await screen.findByText("Error: the bridge is on fire")).toBeDefined();
  });
});

describe("paging", () => {
  test("a page is asked for, not the whole library", async () => {
    const objectIds = vi.fn(async (_after: string | null, _limit: number) => ({ ids: [] as string[], total: 0 }));
    show({ ...gridApi([]), objectIds } as unknown as Api);
    await waitFor(() => expect(objectIds).toHaveBeenCalled());
    expect(objectIds.mock.calls[0]?.[1]).toBeLessThan(500);
  });

  test("more is offered while short of the total, and not once everything is shown", async () => {
    const { unmount } = show(gridApi([row("1")], 2));
    expect(await screen.findByText("Show more")).toBeDefined();
    unmount();
    show(gridApi([row("1")], 1));
    await screen.findByText("object 1");
    expect(screen.queryByText("Show more")).toBeNull();
  });
});

describe("walking down the tree", () => {
  test("the top level is what nothing contains, and a folder offers a way in", async () => {
    show(treeApi());
    expect(await screen.findByText("Clothing")).toBeDefined();
    expect(screen.queryByText("outfit.zip")).toBeNull();
    expect(screen.getByLabelText("Open Clothing")).toBeDefined();
  });

  test("a file offers no way in", async () => {
    show(gridApi([row("1")]));
    await screen.findByText("object 1");
    expect(screen.queryByLabelText(/^Open /)).toBeNull();
  });

  test("opening shows what is inside, back returns, and opening is not selecting", async () => {
    const onSelect = vi.fn();
    show(treeApi(), { onSelect });
    (await screen.findByLabelText("Open Clothing")).click();
    expect(await screen.findByText("outfit.zip")).toBeDefined();
    expect(onSelect).not.toHaveBeenCalled();
    screen.getByText("Back").click();
    expect(await screen.findByText("Clothing")).toBeDefined();
    expect(screen.queryByText("Back")).toBeNull();
  });
});
