import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Api, AppApi, NewObject } from "../plugin-host/commands.js";
import type { Loaded } from "../plugin-host/loader.js";
import type { FormProps } from "../plugin-host/panel.js";
import type { Manifest } from "../plugin-host/types.js";
import { AddObject } from "./AddObject.js";

const at = { path: "Papers/solubility.pdf", kind: "file" as const };

/** A form that returns whatever its property is called, plus what it got. */
function EchoForm({ property, initial, onDone }: FormProps): React.JSX.Element {
  return (
    <div>
      <span>form for {property}</span>
      <span>initial {JSON.stringify(initial)}</span>
      <button onClick={() => onDone({ ok: true, values: { note: `from ${property}` } })}>
        Done {property}
      </button>
      <button onClick={() => onDone({ ok: false, problem: `${property} refused` })}>
        Refuse {property}
      </button>
    </div>
  );
}

/** A plugin declaring one semantic property with a form. */
function plugin(property: string, form: unknown = { default: EchoForm }): { manifest: Manifest; loaded: Loaded } {
  const manifest: Manifest = {
    id: `test.${property}`,
    contributes: { properties: [property], forms: { [property]: "./form" } },
  };
  return {
    manifest,
    loaded: { manifest, modules: new Map([["./form", form]]), failures: [] },
  };
}

function show(
  declared: Array<{ manifest: Manifest; loaded: Loaded }>,
  over: {
    objectCreate?: (object: NewObject) => Promise<string>;
    onAdded?: (id: string) => void;
    onCancel?: () => void;
  } = {},
): { objectCreate: ReturnType<typeof vi.fn> } {
  const objectCreate = vi.fn(over.objectCreate ?? (async () => "99"));
  render(
    <AddObject
      api={{} as Api}
      app={{ objectCreate } as unknown as AppApi}
      at={at}
      plugins={declared.map((d) => d.manifest)}
      loaded={declared.map((d) => d.loaded)}
      mounts={[]}
      onAdded={over.onAdded ?? (() => undefined)}
      onCancel={over.onCancel ?? (() => undefined)}
    />,
  );
  return { objectCreate };
}

function press(name: string): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("choosing what a thing is", () => {
  test("the path is shown so the person knows what they are naming", () => {
    show([plugin("paper")]);

    expect(screen.getByText("Add solubility.pdf")).toBeDefined();
    expect(screen.getByText("Papers/solubility.pdf")).toBeDefined();
  });

  test("with nothing to choose, the object is added as it is on disk", async () => {
    // A library with no semantic plugin can still be filled by hand. The
    // picker says so rather than showing an empty list.
    const onAdded = vi.fn();
    const { objectCreate } = show([], { onAdded });

    expect(screen.getByText(/No installed plugin offers a type/)).toBeDefined();
    press("Add");

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith("99"));
    expect(objectCreate).toHaveBeenCalledWith({ paths: [at], properties: [], values: {} });
  });

  test("choosing nothing is allowed even when something was offered", async () => {
    const { objectCreate } = show([plugin("paper")]);

    press("Add");

    await waitFor(() => expect(objectCreate).toHaveBeenCalled());
    expect(objectCreate.mock.calls[0]?.[0]).toMatchObject({ properties: [] });
  });

  test("a dotted property reads as its last segment, within the rest", () => {
    show([plugin("vrchat.booth")]);

    expect(screen.getByLabelText("booth")).toBeDefined();
    expect(screen.getByText("within vrchat")).toBeDefined();
  });
});

describe("the forms", () => {
  test("choosing a property brings its form up next", async () => {
    show([plugin("paper")]);

    fireEvent.click(screen.getByLabelText("paper"));
    press("Next");

    expect(await screen.findByText("form for paper")).toBeDefined();
    expect(screen.getByText("paper · step 1 of 1")).toBeDefined();
  });

  test("what a form returns lands under its property", async () => {
    const { objectCreate } = show([plugin("paper")]);

    fireEvent.click(screen.getByLabelText("paper"));
    press("Next");
    await screen.findByText("form for paper");
    press("Done paper");

    await waitFor(() => expect(objectCreate).toHaveBeenCalled());
    expect(objectCreate).toHaveBeenCalledWith({
      paths: [at],
      properties: ["paper"],
      values: { paper: { note: "from paper" } },
    });
  });

  test("two chosen properties get two forms, and both answers are kept", async () => {
    const { objectCreate } = show([plugin("paper"), plugin("dataset")]);

    fireEvent.click(screen.getByLabelText("paper"));
    fireEvent.click(screen.getByLabelText("dataset"));
    press("Next");

    // Neither is mounted, so they come in the order chosen.
    await screen.findByText("paper · step 1 of 2");
    press("Done paper");
    await screen.findByText("dataset · step 2 of 2");
    press("Done dataset");

    await waitFor(() => expect(objectCreate).toHaveBeenCalled());
    expect(objectCreate.mock.calls[0]?.[0]).toMatchObject({
      properties: ["paper", "dataset"],
      values: { paper: { note: "from paper" }, dataset: { note: "from dataset" } },
    });
  });

  test("going back keeps what was typed", async () => {
    // `FormProps.initial` exists for this. Losing a DOI because somebody went
    // back to tick a second box is how people learn to cancel instead.
    show([plugin("paper"), plugin("dataset")]);

    fireEvent.click(screen.getByLabelText("paper"));
    fireEvent.click(screen.getByLabelText("dataset"));
    press("Next");
    await screen.findByText("form for paper");
    press("Done paper");
    await screen.findByText("form for dataset");
    press("Back");

    expect(await screen.findByText("form for paper")).toBeDefined();
    expect(screen.getByText('initial {"note":"from paper"}')).toBeDefined();
  });

  test("a form that refuses stops the step rather than vanishing", async () => {
    const { objectCreate } = show([plugin("paper")]);

    fireEvent.click(screen.getByLabelText("paper"));
    press("Next");
    await screen.findByText("form for paper");
    press("Refuse paper");

    expect(await screen.findByText("paper refused")).toBeDefined();
    expect(objectCreate).not.toHaveBeenCalled();
  });

  test("a form that did not load does not lose the property", async () => {
    // The module is a number, say. The choice was still made, and
    // `store::carried` keeps it with no values; the page says what is missing.
    const { objectCreate } = show([plugin("paper", 42)]);

    fireEvent.click(screen.getByLabelText("paper"));
    press("Next");

    expect(await screen.findByText(/test\.paper's form did not load/)).toBeDefined();
    press("Continue without it");

    await waitFor(() => expect(objectCreate).toHaveBeenCalled());
    expect(objectCreate.mock.calls[0]?.[0]).toMatchObject({ properties: ["paper"], values: {} });
  });
});

describe("when the core refuses", () => {
  test("a taken path is said in words the person can act on", async () => {
    // Between the walk and the click, something else recorded it. "the core
    // refused: path_taken" is true and useless.
    show([], {
      objectCreate: async () => {
        throw { kind: "path_taken", detail: "Papers/solubility.pdf" };
      },
    });

    press("Add");

    expect(
      await screen.findByText("another object already sits at Papers/solubility.pdf"),
    ).toBeDefined();
    // Still here, so the person can cancel or try again.
    expect(screen.getByRole("button", { name: "Add" })).toBeDefined();
  });
});

describe("cancelling", () => {
  test("from the picker", () => {
    const onCancel = vi.fn();
    const { objectCreate } = show([plugin("paper")], { onCancel });

    press("Cancel");

    expect(onCancel).toHaveBeenCalled();
    expect(objectCreate).not.toHaveBeenCalled();
  });

  test("from a form discards everything", async () => {
    const onCancel = vi.fn();
    const { objectCreate } = show([plugin("paper")], { onCancel });

    fireEvent.click(screen.getByLabelText("paper"));
    press("Next");
    await screen.findByText("form for paper");
    press("Cancel");

    expect(onCancel).toHaveBeenCalled();
    expect(objectCreate).not.toHaveBeenCalled();
  });
});
