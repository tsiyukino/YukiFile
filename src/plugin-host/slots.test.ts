import { describe, expect, test } from "vitest";

import { actionsFor, columnsFor, panelsFor, viewersFor, type Mount } from "./slots.js";
import type { Manifest } from "./types.js";

/** A plugin defining one property and putting a panel in its region. */
function provider(id: string, property: string): Manifest {
  return {
    id,
    contributes: {
      properties: [property],
      panels: { [property]: `./panels/${property}` },
    },
  };
}

/** Mount order from bare property names, each at instance 1. */
function mounts(...properties: string[]): Mount[] {
  return properties.map((namespace) => ({ namespace, instance: 1 }));
}

describe("visibility", () => {
  test("a contribution appears when the object carries its property", () => {
    const booth = provider("shop.booth", "booth");
    const panels = panelsFor([booth], ["booth#1"], mounts("booth"));

    expect(panels).toEqual([
      { plugin: "shop.booth", property: "booth", instance: 1, value: "./panels/booth" },
    ]);
  });

  test("a contribution stays away when the object does not carry its property", () => {
    // The whole visibility rule, and the same rule for every slot: a Booth
    // panel on a PDF that was never bought anywhere would be an empty region
    // with nothing to put in it.
    const booth = provider("shop.booth", "booth");

    expect(panelsFor([booth], ["pdf#1"], mounts("booth", "pdf"))).toEqual([]);
  });

  test("an unmounted property contributes nothing", () => {
    // An object can carry values written by a plugin this library does not
    // mount. They wait in storage; they do not draw a panel in the meantime.
    const booth = provider("shop.booth", "booth");

    expect(panelsFor([booth], ["booth#1"], mounts("pdf"))).toEqual([]);
  });

  test("a bare property counts as instance 1", () => {
    // The store writes the first instance of a property as `booth#1`, but a
    // caller holding a bare name should not have to know that.
    const booth = provider("shop.booth", "booth");

    expect(panelsFor([booth], ["booth"], mounts("booth"))).toHaveLength(1);
  });
});

describe("instances", () => {
  test("one object carrying a property twice gets a panel for each page", () => {
    // A product sold on Booth under two listings. One panel would silently
    // drop a page the user paid for.
    const booth = provider("shop.booth", "booth");
    const order: Mount[] = [
      { namespace: "booth", instance: 1 },
      { namespace: "booth", instance: 2 },
    ];

    const panels = panelsFor([booth], ["booth#1", "booth#2"], order);

    expect(panels.map((p) => p.instance)).toEqual([1, 2]);
  });

  test("instances follow mount order, not the order the object lists them", () => {
    const booth = provider("shop.booth", "booth");
    const order: Mount[] = [
      { namespace: "booth", instance: 2 },
      { namespace: "booth", instance: 1 },
    ];

    const panels = panelsFor([booth], ["booth#1", "booth#2"], order);

    expect(panels.map((p) => p.instance)).toEqual([2, 1]);
  });

  test("an instance the library does not mount is left out", () => {
    // Mount order ranks instances, not names. A library mounting `booth#1`
    // and not `booth#2` has said something specific, and honouring only half
    // of it would be worse than honouring none.
    const booth = provider("shop.booth", "booth");
    const order: Mount[] = [{ namespace: "booth", instance: 1 }];

    const panels = panelsFor([booth], ["booth#1", "booth#2"], order);

    expect(panels.map((p) => p.instance)).toEqual([1]);
  });

  test("a malformed instance counter is dropped rather than guessed at", () => {
    const booth = provider("shop.booth", "booth");

    for (const bad of ["booth#", "booth#0", "booth#x", "booth#-1", "booth#1.5", "#1"]) {
      expect(panelsFor([booth], [bad], mounts("booth"))).toEqual([]);
    }
  });

  test("a counter that is not the digits it looks like is refused", () => {
    // The case the others miss. `booth#01` and `booth#1.0` both reach a
    // numeric 1, so they would match the mount key for `booth#1` and draw a
    // second panel over the first one — the only malformed shapes that get
    // far enough to do damage rather than being dropped by string comparison
    // on the way.
    const booth = provider("shop.booth", "booth");

    for (const bad of ["booth#01", "booth#1.0", "booth# 1", "booth#+1", "booth#1e0"]) {
      expect(panelsFor([booth], [bad], mounts("booth"))).toEqual([]);
    }
  });

  test("a real instance and a padded one do not both draw", () => {
    // Same object, same page, written two ways. Two panels for one Booth
    // listing is the visible symptom of the check above being gone.
    const booth = provider("shop.booth", "booth");

    expect(panelsFor([booth], ["booth#1", "booth#01"], mounts("booth"))).toHaveLength(1);
  });
});

describe("ordering", () => {
  test("two properties are ordered by mount order, not manifest order", () => {
    // Reusing a decision the user already made, in a place they can see it.
    const booth = provider("shop.booth", "booth");
    const gumroad = provider("shop.gumroad", "gumroad");
    const carried = ["booth#1", "gumroad#1"];

    const boothFirst = panelsFor([booth, gumroad], carried, mounts("booth", "gumroad"));
    const gumroadFirst = panelsFor([booth, gumroad], carried, mounts("gumroad", "booth"));

    expect(boothFirst.map((p) => p.plugin)).toEqual(["shop.booth", "shop.gumroad"]);
    expect(gumroadFirst.map((p) => p.plugin)).toEqual(["shop.gumroad", "shop.booth"]);
  });

  test("manifest order does not decide anything on its own", () => {
    // The same two plugins, listed the other way round, with one mount order.
    // If this ever differs from the test above, ordering has quietly become
    // load order.
    const booth = provider("shop.booth", "booth");
    const gumroad = provider("shop.gumroad", "gumroad");
    const order = mounts("booth", "gumroad");
    const carried = ["booth#1", "gumroad#1"];

    expect(panelsFor([gumroad, booth], carried, order).map((p) => p.plugin)).toEqual(
      panelsFor([booth, gumroad], carried, order).map((p) => p.plugin),
    );
  });

  test("the plugin that defines a property comes before one that requires it", () => {
    // A price comparison sits after the shop it compares: the thing being
    // compared comes first.
    const booth = provider("shop.booth", "booth");
    const compare: Manifest = {
      id: "tools.compare",
      contributes: { panels: { booth: "./panels/Compare" } },
      requires: { properties: ["booth"] },
    };

    const panels = panelsFor([compare, booth], ["booth#1"], mounts("booth"));

    expect(panels.map((p) => p.plugin)).toEqual(["shop.booth", "tools.compare"]);
  });

  test("requiring a property is the ticket into its region", () => {
    // A plugin scoped to neither may not contribute there, even with a panel
    // keyed to it. The Rust side refuses this at parse; nothing downstream
    // should depend on that having happened.
    const stranger: Manifest = {
      id: "tools.stranger",
      contributes: { properties: ["other"], panels: { booth: "./panels/Sneak" } },
    };

    expect(panelsFor([stranger], ["booth#1"], mounts("booth"))).toEqual([]);
  });
});

describe("slots", () => {
  test("actions appear with no panel anywhere in sight", () => {
    // Actions are independent of layout on purpose: a plugin owning an
    // object's whole page cannot strand another plugin's actions.
    const vrc: Manifest = {
      id: "yukifile.vrc",
      contributes: { properties: ["vrchat"], actions: { vrchat: ["export-to-unity"] } },
    };

    const actions = actionsFor([vrc], ["vrchat#1"], mounts("vrchat"));

    expect(actions.map((a) => a.value)).toEqual(["export-to-unity"]);
    expect(panelsFor([vrc], ["vrchat#1"], mounts("vrchat"))).toEqual([]);
  });

  test("one property can offer several actions, in declared order", () => {
    const booth: Manifest = {
      id: "shop.booth",
      contributes: { properties: ["booth"], actions: { booth: ["fetch", "open-page"] } },
    };

    const actions = actionsFor([booth], ["booth#1"], mounts("booth"));

    expect(actions.map((a) => a.value)).toEqual(["fetch", "open-page"]);
  });

  test("viewers are collected without one being chosen", () => {
    // A PDF that is also a product has two ways of being looked at. Picking
    // for the user is what the ownership decision says not to do.
    const pdf: Manifest = {
      id: "yukifile.pdf",
      contributes: { properties: ["pdf"], viewers: { pdf: "./viewers/Pdf" } },
    };
    const vrc: Manifest = {
      id: "yukifile.vrc",
      contributes: { properties: ["vrchat"], viewers: { vrchat: "./viewers/Asset" } },
    };

    const viewers = viewersFor([pdf, vrc], ["pdf#1", "vrchat#1"], mounts("pdf", "vrchat"));

    expect(viewers.map((v) => v.value)).toEqual(["./viewers/Pdf", "./viewers/Asset"]);
  });

  test("a grid header offers a column once for many objects carrying it", () => {
    const booth: Manifest = {
      id: "shop.booth",
      contributes: { properties: ["booth"], columns: { booth: ["price"] } },
    };

    // The union of what a page of objects carries, as the grid would pass it.
    const union = ["booth#1", "booth#1", "booth#1"];

    expect(columnsFor([booth], union, mounts("booth")).map((c) => c.value)).toEqual([
      "price",
    ]);
  });

  test("a second instance is a second column, not a duplicate", () => {
    // Two Booth listings on one object are two prices. Collapsing them would
    // hide the one the user is not currently looking at.
    const booth: Manifest = {
      id: "shop.booth",
      contributes: { properties: ["booth"], columns: { booth: ["price"] } },
    };
    const order: Mount[] = [
      { namespace: "booth", instance: 1 },
      { namespace: "booth", instance: 2 },
    ];

    const columns = columnsFor([booth], ["booth#1", "booth#2"], order);

    expect(columns.map((c) => c.instance)).toEqual([1, 2]);
  });

  test("a slot a plugin says nothing about produces nothing", () => {
    const booth = provider("shop.booth", "booth");

    expect(viewersFor([booth], ["booth#1"], mounts("booth"))).toEqual([]);
    expect(actionsFor([booth], ["booth#1"], mounts("booth"))).toEqual([]);
    expect(columnsFor([booth], ["booth#1"], mounts("booth"))).toEqual([]);
  });
});

describe("nothing to show", () => {
  test("no plugins, no contributions", () => {
    expect(panelsFor([], ["booth#1"], mounts("booth"))).toEqual([]);
  });

  test("an object carrying nothing has nothing rendered on it", () => {
    const booth = provider("shop.booth", "booth");

    expect(panelsFor([booth], [], mounts("booth"))).toEqual([]);
  });

  test("a manifest contributing nothing at all is not an error", () => {
    // `contributes` is optional in the JSON, and a plugin that only requires
    // things is a real shape.
    const empty: Manifest = { id: "tools.empty" };

    expect(panelsFor([empty], ["booth#1"], mounts("booth"))).toEqual([]);
  });
});
