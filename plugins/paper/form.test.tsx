import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Api } from "../../src/plugin-host/commands.js";
import type { FormPath, FormResult } from "../../src/plugin-host/panel.js";
import PaperForm from "./form.js";

/** The form, rendered with the props the host would pass. */
function show(options: {
  paths?: readonly FormPath[];
  initial?: Record<string, string>;
  onDone?: (result: FormResult) => void;
}) {
  return render(
    <PaperForm
      api={{} as Api}
      property="paper"
      paths={options.paths ?? []}
      initial={options.initial ?? {}}
      onDone={options.onDone ?? (() => undefined)}
    />,
  );
}

/** The title field, by its label. */
function titleBox(): HTMLInputElement {
  return screen.getByLabelText("Title") as HTMLInputElement;
}

function doiBox(): HTMLInputElement {
  return screen.getByLabelText("DOI") as HTMLInputElement;
}

/** Replace a field's contents, the way a controlled input sees it. */
function type(box: HTMLInputElement, value: string): void {
  fireEvent.change(box, { target: { value } });
}

function next(): void {
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
}

describe("what the form starts with", () => {
  test("the filename, when there is one", () => {
    // What the person already calls the thing. Starting blank makes them
    // retype what is on screen next to them.
    show({ paths: [{ path: "papers/Attention_is_all_you_need.pdf", kind: "file" }] });

    expect(titleBox().value).toBe("Attention is all you need");
  });

  test("nothing, for a grouping with no path", () => {
    show({ paths: [] });

    expect(titleBox().value).toBe("");
  });

  test("what was typed last time, over the filename", () => {
    // Going back a step and forward again must not throw away typing.
    show({
      paths: [{ path: "thesis.pdf", kind: "file" }],
      initial: { title: "A better title", doi: "10.1000/x" },
    });

    expect(titleBox().value).toBe("A better title");
    expect(doiBox().value).toBe("10.1000/x");
  });
});

describe("what it hands over", () => {
  test("both fields, normalised", () => {
    const onDone = vi.fn();
    show({ onDone });

    type(titleBox(), "A paper");
    type(doiBox(), "https://doi.org/10.1000/Example");
    next();

    expect(onDone).toHaveBeenCalledWith({
      ok: true,
      values: { title: "A paper", doi: "10.1000/Example" },
    });
  });

  test("nothing at all, when nothing was filled in", () => {
    // Allowed: the property was still chosen, and `store::carried` keeps that
    // decision whether or not it has values.
    const onDone = vi.fn();
    show({ onDone });

    next();

    expect(onDone).toHaveBeenCalledWith({ ok: true, values: {} });
  });

  test("no key at all for a field left empty", () => {
    const onDone = vi.fn();
    show({ onDone });

    type(titleBox(), "A paper");
    next();

    const result = onDone.mock.calls[0]?.[0] as { values: Record<string, string> };
    expect(Object.keys(result.values)).toEqual(["title"]);
  });
});

describe("a DOI that will not parse", () => {
  test("stops the step and says so", () => {
    // Refused rather than dropped: somebody who typed one and got an object
    // without it would have no idea why.
    const onDone = vi.fn();
    show({ onDone });

    type(doiBox(), "not a doi");
    next();

    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByText(/is not a DOI/)).toBeDefined();
  });

  test("the complaint goes when it is corrected", () => {
    const onDone = vi.fn();
    show({ onDone });

    type(doiBox(), "nonsense");
    next();
    type(doiBox(), "10.1000/x");
    next();

    expect(onDone).toHaveBeenCalledWith({ ok: true, values: { doi: "10.1000/x" } });
    expect(screen.queryByText(/is not a DOI/)).toBeNull();
  });
});
