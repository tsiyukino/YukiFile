import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Api, Filter, Sort, Summary } from "../plugin-host/commands.js";
import type { CardSize } from "./Card.js";
import { NOTHING, toggleField, type Narrowing } from "./filters.js";
import { ObjectGrid, PAGE, type Crumb } from "./ObjectGrid.js";

function row(id: string, over: Partial<Summary> = {}): Summary {
  return { id, name: `object ${id}`, path: `folder/${id}.txt`, kind: "file", cover: null, children: 0, ...over };
}

/** An api answering only what the grid asks for, from a fixed set of rows. */
function gridApi(rows: Summary[], total = rows.length) {
  const objectQuery = vi.fn(async (_filter: Filter, _sort: Sort, offset: number, limit: number) => ({
    ids: rows.slice(offset, offset + limit).map((r) => r.id),
    total,
  }));
  const api = {
    objectQuery,
    objectSummaries: async (ids: readonly string[]) => rows.filter((r) => ids.includes(r.id)),
    fileUrl: async (path: string) => `asset://${path}`,
  } as unknown as Api;
  return { api, objectQuery };
}

/** A grouping holding one folder holding one file. */
function treeApi() {
  const top: Summary = { id: "1", name: "Clothing", path: null, kind: null, cover: null, children: 1 };
  const folder: Summary = { id: "2", name: "Outfit", path: "Clothing/Outfit", kind: "folder", cover: null, children: 0 };
  const objectQuery = vi.fn(async (filter: Filter) =>
    filter.within === "1" ? { ids: ["2"], total: 1 } : { ids: ["1"], total: 1 },
  );
  const api = {
    objectQuery,
    objectSummaries: async (ids: readonly string[]) => [top, folder].filter((r) => ids.includes(r.id)),
    fileUrl: async (path: string) => `asset://${path}`,
  } as unknown as Api;
  return { api, objectQuery };
}

interface Shown {
  narrowing?: Narrowing;
  trail?: readonly Crumb[];
  onTrail?: (trail: readonly Crumb[]) => void;
  onNarrow?: (narrowing: Narrowing) => void;
  onChoose?: (id: string) => void;
  onSort?: (sort: Sort) => void;
  onSize?: (size: CardSize) => void;
  current?: string;
}

function show(api: Api, over: Shown = {}) {
  return render(
    <ObjectGrid
      api={api}
      narrowing={over.narrowing ?? NOTHING}
      onNarrow={over.onNarrow ?? (() => {})}
      trail={over.trail ?? []}
      onTrail={over.onTrail ?? (() => {})}
      sort="name"
      onSort={over.onSort ?? (() => {})}
      size="medium"
      onSize={over.onSize ?? (() => {})}
      labels={new Map()}
      onChoose={over.onChoose ?? (() => {})}
      current={over.current}
      generation={0}
    />,
  );
}

describe("a grid of what the library holds", () => {
  test("every object in the page gets a card", async () => {
    show(gridApi([row("1"), row("2"), row("3")]).api);
    expect(await screen.findByText("object 1")).toBeDefined();
    expect(screen.getByText("object 3")).toBeDefined();
  });

  test("the total counts every match, not the page", async () => {
    show(gridApi([row("1")], 441).api);
    expect(await screen.findByText("441 objects")).toBeDefined();
  });

  test("a card with a cover draws it through file.url", async () => {
    show(gridApi([row("1", { cover: ".yukifile/covers/a.png" })]).api);
    await waitFor(() => expect(document.querySelector("img")?.getAttribute("src")).toBe("asset://.yukifile/covers/a.png"));
  });

  test("a card without a cover says what the thing is instead", async () => {
    show(gridApi([row("1", { path: "Hair/twin.unitypackage" })]).api);
    expect(await screen.findByText("Unity package")).toBeDefined();
    expect(document.querySelector("img")).toBeNull();
  });

  test("an object with no name is untitled rather than blank", async () => {
    show(gridApi([row("1", { name: null })]).api);
    expect(await screen.findByText("Untitled")).toBeDefined();
  });

  test("choosing a card reports which one, and the last one opened is marked", async () => {
    const onChoose = vi.fn();
    show(gridApi([row("1"), row("2")]).api, { onChoose, current: "2" });
    fireEvent.click(await screen.findByText("object 1"));
    expect(onChoose).toHaveBeenCalledWith("1");
    expect(screen.getByText("object 2").closest("button")?.getAttribute("aria-current")).toBe("true");
  });

  test("no card holds a button inside a button", async () => {
    // A nested button is invalid markup a browser may rearrange; React
    // warns about it on every render.
    show(treeApi().api);
    await screen.findByText("Clothing");
    expect(document.querySelector("button button")).toBeNull();
  });

  test("an empty library says so without failing", async () => {
    show(gridApi([]).api);
    expect(await screen.findByText("This library holds no objects yet")).toBeDefined();
  });

  test("a refusal is shown rather than swallowed", async () => {
    const api = { objectQuery: async () => { throw new Error("the bridge is on fire"); } } as unknown as Api;
    show(api);
    expect(await screen.findByText("the bridge is on fire")).toBeDefined();
  });
});

describe("what a card says", () => {
  test("what it is and what it fits, in place of where it sits", async () => {
    const rows = [
      row("1", {
        facets: { category: "Clothing", vendor: "SilverSpace" },
        terms: ["Airi", "Chiffon", "Manuka", "Moe", "Shinano"].map((label) => ({ vocab: "avatar", id: label.toLowerCase(), label })),
      }),
    ];
    const { api } = gridApi(rows);
    const summaries = vi.spyOn(api, "objectSummaries");
    render(
      <ObjectGrid
        api={api}
        narrowing={NOTHING}
        onNarrow={() => {}}
        trail={[]}
        onTrail={() => {}}
        sort="name"
        onSort={() => {}}
        size="medium"
        onSize={() => {}}
        labels={new Map()}
        onChoose={() => {}}
        generation={0}
        detail={{ fields: ["category", "vendor"], vocabularies: ["avatar"] }}
      />,
    );
    expect(await screen.findByText("Clothing · SilverSpace")).toBeDefined();
    expect(screen.getByText("Airi, Chiffon, Manuka +2")).toBeDefined();
    expect(screen.queryByText("folder/1.txt")).toBeNull();
    expect(summaries).toHaveBeenCalledWith(["1"], ["category", "vendor"], ["avatar"]);
  });

  test("a grouping with no cover shows covers from inside it", async () => {
    show(gridApi([row("1", { path: null, kind: null, children: 9, previews: ["a.png", "b.png"] })]).api);
    await waitFor(() => expect(document.querySelectorAll(".yk-mosaic img")).toHaveLength(2));
  });

  test("a card with nothing known about it still says where it is", async () => {
    show(gridApi([row("1")]).api);
    expect(await screen.findByText("folder/1.txt")).toBeDefined();
  });
});

describe("narrowing", () => {
  test("with nothing chosen the grid browses the top of the tree", async () => {
    const { api, objectQuery } = gridApi([row("1")]);
    show(api);
    await screen.findByText("object 1");
    expect(objectQuery.mock.calls[0]?.[0]).toEqual({ top: true });
  });

  test("anything chosen asks across the whole library, and says it is results", async () => {
    const { api, objectQuery } = gridApi([row("1")]);
    show(api, { narrowing: toggleField(NOTHING, "category", "Hair"), trail: [{ id: "9", name: "Somewhere" }] });
    expect(await screen.findByText("Results")).toBeDefined();
    const asked = objectQuery.mock.calls[0]?.[0];
    expect(asked?.within).toBeUndefined();
    expect(asked?.fields).toEqual([{ field: "category", value: "Hair" }]);
  });

  test("a chip removes its own choice, and clear removes all", async () => {
    const onNarrow = vi.fn();
    show(gridApi([row("1")]).api, { narrowing: toggleField(NOTHING, "category", "Hair"), onNarrow });
    await screen.findByText("Category: Hair");
    fireEvent.click(screen.getByText("Clear all"));
    expect(onNarrow).toHaveBeenCalledWith(NOTHING);
  });

  test("nothing matching says so", async () => {
    show(gridApi([]).api, { narrowing: toggleField(NOTHING, "category", "Hair") });
    expect(await screen.findByText("Nothing matches")).toBeDefined();
  });
});

describe("paging", () => {
  test("a page is asked for, not the whole library", async () => {
    const { api, objectQuery } = gridApi([]);
    show(api);
    await waitFor(() => expect(objectQuery).toHaveBeenCalled());
    expect(objectQuery.mock.calls[0]?.[3]).toBe(PAGE);
    expect(PAGE).toBeLessThan(500);
  });

  test("more is offered while short of the total, and asks from where the grid stopped", async () => {
    const rows = Array.from({ length: PAGE + 1 }, (_, i) => row(String(i + 1)));
    const { api, objectQuery } = gridApi(rows);
    show(api);
    fireEvent.click(await screen.findByText("Show more"));
    await screen.findByText(`object ${PAGE + 1}`);
    expect(objectQuery.mock.calls[1]?.[2]).toBe(PAGE);
    expect(screen.queryByText("Show more")).toBeNull();
  });
});

describe("walking down the tree", () => {
  test("a grouping offers a way in; a thing with nothing inside does not", async () => {
    show(treeApi().api);
    expect(await screen.findByText("Clothing")).toBeDefined();
    expect(screen.getByLabelText("Open Clothing")).toBeDefined();
    expect(screen.queryByLabelText("Open Outfit")).toBeNull();
  });

  test("opening adds to the trail, and is not choosing", async () => {
    const onTrail = vi.fn();
    const onChoose = vi.fn();
    show(treeApi().api, { onTrail, onChoose });
    fireEvent.click(await screen.findByLabelText("Open Clothing"));
    expect(onTrail).toHaveBeenCalledWith([{ id: "1", name: "Clothing" }]);
    expect(onChoose).not.toHaveBeenCalled();
  });

  test("a grouping with no place on disk opens when chosen, since it is only what it holds", async () => {
    const onTrail = vi.fn();
    const onChoose = vi.fn();
    show(treeApi().api, { onTrail, onChoose });
    fireEvent.click(await screen.findByText("Clothing"));
    expect(onTrail).toHaveBeenCalledWith([{ id: "1", name: "Clothing" }]);
    expect(onChoose).not.toHaveBeenCalled();
  });

  test("inside a grouping the grid asks for what it contains and the trail leads back", async () => {
    const onTrail = vi.fn();
    const { api, objectQuery } = treeApi();
    show(api, { trail: [{ id: "1", name: "Clothing" }], onTrail });
    expect(await screen.findByText("Outfit")).toBeDefined();
    expect(objectQuery.mock.calls[0]?.[0]).toEqual({ within: "1" });
    fireEvent.click(screen.getByText("Library"));
    expect(onTrail).toHaveBeenCalledWith([]);
  });
});
