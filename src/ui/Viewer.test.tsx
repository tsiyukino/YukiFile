import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { Api, FlatObject } from "../plugin-host/commands.js";
import type { Loaded } from "../plugin-host/loader.js";
import type { Mount } from "../plugin-host/slots.js";
import type { Manifest } from "../plugin-host/types.js";
import { Viewer } from "./Viewer.js";

const api = {} as Api;

function object(carries: string[]): FlatObject {
  return { id: "1", shared: {}, regions: [], skipped: [], carries, locations: [] };
}

function loadedWith(id: string, specifier: string, module: unknown): Loaded {
  return { manifest: { id }, modules: new Map([[specifier, module]]), failures: [] };
}

const pdf: Manifest = {
  id: "yukifile.pdf",
  contributes: { properties: ["pdf"], viewers: { pdf: "./viewer" } },
};

const pdfMount: Mount[] = [{ namespace: "pdf", instance: 1 }];

function Reader(): React.JSX.Element {
  return <span>the pdf reader</span>;
}

describe("what gets a viewer", () => {
  test("nothing is drawn for an object no viewer is scoped to", () => {
    // Most objects have no viewer. An empty frame on every one of them would
    // be the extension point leaking into objects it has nothing to say about.
    const { container } = render(
      <Viewer
        api={api}
        object={object(["folder#1"])}
        plugins={[pdf]}
        loaded={[loadedWith("yukifile.pdf", "./viewer", { default: Reader })]}
        mounts={pdfMount}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  test("a viewer draws when the object carries its property", () => {
    render(
      <Viewer
        api={api}
        object={object(["pdf#1"])}
        plugins={[pdf]}
        loaded={[loadedWith("yukifile.pdf", "./viewer", { default: Reader })]}
        mounts={pdfMount}
      />,
    );

    expect(screen.getByText("the pdf reader")).toBeDefined();
  });

  test("a viewer whose module failed names the plugin", () => {
    // The same stance the object page takes: a gap nobody can explain is
    // worse than a sentence saying which plugin is missing.
    render(
      <Viewer
        api={api}
        object={object(["pdf#1"])}
        plugins={[pdf]}
        loaded={[{ manifest: { id: "yukifile.pdf" }, modules: new Map(), failures: [] }]}
        mounts={pdfMount}
      />,
    );

    expect(screen.getByText("yukifile.pdf could not be loaded")).toBeDefined();
  });

  test("a module whose default is not a component is refused", () => {
    render(
      <Viewer
        api={api}
        object={object(["pdf#1"])}
        plugins={[pdf]}
        loaded={[loadedWith("yukifile.pdf", "./viewer", { default: 42 })]}
        mounts={pdfMount}
      />,
    );

    expect(screen.getByText("yukifile.pdf could not be loaded")).toBeDefined();
  });
});

describe("more than one way of looking", () => {
  test("a single viewer offers no choice to make", () => {
    // A picker with one entry is a control that does nothing.
    render(
      <Viewer
        api={api}
        object={object(["pdf#1"])}
        plugins={[pdf]}
        loaded={[loadedWith("yukifile.pdf", "./viewer", { default: Reader })]}
        mounts={pdfMount}
      />,
    );

    expect(screen.queryByText("pdf")).toBeNull();
  });

  test("two viewers are both offered", () => {
    // A PDF that is also a product has two ways of being looked at, and the
    // choice belongs to the person rather than to mount order.
    const product: Manifest = {
      id: "shop.booth",
      contributes: { properties: ["booth"], viewers: { booth: "./viewer" } },
    };

    render(
      <Viewer
        api={api}
        object={object(["pdf#1", "booth#1"])}
        plugins={[pdf, product]}
        loaded={[
          loadedWith("yukifile.pdf", "./viewer", { default: Reader }),
          loadedWith("shop.booth", "./viewer", { default: Reader }),
        ]}
        mounts={[
          { namespace: "pdf", instance: 1 },
          { namespace: "booth", instance: 1 },
        ]}
      />,
    );

    expect(screen.getByText("pdf")).toBeDefined();
    expect(screen.getByText("booth")).toBeDefined();
  });
});

describe("presentation belongs to the host", () => {
  test("the extent can be changed without the plugin knowing", () => {
    // The viewer decision is explicit that a plugin renders into a region and
    // does not know where that region is. The control is the host's.
    render(
      <Viewer
        api={api}
        object={object(["pdf#1"])}
        plugins={[pdf]}
        loaded={[loadedWith("yukifile.pdf", "./viewer", { default: Reader })]}
        mounts={pdfMount}
      />,
    );

    expect(screen.getByText("Fill the window")).toBeDefined();
  });

  test("what a viewer receives says nothing about presentation", () => {
    // If a plugin could read its own extent it would start branching on it,
    // and presentation would stop being the host's decision.
    let received: Record<string, unknown> = {};
    function Spy(props: Record<string, unknown>): React.JSX.Element {
      received = props;
      return <span>drawn</span>;
    }

    render(
      <Viewer
        api={api}
        object={object(["pdf#1"])}
        plugins={[pdf]}
        loaded={[loadedWith("yukifile.pdf", "./viewer", { default: Spy })]}
        mounts={pdfMount}
      />,
    );

    expect(Object.keys(received).sort()).toEqual([
      "api",
      "instance",
      "objectId",
      "property",
    ]);
  });
});
