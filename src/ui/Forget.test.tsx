import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { AppApi } from "../plugin-host/commands.js";
import { ForgetButton } from "./Forget.js";

function show(objectForget: AppApi["objectForget"], onForgotten = () => undefined) {
  return render(
    <ForgetButton
      app={{ objectForget } as unknown as AppApi}
      object="42"
      name="outfit.zip"
      onForgotten={onForgotten}
    />,
  );
}

/**
 * The dialog's own confirm button, not the one that opened it.
 *
 * The dialog renders through a portal that sits before the button in the
 * document, so "the last Forget button" is the trigger, and clicking it
 * re-opens a dialog that is already open.
 */
function confirm(): void {
  const dialog = screen.getByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Forget" }));
}

describe("forgetting an object", () => {
  test("pressing the button asks first and forgets nothing", () => {
    // What is forgotten is every value the object carried. One click is not
    // enough to lose that.
    const objectForget = vi.fn(async () => undefined);
    show(objectForget);

    fireEvent.click(screen.getByRole("button", { name: "Forget" }));

    expect(screen.getByText("Forget outfit.zip?")).toBeDefined();
    expect(objectForget).not.toHaveBeenCalled();
  });

  test("confirming forgets the object and says so", async () => {
    const objectForget = vi.fn(async () => undefined);
    const onForgotten = vi.fn();
    show(objectForget, onForgotten);

    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    confirm();

    await waitFor(() => expect(onForgotten).toHaveBeenCalled());
    expect(objectForget).toHaveBeenCalledWith("42");
  });

  test("cancelling leaves the object alone", () => {
    const objectForget = vi.fn(async () => undefined);
    show(objectForget);

    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(objectForget).not.toHaveBeenCalled();
    expect(screen.queryByText("Forget outfit.zip?")).toBeNull();
  });

  test("a refusal is shown rather than swallowed", async () => {
    // Forgetting something already gone, say. The person should read that,
    // not watch a button stop responding.
    const objectForget = vi.fn(async () => {
      throw { kind: "no_such_object", detail: "42" };
    });
    const onForgotten = vi.fn();
    show(objectForget, onForgotten);

    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    confirm();

    expect(await screen.findByText("the core refused: no_such_object")).toBeDefined();
    expect(onForgotten).not.toHaveBeenCalled();
  });
});
