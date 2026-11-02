import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Api, AppApi } from "../plugin-host/commands.js";
import { SelectionBar, saidOf } from "./Bulk.js";

function world() {
  const api = {
    objectFacets: vi.fn(async () => ({
      total: 3,
      properties: [],
      fields: [{ field: "category", values: [{ value: "Clothing", count: 2 }, { value: "Hair", count: 1 }, { value: null, count: 4 }] }],
      vocabularies: [],
    })),
    termList: vi.fn(async () => [
      { vocab: "avatar", id: "manuka", label: "Manuka" },
      { vocab: "avatar", id: "airi", label: "Airi" },
    ]),
  };
  const app = {
    objectsFieldSet: vi.fn(async () => ({ changed: 2, unchanged: 1 })),
    objectsEdgeAdd: vi.fn(async () => ({ changed: 3, unchanged: 0 })),
    objectsEdgeRemove: vi.fn(async () => ({ changed: 1, unchanged: 2 })),
  };
  const onDone = vi.fn();
  const onClear = vi.fn();
  render(
    <SelectionBar
      api={api as unknown as Api}
      app={app as unknown as AppApi}
      selected={new Set(["1", "2", "3"])}
      detail={{ fields: ["category"], vocabularies: ["avatar"] }}
      onClear={onClear}
      onDone={onDone}
    />,
  );
  return { api, app, onDone, onClear };
}

describe("changing what is selected", () => {
  test("says how many and offers what the plugins filter by", () => {
    world();
    expect(screen.getByText("3 selected")).toBeDefined();
    expect(screen.getByRole("button", { name: "Set category…" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Add avatar…" })).toBeDefined();
  });

  test("sets a field on all of them, offering the values already in use", async () => {
    const { app, onDone } = world();
    fireEvent.click(screen.getByRole("button", { name: "Set category…" }));
    fireEvent.click(await screen.findByText("Hair"));
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    await waitFor(() => expect(app.objectsFieldSet).toHaveBeenCalledWith(["1", "2", "3"], "category", "Hair"));
    expect(onDone).toHaveBeenCalledWith({ tone: "success", title: "Category set to Hair on 2 objects, 1 already so" });
  });

  test("clears a field on all of them", async () => {
    const { app } = world();
    fireEvent.click(screen.getByRole("button", { name: "Set category…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear category" }));
    await waitFor(() => expect(app.objectsFieldSet).toHaveBeenCalledWith(["1", "2", "3"], "category", ""));
  });

  test("adds a term to all of them", async () => {
    const { app, onDone } = world();
    fireEvent.click(screen.getByRole("button", { name: "Add avatar…" }));
    fireEvent.click(await screen.findByText("Manuka"));
    fireEvent.click(screen.getByRole("button", { name: "Add Manuka" }));
    await waitFor(() =>
      expect(app.objectsEdgeAdd).toHaveBeenCalledWith(["1", "2", "3"], "supports", { target: "term", vocab: "avatar", term: "manuka" }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  test("removes a term from all of them", async () => {
    const { app } = world();
    fireEvent.click(screen.getByRole("button", { name: "Remove avatar…" }));
    fireEvent.click(await screen.findByText("Airi"));
    fireEvent.click(screen.getByRole("button", { name: "Remove Airi" }));
    await waitFor(() => expect(app.objectsEdgeRemove).toHaveBeenCalled());
  });

  test("clear lets go of the selection", () => {
    const { onClear } = world();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onClear).toHaveBeenCalled();
  });

  test("a change reads as one line", () => {
    expect(saidOf("Category set to Hair", { changed: 1, unchanged: 0 })).toBe("Category set to Hair on 1 object");
    expect(saidOf("supports Manuka added", { changed: 0, unchanged: 3 })).toBe("Nothing to change: all 3 were already so");
  });
});
