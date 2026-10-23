import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Api, AppApi, Edge, FlatObject } from "../plugin-host/commands.js";
import type { Manifest } from "../plugin-host/types.js";
import { ObjectEditor } from "./ObjectEditor.js";

const plugins: Manifest[] = [
  { id: "x.pdf", contributes: { properties: ["pdf"], file_types: { pdf: ["pdf"] } } },
  { id: "x.vrc", contributes: { properties: ["vrchat", "paper"], vocabularies: ["avatar"] } },
];

function object(over: Partial<FlatObject> = {}): FlatObject {
  return {
    id: "1",
    shared: {},
    regions: [],
    skipped: [],
    carries: ["pdf#1", "paper#1"],
    locations: [{ path: "Papers/a.pdf", kind: "file", size: 10 }],
    ...over,
  };
}

function world(edges: Edge[] = []) {
  const api = {
    objectEdges: vi.fn(async () => edges),
    objectSummaries: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, name: `object ${id}`, path: null, kind: null })),
    ),
    pathList: vi.fn(async () => [{ path: "Clothing/outfit.zip", object: "7" }]),
    termList: vi.fn(async () => [{ vocab: "avatar", id: "manuka", label: "Manuka" }]),
    termVocabularies: vi.fn(async () => ["avatar"]),
  };
  const app = {
    objectPropertyAdd: vi.fn(async () => undefined),
    objectPropertyRemove: vi.fn(async () => undefined),
    objectEdgeAdd: vi.fn(async () => undefined),
    objectEdgeRemove: vi.fn(async () => undefined),
    objectPathAdd: vi.fn(async () => undefined),
    objectPathRemove: vi.fn(async () => undefined),
  };
  const onChanged = vi.fn();
  return { api: api as unknown as Api, app: app as unknown as AppApi, calls: { api, app }, onChanged };
}

function show(w: ReturnType<typeof world>, over: Partial<FlatObject> = {}) {
  return render(
    <ObjectEditor api={w.api} app={w.app} object={object(over)} plugins={plugins} onChanged={w.onChanged} />,
  );
}

describe("what it is", () => {
  test("a chosen property can be taken off; a factual one cannot", async () => {
    const w = world();
    show(w);

    expect(screen.getByRole("button", { name: "Remove paper" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Remove pdf" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove paper" }));
    await waitFor(() => expect(w.calls.app.objectPropertyRemove).toHaveBeenCalledWith("1", "paper"));
    expect(w.onChanged).toHaveBeenCalled();
  });

  test("the properties not carried are offered", async () => {
    const w = world();
    show(w);

    // vrchat is the one semantic property this object does not carry.
    fireEvent.click(screen.getByRole("button", { name: "Add property" }));

    await waitFor(() => expect(w.calls.app.objectPropertyAdd).toHaveBeenCalledWith("1", "vrchat"));
  });
});

describe("what it points at", () => {
  test("edges are listed in words, and one can be removed as it was read", async () => {
    const edge: Edge = { kind: "supports", target: "term", vocab: "avatar", term: "manuka" };
    const w = world([edge]);
    show(w);

    expect(await screen.findByText("avatar: Manuka")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Remove supports avatar: Manuka" }));

    // The target goes back in the shape it arrived, kind included.
    await waitFor(() => expect(w.calls.app.objectEdgeRemove).toHaveBeenCalledWith("1", "supports", edge));
  });

  test("an edge to a term is added from the vocabulary", async () => {
    const w = world();
    show(w);

    await screen.findByText("Nothing yet.");
    fireEvent.change(screen.getByLabelText("Term"), { target: { value: "manuka" } });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));

    await waitFor(() =>
      expect(w.calls.app.objectEdgeAdd).toHaveBeenCalledWith("1", "supports", {
        target: "term",
        vocab: "avatar",
        term: "manuka",
      }),
    );
  });

  test("an edge to an object is added by its path, resolved locally", async () => {
    // The person types where the thing sits, which they know; the id, which
    // they do not, comes from path.list.
    const w = world();
    show(w);

    await screen.findByText("Nothing yet.");
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "contains" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "object" } });
    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "Clothing/outfit.zip" } });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));

    await waitFor(() =>
      expect(w.calls.app.objectEdgeAdd).toHaveBeenCalledWith("1", "contains", { target: "object", id: "7" }),
    );
  });

  test("a path nothing is recorded at is said, not sent", async () => {
    const w = world();
    show(w);

    await screen.findByText("Nothing yet.");
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "object" } });
    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "nowhere.zip" } });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));

    expect(await screen.findByText('nothing is recorded at "nowhere.zip"')).toBeDefined();
    expect(w.calls.app.objectEdgeAdd).not.toHaveBeenCalled();
  });
});

describe("where it sits", () => {
  test("a location can be taken away", async () => {
    const w = world();
    show(w);

    fireEvent.click(screen.getByRole("button", { name: "Remove Papers/a.pdf" }));

    await waitFor(() => expect(w.calls.app.objectPathRemove).toHaveBeenCalledWith("1", "Papers/a.pdf"));
  });

  test("another location is added with its kind", async () => {
    const w = world();
    show(w);

    fireEvent.change(screen.getByLabelText("Also at"), { target: { value: "Papers/a" } });
    fireEvent.change(screen.getByLabelText("Which is a"), { target: { value: "folder" } });
    fireEvent.click(screen.getByRole("button", { name: "Add location" }));

    await waitFor(() =>
      expect(w.calls.app.objectPathAdd).toHaveBeenCalledWith("1", { path: "Papers/a", kind: "folder" }),
    );
  });

  test("a grouping says it sits nowhere", () => {
    const w = world();
    show(w, { locations: [] });

    expect(screen.getByText("Nowhere: this is a grouping.")).toBeDefined();
  });

  test("a refusal from the core is shown", async () => {
    const w = world();
    (w.calls.app.objectPathAdd as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw { kind: "path_taken", detail: "Papers/a" };
    });
    show(w);

    fireEvent.change(screen.getByLabelText("Also at"), { target: { value: "Papers/a" } });
    fireEvent.click(screen.getByRole("button", { name: "Add location" }));

    expect(await screen.findByText("another object already sits at Papers/a")).toBeDefined();
    expect(w.onChanged).not.toHaveBeenCalled();
  });
});
