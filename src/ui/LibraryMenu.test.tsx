import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Api, AppApi } from "../plugin-host/commands.js";
import type { Loaded } from "../plugin-host/loader.js";
import type { Manifest } from "../plugin-host/types.js";
import { LibraryMenu, libraryActionsOf } from "./LibraryMenu.js";

const scanner: Manifest = {
  id: "vrc",
  contributes: { library_actions: ["scan products"], library_action_module: "./action" },
};

function show(run: () => Promise<{ summary: string; changed: boolean }>) {
  const runLibraryAction = vi.fn(run);
  const loaded: Loaded[] = [
    { manifest: scanner, modules: new Map([["./action", { runLibraryAction }]]), failures: [] },
  ];
  const onReport = vi.fn();
  const onChanged = vi.fn();
  render(
    <LibraryMenu
      api={{} as Api}
      app={{} as AppApi}
      dialogs={{ pickDocument: async () => null, pickTarget: async () => null }}
      plugins={[scanner]}
      loaded={loaded}
      onReport={onReport}
      onChanged={onChanged}
    />,
  );
  return { runLibraryAction, onReport, onChanged };
}

describe("the library menu", () => {
  test("lists every plugin's library actions", () => {
    expect(libraryActionsOf([scanner, { id: "quiet" }])).toEqual([{ plugin: "vrc", action: "scan products" }]);
  });

  test("runs a plugin's action, reports what it said, and re-reads when it changed something", async () => {
    const { runLibraryAction, onReport, onChanged } = show(async () => ({ summary: "174 products", changed: true }));
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    fireEvent.click(await screen.findByText("Scan products"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(runLibraryAction).toHaveBeenCalledWith(expect.objectContaining({ action: "scan products" }));
    expect(onReport).toHaveBeenLastCalledWith({ tone: "success", title: "Scan products finished", detail: "174 products" });
  });

  test("a failing action is reported, not swallowed", async () => {
    const { onReport, onChanged } = show(async () => {
      throw new Error("the disk is gone");
    });
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    fireEvent.click(await screen.findByText("Scan products"));
    await waitFor(() => expect(onReport).toHaveBeenLastCalledWith(expect.objectContaining({ tone: "critical", detail: "the disk is gone" })));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
