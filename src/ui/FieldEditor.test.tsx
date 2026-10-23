import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { FieldEditor, NewField } from "./FieldEditor.js";
import { isFieldName } from "./edit.js";

function edit(label = "title"): void {
  fireEvent.click(screen.getByRole("button", { name: `Edit ${label}` }));
}

function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("reading", () => {
  test("shows the value and a pencil", () => {
    render(<FieldEditor label="title" shown="Cross Maid" own={undefined} onSave={async () => undefined} />);

    expect(screen.getByText(/Cross Maid/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Edit title" })).toBeDefined();
  });

  test("an empty field says so rather than showing nothing", () => {
    render(<FieldEditor label="note" shown={undefined} own={undefined} onSave={async () => undefined} />);

    expect(screen.getByText("empty")).toBeDefined();
  });
});

describe("writing", () => {
  test("starts from what is shown, and saves what was typed", async () => {
    // A shop's title is what the person is looking at, so it is what they
    // start editing from, even though saving writes their own.
    const onSave = vi.fn(async () => undefined);
    render(<FieldEditor label="title" shown="shop name" own={undefined} onSave={onSave} />);

    edit();
    expect((screen.getByLabelText("title") as HTMLInputElement).value).toBe("shop name");
    type("title", "my name");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("my name"));
    // Back to reading once saved.
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  test("enter saves and escape cancels", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<FieldEditor label="title" shown="a" own={undefined} onSave={onSave} />);

    edit();
    fireEvent.keyDown(screen.getByLabelText("title"), { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit title" })).toBeDefined();

    edit();
    type("title", "b");
    fireEvent.keyDown(screen.getByLabelText("title"), { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("b"));
  });

  test("clear is offered only for a value of one's own", () => {
    const { unmount } = render(
      <FieldEditor label="title" shown="shop name" own={undefined} onSave={async () => undefined} />,
    );
    edit();
    // Clearing a shop's value is not a thing a person can do from here.
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    unmount();

    render(<FieldEditor label="title" shown="mine" own="mine" onSave={async () => undefined} />);
    edit();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDefined();
  });

  test("clear saves an empty value", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<FieldEditor label="title" shown="mine" own="mine" onSave={onSave} />);

    edit();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(""));
  });

  test("a refusal is shown and the box stays open", async () => {
    const onSave = vi.fn(async () => {
      throw { kind: "bad_request", detail: "x" };
    });
    render(<FieldEditor label="title" shown="a" own={undefined} onSave={onSave} />);

    edit();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("the core refused: bad_request")).toBeDefined();
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
  });
});

describe("a new field", () => {
  test("a name the store would refuse is refused here, beside the box", async () => {
    const onAdd = vi.fn(async () => undefined);
    render(<NewField onAdd={onAdd} isName={isFieldName} />);

    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    type("Field", "has space");
    type("Value", "x");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText(/needs a name with no spaces/)).toBeDefined();
    expect(onAdd).not.toHaveBeenCalled();
  });

  test("a good name and value are handed over", async () => {
    const onAdd = vi.fn(async () => undefined);
    render(<NewField onAdd={onAdd} isName={isFieldName} />);

    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    type("Field", "category");
    type("Value", "clothing");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("category", "clothing"));
    // Closed and cleared, ready for the next one.
    expect(screen.getByRole("button", { name: "Add field" })).toBeDefined();
  });
});
