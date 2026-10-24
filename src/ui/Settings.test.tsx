import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Api, AppApi } from "../plugin-host/commands.js";
import { Settings } from "./Settings.js";

function world() {
  let settings = [{ key: "theme", value: "dark" }, { key: "vrchat.grouping_depth", value: "2" }];
  const api = { mountOrder: vi.fn(async () => [{ namespace: "booth", instance: 1 }, { namespace: "gumroad", instance: 1 }]) };
  const app = {
    libraryInfo: vi.fn(async () => ({
      root: "E:\\Avatar",
      chosen: true,
      plugins: [
        { id: "yukifile.vrchat", directory: "vrchat", enabled: true, running: true },
        { id: "yukifile.explorer", directory: "explorer", enabled: false, running: true },
      ],
      skipped: [["broken", "cannot parse"]],
    })),
    settingAll: vi.fn(async () => settings),
    settingSet: vi.fn(async (key: string, value: string) => {
      settings = settings.filter((s) => s.key !== key);
      if (value) settings = [...settings, { key, value }];
    }),
    pluginsEnable: vi.fn(async () => undefined),
    mountOrderSet: vi.fn(async () => undefined),
  };
  const onTheme = vi.fn();
  const onChanged = vi.fn();
  render(<Settings api={api as unknown as Api} app={app as unknown as AppApi} generation={0} onTheme={onTheme} onChanged={onChanged} />);
  return { api, app, onTheme, onChanged };
}

describe("the settings page", () => {
  test("says where the library is and what it runs", async () => {
    world();

    expect(await screen.findByText("E:\\Avatar")).toBeDefined();
    expect((screen.getByLabelText("yukifile.vrchat") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("yukifile.explorer") as HTMLInputElement).checked).toBe(false);
    // Running but unticked: the difference is said.
    expect(screen.getByText(/changes at next open/)).toBeDefined();
    expect(screen.getByText("broken: cannot parse")).toBeDefined();
  });

  test("the theme is a setting, applied at once and stored", async () => {
    const w = world();
    await screen.findByText("E:\\Avatar");

    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "light" } });

    await waitFor(() => expect(w.app.settingSet).toHaveBeenCalledWith("theme", "light"));
    expect(w.onTheme).toHaveBeenCalledWith("light");
  });

  test("following the system clears the setting rather than storing a word for it", async () => {
    const w = world();
    await screen.findByText("E:\\Avatar");

    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "system" } });

    await waitFor(() => expect(w.app.settingSet).toHaveBeenCalledWith("theme", ""));
  });

  test("the plugin list is written as ticked", async () => {
    const w = world();
    await screen.findByText("E:\\Avatar");

    fireEvent.click(screen.getByLabelText("yukifile.explorer"));
    fireEvent.click(screen.getByRole("button", { name: "Save plugin list" }));

    await waitFor(() => expect(w.app.pluginsEnable).toHaveBeenCalledWith(["yukifile.vrchat", "yukifile.explorer"]));
  });

  test("running everything installed writes no list", async () => {
    const w = world();
    await screen.findByText("E:\\Avatar");

    fireEvent.click(screen.getByRole("button", { name: "Run everything installed" }));

    await waitFor(() => expect(w.app.pluginsEnable).toHaveBeenCalledWith(null));
  });

  test("a mount moves and every mount is named", async () => {
    const w = world();
    await screen.findByText("E:\\Avatar");

    fireEvent.click(screen.getByRole("button", { name: "Move gumroad up" }));

    await waitFor(() =>
      expect(w.app.mountOrderSet).toHaveBeenCalledWith([
        { namespace: "gumroad", instance: 1 },
        { namespace: "booth", instance: 1 },
      ]),
    );
    expect(w.onChanged).toHaveBeenCalled();
  });

  test("other settings are listed, set and cleared", async () => {
    const w = world();
    await screen.findByText("vrchat.grouping_depth = 2");

    fireEvent.click(screen.getByRole("button", { name: "Clear vrchat.grouping_depth" }));
    await waitFor(() => expect(w.app.settingSet).toHaveBeenCalledWith("vrchat.grouping_depth", ""));

    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "vrchat.grouping_depth" } });
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    await waitFor(() => expect(w.app.settingSet).toHaveBeenCalledWith("vrchat.grouping_depth", "1"));
  });
});
