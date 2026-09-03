import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Api, Summary } from "../plugin-host/commands.js";
import { ObjectList } from "./ObjectList.js";

function row(id: string, over: Partial<Summary> = {}): Summary {
  return { id, name: `object ${id}`, path: `folder/${id}.txt`, kind: "file", ...over };
}

/** An api answering only what the list asks for. */
function listApi(rows: Summary[], total = rows.length): Api {
  return {
    objectIds: async (after: string | null, limit: number) => {
      const start = after ? rows.findIndex((r) => r.id === after) + 1 : 0;
      return { ids: rows.slice(start, start + limit).map((r) => r.id), total };
    },
    objectSummaries: async (ids: readonly string[]) =>
      rows.filter((r) => ids.includes(r.id)),
  } as unknown as Api;
}

/** An api with a folder holding one child. */
function treeApi(): Api {
  const top: Summary = {
    id: "1",
    name: "Clothing",
    path: "Clothing",
    kind: "folder",
  };
  const child: Summary = {
    id: "2",
    name: "outfit.zip",
    path: "Clothing/outfit.zip",
    kind: "file",
  };

  return {
    objectIds: async (_after: string | null, _limit: number, within?: string | null) =>
      within === "1"
        ? { ids: ["2"], total: 1 }
        : { ids: ["1"], total: 1 },
    objectSummaries: async (ids: readonly string[]) =>
      [top, child].filter((row) => ids.includes(row.id)),
  } as unknown as Api;
}

describe("listing what the library holds", () => {
  test("every object in the page gets a row", async () => {
    render(
      <ObjectList
        api={listApi([row("1"), row("2"), row("3")])}
        selected={undefined}
        onSelect={() => {}}
        generation={0}
      />,
    );

    await waitFor(() => expect(screen.getByText("object 1")).toBeDefined());
    expect(screen.getByText("object 3")).toBeDefined();
  });

  test("the total counts the library, not the page", async () => {
    // A list showing 100 of 441 has to say 441, or a person scrolling to the
    // bottom concludes that is all there is.
    render(
      <ObjectList
        api={listApi([row("1")], 441)}
        selected={undefined}
        onSelect={() => {}}
        generation={0}
      />,
    );

    await waitFor(() => expect(screen.getByText("441 objects")).toBeDefined());
  });

  test("an object with no name is shown as untitled rather than blank", async () => {
    render(
      <ObjectList
        api={listApi([row("1", { name: null, path: null, kind: null })])}
        selected={undefined}
        onSelect={() => {}}
        generation={0}
      />,
    );

    await waitFor(() => expect(screen.getByText("Untitled")).toBeDefined());
  });

  test("the path is shown when it differs from the name", async () => {
    render(
      <ObjectList
        api={listApi([row("1", { name: "outfit.zip", path: "Clothing/outfit.zip" })])}
        selected={undefined}
        onSelect={() => {}}
        generation={0}
      />,
    );

    await waitFor(() => expect(screen.getByText("Clothing/outfit.zip")).toBeDefined());
  });

  test("a name equal to its path is not repeated", async () => {
    // A file at the library root is named by its own path. Printing it twice
    // is noise on every row of a flat library.
    render(
      <ObjectList
        api={listApi([row("1", { name: "notes.txt", path: "notes.txt" })])}
        selected={undefined}
        onSelect={() => {}}
        generation={0}
      />,
    );

    await waitFor(() => expect(screen.getAllByText("notes.txt")).toHaveLength(1));
  });

  test("choosing a row reports which one", async () => {
    const onSelect = vi.fn();
    render(
      <ObjectList
        api={listApi([row("1"), row("2")])}
        selected={undefined}
        onSelect={onSelect}
        generation={0}
      />,
    );

    await waitFor(() => expect(screen.getByText("object 2")).toBeDefined());
    screen.getByText("object 2").click();

    expect(onSelect).toHaveBeenCalledWith("2");
  });

  test("an empty library lists nothing without failing", async () => {
    render(
      <ObjectList
        api={listApi([])}
        selected={undefined}
        onSelect={() => {}}
        generation={0}
      />,
    );

    await waitFor(() => expect(screen.getByText("0 objects")).toBeDefined());
  });

  test("a refusal is shown rather than swallowed", async () => {
    const api = {
      objectIds: async () => {
        throw new Error("the library went away");
      },
    } as unknown as Api;

    render(
      <ObjectList api={api} selected={undefined} onSelect={() => {}} generation={0} />,
    );

    await waitFor(() => expect(screen.getByText(/went away/)).toBeDefined());
  });
});

describe("paging", () => {
  test("only a page is asked for, not the whole library", async () => {
    // 1518 objects to draw a sidebar is the shape that stops working on
    // somebody else's library rather than on ours.
    const objectIds = vi.fn(
      async (_after: string | null, _limit: number) => ({ ids: ["1"], total: 1518 }),
    );
    const api = {
      objectIds,
      objectSummaries: async () => [row("1")],
    } as unknown as Api;

    render(
      <ObjectList api={api} selected={undefined} onSelect={() => {}} generation={0} />,
    );

    await waitFor(() => expect(objectIds).toHaveBeenCalled());
    expect(objectIds.mock.calls[0]?.[1]).toBe(100);
  });

  test("more is offered while the page is short of the total", async () => {
    render(
      <ObjectList
        api={listApi([row("1")], 441)}
        selected={undefined}
        onSelect={() => {}}
        generation={0}
      />,
    );

    await waitFor(() => expect(screen.getByText("Show more")).toBeDefined());
  });

  test("more is not offered once everything is shown", async () => {
    render(
      <ObjectList
        api={listApi([row("1"), row("2")])}
        selected={undefined}
        onSelect={() => {}}
        generation={0}
      />,
    );

    await waitFor(() => expect(screen.getByText("object 2")).toBeDefined());
    expect(screen.queryByText("Show more")).toBeNull();
  });
});

describe("after a scan", () => {
  test("a new generation refetches", async () => {
    // A scan adds objects, and a list holding the previous page would keep
    // showing a library that no longer exists.
    const objectIds = vi.fn(async () => ({ ids: ["1"], total: 1 }));
    const api = {
      objectIds,
      objectSummaries: async () => [row("1")],
    } as unknown as Api;

    const { rerender } = render(
      <ObjectList api={api} selected={undefined} onSelect={() => {}} generation={0} />,
    );
    await waitFor(() => expect(objectIds).toHaveBeenCalledTimes(1));

    rerender(
      <ObjectList api={api} selected={undefined} onSelect={() => {}} generation={1} />,
    );

    await waitFor(() => expect(objectIds).toHaveBeenCalledTimes(2));
  });
});

describe("walking down the tree", () => {
  test("the top level is what nothing contains", async () => {
    // The answer to a flat list of 441: most rows are inside something, and
    // the top is a handful.
    render(
      <ObjectList api={treeApi()} selected={undefined} onSelect={() => {}} generation={0} />,
    );

    await waitFor(() => expect(screen.getByText("Clothing")).toBeDefined());
    expect(screen.queryByText("outfit.zip")).toBeNull();
  });

  test("a folder offers a way in", async () => {
    render(
      <ObjectList api={treeApi()} selected={undefined} onSelect={() => {}} generation={0} />,
    );

    await waitFor(() => expect(screen.getByLabelText("Open")).toBeDefined());
  });

  test("a file offers no way in", async () => {
    render(
      <ObjectList
        api={listApi([row("1", { kind: "file" })])}
        selected={undefined}
        onSelect={() => {}}
        generation={0}
      />,
    );

    await waitFor(() => expect(screen.getByText("object 1")).toBeDefined());
    expect(screen.queryByLabelText("Open")).toBeNull();
  });

  test("opening a folder shows what is inside it", async () => {
    render(
      <ObjectList api={treeApi()} selected={undefined} onSelect={() => {}} generation={0} />,
    );

    await waitFor(() => expect(screen.getByLabelText("Open")).toBeDefined());
    screen.getByLabelText("Open").click();

    await waitFor(() => expect(screen.getByText("outfit.zip")).toBeDefined());
  });

  test("the way back appears once inside", async () => {
    render(
      <ObjectList api={treeApi()} selected={undefined} onSelect={() => {}} generation={0} />,
    );

    // Nothing to go back to at the top.
    await waitFor(() => expect(screen.getByLabelText("Open")).toBeDefined());
    expect(screen.queryByText("Back")).toBeNull();

    screen.getByLabelText("Open").click();
    await waitFor(() => expect(screen.getByText("Back")).toBeDefined());
  });

  test("going back returns to the top", async () => {
    render(
      <ObjectList api={treeApi()} selected={undefined} onSelect={() => {}} generation={0} />,
    );

    await waitFor(() => expect(screen.getByLabelText("Open")).toBeDefined());
    screen.getByLabelText("Open").click();
    await waitFor(() => expect(screen.getByText("Back")).toBeDefined());

    screen.getByText("Back").click();
    await waitFor(() => expect(screen.queryByText("Back")).toBeNull());
    expect(screen.getByText("Clothing")).toBeDefined();
  });

  test("opening a folder is not selecting it", async () => {
    // A person clicking the name wants to see the folder's own page; clicking
    // the chevron wants to go inside. Conflating them makes one of the two
    // impossible.
    const onSelect = vi.fn();
    render(
      <ObjectList api={treeApi()} selected={undefined} onSelect={onSelect} generation={0} />,
    );

    await waitFor(() => expect(screen.getByLabelText("Open")).toBeDefined());
    screen.getByLabelText("Open").click();

    await waitFor(() => expect(screen.getByText("outfit.zip")).toBeDefined());
    expect(onSelect).not.toHaveBeenCalled();
  });
});
