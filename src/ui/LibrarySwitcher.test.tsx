import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { AppApi, RecentLibrary } from "../plugin-host/commands.js";
import { LibrarySwitcher } from "./LibrarySwitcher.js";

const recent: RecentLibrary[] = [
  { path: "E:\\Avatar", name: "Avatar", exists: true, current: true },
  { path: "D:\\Old", name: "Old", exists: true, current: false },
  { path: "F:\\Unplugged", name: "Unplugged", exists: false, current: false },
];

function show(picked: string | null = "C:\\New") {
  const app = {
    libraryRecent: vi.fn(async () => recent),
    librarySwitch: vi.fn(async (_path: string) => undefined),
    libraryRecentRemove: vi.fn(async (_path: string) => undefined),
  };
  const dialogs = {
    pickDocument: async () => null,
    pickTarget: async () => null,
    pickLibrary: vi.fn(async () => picked),
  };
  render(<LibrarySwitcher app={app as unknown as AppApi} dialogs={dialogs} root="E:\\Avatar" />);
  return { app, dialogs };
}

describe("choosing a library", () => {
  test("the open library is named at the top", () => {
    show();
    expect(screen.getByRole("button", { name: /Library: Avatar/ })).toBeDefined();
  });

  test("the menu lists what was opened before and switches to one", async () => {
    const { app } = show();
    fireEvent.click(screen.getByRole("button", { name: /Library: Avatar/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Old" }));
    await waitFor(() => expect(app.librarySwitch).toHaveBeenCalledWith("D:\\Old"));
  });

  test("a library that is not there is listed but cannot be chosen", async () => {
    const { app } = show();
    fireEvent.click(screen.getByRole("button", { name: /Library: Avatar/ }));
    expect(await screen.findByText("Not found")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Open Unplugged" })).toBeNull();
    expect(app.librarySwitch).not.toHaveBeenCalled();
  });

  test("another library is any folder the dialog hands back", async () => {
    const { app, dialogs } = show();
    fireEvent.click(screen.getByRole("button", { name: /Library: Avatar/ }));
    fireEvent.click(await screen.findByText("Open another library…"));
    await waitFor(() => expect(app.librarySwitch).toHaveBeenCalledWith("C:\\New"));
    expect(dialogs.pickLibrary).toHaveBeenCalled();
  });

  test("a closed dialog switches nothing", async () => {
    const { app, dialogs } = show(null);
    fireEvent.click(screen.getByRole("button", { name: /Library: Avatar/ }));
    fireEvent.click(await screen.findByText("Open another library…"));
    await waitFor(() => expect(dialogs.pickLibrary).toHaveBeenCalled());
    expect(app.librarySwitch).not.toHaveBeenCalled();
  });

  test("a library can be taken off the list without opening it", async () => {
    const { app } = show();
    fireEvent.click(screen.getByRole("button", { name: /Library: Avatar/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Forget Old from this list" }));
    await waitFor(() => expect(app.libraryRecentRemove).toHaveBeenCalledWith("D:\\Old"));
    expect(app.librarySwitch).not.toHaveBeenCalled();
  });

  test("a refused switch says why", async () => {
    const { app } = show();
    app.librarySwitch.mockImplementation(async () => {
      throw { kind: "not_found", detail: "D:\\Old" };
    });
    fireEvent.click(screen.getByRole("button", { name: /Library: Avatar/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Old" }));
    expect(await screen.findByText(/That library could not be opened/)).toBeDefined();
  });
});
