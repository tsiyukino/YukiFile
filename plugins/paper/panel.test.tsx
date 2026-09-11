import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Api, FlatObject } from "../../src/plugin-host/commands.js";
import PaperPanel from "./panel.js";

/** An object whose `paper` region holds the given fields. */
function object(fields: Record<string, string>): FlatObject {
  return {
    id: "1",
    shared: {},
    regions: [{ property: "paper", instance: 1, fields }],
    skipped: [],
    carries: ["paper#1"],
    locations: [],
  };
}

/** The panel, rendered against an api that returns the given object. */
function show(objectFlat: () => Promise<FlatObject>) {
  return render(
    <PaperPanel
      api={{ objectFlat } as unknown as Api}
      objectId="1"
      property="paper"
      instance={1}
    />,
  );
}

describe("what a paper says on a page", () => {
  test("the DOI, as a link that resolves", async () => {
    // A DOI's whole purpose is to resolve; retyping one into a browser is what
    // it exists to avoid.
    show(async () => object({ doi: "10.1000/example" }));

    const link = await screen.findByRole("link", { name: "10.1000/example" });
    expect(link.getAttribute("href")).toBe("https://doi.org/10.1000/example");
  });

  test("a paper recorded without one says so", async () => {
    // Still a paper. The blank is what says the field is waiting.
    show(async () => object({}));

    expect(await screen.findByText("No DOI recorded.")).toBeDefined();
  });

  test("a region for another instance is not read", async () => {
    // An object carrying `paper#1` and `paper#2` gets a panel each, and each
    // has to draw its own.
    render(
      <PaperPanel
        api={{ objectFlat: async () => object({ doi: "10.1000/first" }) } as unknown as Api}
        objectId="1"
        property="paper"
        instance={2}
      />,
    );

    expect(await screen.findByText("No DOI recorded.")).toBeDefined();
  });

  test("a read that fails leaves the panel quiet", async () => {
    // The object page already reports what it could not read. A panel saying
    // so a second time is two messages about one failure.
    show(async () => {
      throw { kind: "no_such_object" };
    });

    expect(await screen.findByText("No DOI recorded.")).toBeDefined();
  });

  test("the object is read once while nothing it depends on changes", async () => {
    // `api` is in the effect's dependencies, which is what every other panel
    // does and is right for the app: it hands over a module-level constant
    // whose identity never moves. Holding the same object here is what makes
    // this a test of the effect rather than of a literal being rebuilt.
    const objectFlat = vi.fn(async () => object({ doi: "10.1000/x" }));
    const api = { objectFlat } as unknown as Api;
    const panel = (
      <PaperPanel api={api} objectId="1" property="paper" instance={1} />
    );

    const { rerender } = render(panel);
    await screen.findByRole("link", { name: "10.1000/x" });
    rerender(panel);

    await waitFor(() => expect(objectFlat).toHaveBeenCalledTimes(1));
  });
});
