import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Api, Facets, Filter } from "../plugin-host/commands.js";
import type { Manifest } from "../plugin-host/types.js";
import { FilterSidebar } from "./FilterSidebar.js";
import { hasField, hasTerm, NOTHING, toggleField, type Narrowing } from "./filters.js";

const plugins: Manifest[] = [{ id: "vrc", contributes: { facets: ["category", "vendor"], vocabularies: ["avatar"] } }];

const counted: Facets = {
  total: 10,
  properties: [{ property: "vrchat", count: 10 }],
  fields: [
    { field: "category", values: [{ value: "Clothing", count: 6 }, { value: "Hair", count: 3 }, { value: null, count: 1 }] },
    // Nothing holds a vendor yet: a group of one "Not set" row says nothing.
    { field: "vendor", values: [{ value: null, count: 10 }] },
  ],
  vocabularies: [{ vocab: "avatar", terms: [{ id: "airi", label: "Airi", count: 4 }] }],
};

/** The narrowing the sidebar handed up on its nth click. */
function narrowed(calls: readonly (readonly [Narrowing])[], n: number): Narrowing {
  const call = calls[n];
  if (!call) throw new Error(`no click ${n}`);
  return call[0];
}

function show(narrowing: Narrowing = NOTHING, facets: Facets = counted) {
  const objectFacets = vi.fn(async (_filter: Filter, _fields: readonly string[], _vocabularies: readonly string[]) => facets);
  const onNarrow = vi.fn((_narrowing: Narrowing) => undefined);
  const onLabels = vi.fn((_labels: ReadonlyMap<string, string>) => undefined);
  render(
    <FilterSidebar
      api={{ objectFacets } as unknown as Api}
      plugins={plugins}
      narrowing={narrowing}
      onNarrow={onNarrow}
      onLabels={onLabels}
      generation={0}
    />,
  );
  return { objectFacets, onNarrow, onLabels };
}

describe("the groups", () => {
  test("asks for the facets and vocabularies the plugins named", async () => {
    const { objectFacets } = show();
    await screen.findByText("Category");
    expect(objectFacets).toHaveBeenCalledWith({}, ["category", "vendor"], ["avatar"]);
  });

  test("draws each group with its counts, and the unsorted bucket in words", async () => {
    show();
    expect(await screen.findByText("Clothing")).toBeDefined();
    expect(screen.getByText("6")).toBeDefined();
    expect(screen.getByText("Not set")).toBeDefined();
    expect(screen.getByText("Avatar")).toBeDefined();
    expect(screen.getByText("Type")).toBeDefined();
  });

  test("a field nothing holds yet draws no group", async () => {
    show();
    await screen.findByText("Category");
    expect(screen.queryByText("Vendor")).toBeNull();
  });

  test("hands term names up for the chips", async () => {
    const { onLabels } = show();
    await waitFor(() => expect(onLabels).toHaveBeenCalled());
    expect(onLabels.mock.calls[0]?.[0].get("avatar:airi")).toBe("Airi");
  });
});

describe("choosing", () => {
  test("a click adds the value; the shell decides what that means", async () => {
    const { onNarrow } = show();
    fireEvent.click(await screen.findByText("Hair"));
    expect(hasField(narrowed(onNarrow.mock.calls, 0), "category", "Hair")).toBe(true);

    fireEvent.click(screen.getByText("Airi"));
    expect(hasTerm(narrowed(onNarrow.mock.calls, 1), "avatar", "airi")).toBe(true);
  });

  test("the filter is counted against what is chosen", async () => {
    const chosen = toggleField(NOTHING, "category", "Hair");
    const { objectFacets } = show(chosen);
    await screen.findByText("Category");
    expect(objectFacets.mock.calls[0]?.[0]).toMatchObject({ fields: [{ field: "category", value: "Hair" }] });
  });

  test("a choice the counts no longer mention is still there to untick", async () => {
    const chosen = toggleField(NOTHING, "category", "Bases");
    const { onNarrow } = show(chosen);
    fireEvent.click(await screen.findByText("Bases"));
    expect(hasField(narrowed(onNarrow.mock.calls, 0), "category", "Bases")).toBe(false);
  });

  test("a long group is cut short with a way to see the rest", async () => {
    const many: Facets = {
      ...counted,
      fields: [{ field: "category", values: Array.from({ length: 20 }, (_, i) => ({ value: `c${i}`, count: 20 - i })) }],
    };
    show(NOTHING, many);
    await screen.findByText("c0");
    expect(screen.queryByText("c15")).toBeNull();
    fireEvent.click(screen.getByText("Show 12 more"));
    expect(screen.getByText("c15")).toBeDefined();
  });
});
