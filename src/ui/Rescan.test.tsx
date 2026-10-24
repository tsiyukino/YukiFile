import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { AppApi, Rescanned } from "../plugin-host/commands.js";
import { Rescan, summaryOf } from "./Rescan.js";

const quiet: Rescanned = { moved: 0, touched: 0, removed: 0, added: [], candidates: [], unreadable: [] };

function world(result: Rescanned) {
  const app = {
    libraryReconcile: vi.fn(async () => result),
    objectPathRemove: vi.fn(async () => undefined),
    objectPathAdd: vi.fn(async () => undefined),
  };
  const onChanged = vi.fn();
  render(<Rescan app={app as unknown as AppApi} onChanged={onChanged} />);
  return { app, onChanged };
}

describe("the one line", () => {
  test("says what happened, or that nothing did", () => {
    expect(summaryOf(quiet)).toBe("the library matches the disk");
    expect(summaryOf({ ...quiet, moved: 2, removed: 1, added: ["a", "b", "c"] })).toBe(
      "2 moved, 1 gone, 3 new on disk",
    );
  });
});

describe("rescanning", () => {
  test("applies nothing itself and re-reads only when something changed", async () => {
    const { app, onChanged } = world(quiet);

    fireEvent.click(screen.getByRole("button", { name: "Rescan" }));

    await screen.findByText("the library matches the disk");
    expect(app.libraryReconcile).toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  test("a change re-reads the library", async () => {
    const { onChanged } = world({ ...quiet, removed: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Rescan" }));

    await screen.findByText("1 gone");
    expect(onChanged).toHaveBeenCalled();
  });

  test("new paths are named as not yet objects", async () => {
    world({ ...quiet, added: ["Clothing/new.zip"] });

    fireEvent.click(screen.getByRole("button", { name: "Rescan" }));

    expect(await screen.findByText(/not objects until a plugin/)).toBeDefined();
  });

  test("a candidate is a question with a button, and confirming moves the path", async () => {
    const { app, onChanged } = world({
      ...quiet,
      removed: 1,
      added: ["Clothing/outfit.zip"],
      candidates: [{ object: "7", from: "outfit.zip", to: "Clothing/outfit.zip", kind: "file" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Rescan" }));
    await screen.findByText("outfit.zip → Clothing/outfit.zip");
    fireEvent.click(screen.getByRole("button", { name: "Moved" }));

    await waitFor(() => expect(app.objectPathAdd).toHaveBeenCalledWith("7", { path: "Clothing/outfit.zip", kind: "file" }));
    expect(app.objectPathRemove).toHaveBeenCalledWith("7", "outfit.zip");
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByText("outfit.zip → Clothing/outfit.zip")).toBeNull();
  });

  test("a refusal is shown", async () => {
    const app = {
      libraryReconcile: vi.fn(async () => {
        throw { kind: "storage", detail: "x" };
      }),
    };
    render(<Rescan app={app as unknown as AppApi} onChanged={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Rescan" }));

    expect(await screen.findByText("the core refused: storage")).toBeDefined();
  });
});
