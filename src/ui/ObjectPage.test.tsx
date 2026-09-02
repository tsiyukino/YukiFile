import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { Api, FlatObject } from "../plugin-host/commands.js";
import type { Loaded } from "../plugin-host/loader.js";
import type { Mount } from "../plugin-host/slots.js";
import type { Manifest } from "../plugin-host/types.js";
import { instanceCounts, ObjectPage, panelsIn } from "./ObjectPage.js";

/** An api that answers nothing; these tests never let a panel call one. */
const api = {} as Api;

function flat(over: Partial<FlatObject> = {}): FlatObject {
  return { id: 1, shared: {}, regions: [], skipped: [], ...over };
}

function loadedWith(id: string, specifier: string, module: unknown): Loaded {
  return {
    manifest: { id },
    modules: new Map([[specifier, module]]),
    failures: [],
  };
}

const boothManifest: Manifest = {
  id: "shop.booth",
  contributes: { properties: ["booth"], panels: { booth: "./panel" } },
};

const boothMount: Mount[] = [{ namespace: "booth", instance: 1 }];

describe("an object with nothing", () => {
  test("still draws a page rather than failing", () => {
    render(
      <ObjectPage api={api} object={flat()} plugins={[]} loaded={[]} mounts={[]} />,
    );

    expect(screen.getByText("Nothing recorded yet")).toBeDefined();
  });

  test("an object with no title says so without treating it as an error", () => {
    // A scan finds files before anybody names them. That is the normal state
    // of a fresh library, not a problem to flag.
    render(
      <ObjectPage
        api={api}
        object={flat({ shared: { note: [{ value: "bought the fullset", from: null }] } })}
        plugins={[]}
        loaded={[]}
        mounts={[]}
      />,
    );

    expect(screen.getByText("Untitled")).toBeDefined();
    expect(screen.queryByText("Nothing recorded yet")).toBeNull();
  });

  test("nothing loaded yet shows that it is loading", () => {
    render(
      <ObjectPage api={api} object={undefined} plugins={[]} loaded={[]} mounts={[]} />,
    );

    expect(screen.getByLabelText("Loading the object")).toBeDefined();
  });
});

describe("shared fields", () => {
  test("one source is shown plainly", () => {
    render(
      <ObjectPage
        api={api}
        object={flat({ shared: { title: [{ value: "BE NATURAL", from: null }] } })}
        plugins={[]}
        loaded={[]}
        mounts={[]}
      />,
    );

    expect(screen.getByText("BE NATURAL")).toBeDefined();
  });

  test("several sources all reach the page, attributed", () => {
    // A product on two shops has three titles and all three are true. The
    // architecture says reading returns sources rather than a winner; if the
    // page showed only the first, the model would be invisible exactly where
    // somebody needs it.
    render(
      <ObjectPage
        api={api}
        object={flat({
          shared: {
            title: [
              { value: "mine", from: null },
              { value: "from booth", from: "booth#1" },
              { value: "from gumroad", from: "gumroad#1" },
            ],
          },
        })}
        plugins={[]}
        loaded={[]}
        mounts={[]}
      />,
    );

    expect(screen.getByText("and 2 other sources")).toBeDefined();
    expect(screen.getByText("from booth")).toBeDefined();
    expect(screen.getByText("booth#1")).toBeDefined();
    expect(screen.getByText("entered here")).toBeDefined();
  });
});

describe("regions", () => {
  test("a region shows the fields its plugin keeps to itself", () => {
    render(
      <ObjectPage
        api={api}
        object={flat({
          regions: [
            { property: "booth", instance: 1, fields: { item_id: "8264237" } },
          ],
        })}
        plugins={[]}
        loaded={[]}
        mounts={boothMount}
      />,
    );

    expect(screen.getByText("item_id: 8264237")).toBeDefined();
  });

  test("regions are drawn in the order the object gives them", () => {
    // Which is mount order: the bridge sorts before it serialises, and the
    // page does not re-derive an order somebody already decided.
    render(
      <ObjectPage
        api={api}
        object={flat({
          regions: [
            { property: "booth", instance: 1, fields: {} },
            { property: "gumroad", instance: 1, fields: {} },
          ],
        })}
        plugins={[]}
        loaded={[]}
        mounts={[]}
      />,
    );

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(["booth", "gumroad"]);
  });

  test("one instance is named without a number", () => {
    render(
      <ObjectPage
        api={api}
        object={flat({ regions: [{ property: "booth", instance: 1, fields: {} }] })}
        plugins={[]}
        loaded={[]}
        mounts={[]}
      />,
    );

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("booth");
  });

  test("two instances of one property are both numbered", () => {
    // Numbering one and not the other would be worse than numbering neither:
    // the reader cannot tell which listing "booth" refers to.
    render(
      <ObjectPage
        api={api}
        object={flat({
          regions: [
            { property: "booth", instance: 1, fields: {} },
            { property: "booth", instance: 2, fields: {} },
          ],
        })}
        plugins={[]}
        loaded={[]}
        mounts={[]}
      />,
    );

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(["booth #1", "booth #2"]);
  });
});

describe("panels", () => {
  test("a plugin's panel renders inside its property's region", () => {
    function Panel(): React.JSX.Element {
      return <span>the booth panel</span>;
    }

    render(
      <ObjectPage
        api={api}
        object={flat({ regions: [{ property: "booth", instance: 1, fields: {} }] })}
        plugins={[boothManifest]}
        loaded={[loadedWith("shop.booth", "./panel", { default: Panel })]}
        mounts={boothMount}
      />,
    );

    expect(screen.getByText("the booth panel")).toBeDefined();
  });

  test("a panel is told which instance it is drawing", () => {
    // An object with two Booth listings gets two panels, and each has to know
    // which one it is showing or both render the same thing.
    function Panel({ instance }: { instance: number }): React.JSX.Element {
      return <span>listing {instance}</span>;
    }

    render(
      <ObjectPage
        api={api}
        object={flat({
          regions: [
            { property: "booth", instance: 1, fields: {} },
            { property: "booth", instance: 2, fields: {} },
          ],
        })}
        plugins={[boothManifest]}
        loaded={[loadedWith("shop.booth", "./panel", { default: Panel })]}
        mounts={[
          { namespace: "booth", instance: 1 },
          { namespace: "booth", instance: 2 },
        ]}
      />,
    );

    expect(screen.getByText("listing 1")).toBeDefined();
    expect(screen.getByText("listing 2")).toBeDefined();
  });

  test("a module that failed to load leaves the rest of the page standing", () => {
    // The whole point of loader.ts reporting failures rather than throwing.
    // Until this test, nothing consumed that decision.
    render(
      <ObjectPage
        api={api}
        object={flat({
          shared: { title: [{ value: "still here", from: null }] },
          regions: [{ property: "booth", instance: 1, fields: {} }],
        })}
        plugins={[boothManifest]}
        loaded={[
          { manifest: { id: "shop.booth" }, modules: new Map(), failures: [] },
        ]}
        mounts={boothMount}
      />,
    );

    expect(screen.getByText("shop.booth could not be loaded")).toBeDefined();
    expect(screen.getByText("still here")).toBeDefined();
  });

  test("a module whose default is not a component is refused, not rendered", () => {
    // A plugin is external code. Letting React throw on a number would take
    // the object page down over one bad plugin.
    render(
      <ObjectPage
        api={api}
        object={flat({ regions: [{ property: "booth", instance: 1, fields: {} }] })}
        plugins={[boothManifest]}
        loaded={[loadedWith("shop.booth", "./panel", { default: 42 })]}
        mounts={boothMount}
      />,
    );

    expect(screen.getByText("shop.booth could not be loaded")).toBeDefined();
  });

  test("a panel whose property the object does not carry never appears", () => {
    function Panel(): React.JSX.Element {
      return <span>should not be here</span>;
    }

    render(
      <ObjectPage
        api={api}
        object={flat({ regions: [{ property: "pdf", instance: 1, fields: {} }] })}
        plugins={[boothManifest]}
        loaded={[loadedWith("shop.booth", "./panel", { default: Panel })]}
        mounts={[{ namespace: "pdf", instance: 1 }]}
      />,
    );

    expect(screen.queryByText("should not be here")).toBeNull();
  });
});

describe("values that could not be placed", () => {
  test("a defect is shown", () => {
    // Only defects reach the page; values under an uninstalled plugin were
    // filtered out in the bridge, so anything here is worth interrupting for.
    render(
      <ObjectPage
        api={api}
        object={flat({
          skipped: [{ path: "42//title", reason: "malformed path: empty segment" }],
        })}
        plugins={[]}
        loaded={[]}
        mounts={[]}
      />,
    );

    expect(screen.getByText(/malformed path/)).toBeDefined();
  });
});

describe("the pure parts", () => {
  test("instances of one property are counted", () => {
    const counts = instanceCounts([
      { property: "booth", instance: 1, fields: {} },
      { property: "booth", instance: 2, fields: {} },
      { property: "pdf", instance: 1, fields: {} },
    ]);

    expect(counts.get("booth")).toBe(2);
    expect(counts.get("pdf")).toBe(1);
  });

  test("a contribution for another instance stays out of this region", () => {
    const region = { property: "booth", instance: 1, fields: {} };
    const contributions = [
      { plugin: "a", property: "booth", instance: 1, value: "./panel" },
      { plugin: "b", property: "booth", instance: 2, value: "./panel" },
    ];

    expect(panelsIn(region, contributions, []).map((p) => p.plugin)).toEqual(["a"]);
  });

  test("a contribution from a plugin that loaded nothing carries no component", () => {
    const region = { property: "booth", instance: 1, fields: {} };
    const contributions = [
      { plugin: "shop.booth", property: "booth", instance: 1, value: "./panel" },
    ];

    const resolved = panelsIn(region, contributions, []);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.component).toBeUndefined();
  });
});
