import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Api, AppApi, FlatObject } from "../plugin-host/commands.js";
import { Cover } from "./Cover.js";

function object(over: Partial<FlatObject> = {}): FlatObject {
  return { id: "1", shared: {}, regions: [], skipped: [], carries: [], locations: [], ...over };
}

function world() {
  const api = {
    fileUrl: vi.fn(async (path: string) => `asset://${path}`),
    fsWalk: vi.fn(async () => [{ path: "promo.png", kind: "file", size: 1, mtime: null }]),
    archiveList: vi.fn(async () => [
      { path: "cover.jpg", size: 1, compressed_size: 1, is_dir: false, escapes_root: false },
      { path: "x.unitypackage", size: 1, compressed_size: 1, is_dir: false, escapes_root: false },
    ]),
    unitypackageList: vi.fn(async () => [{ guid: "g", path: "Assets/a.prefab", size: 1, has_preview: true }]),
  };
  const app = {
    coverSet: vi.fn(async () => ".yukifile/covers/abc.png"),
    objectValueSet: vi.fn(async () => "cleared"),
  };
  const onChanged = vi.fn();
  return { api: api as unknown as Api, app: app as unknown as AppApi, calls: { api, app }, onChanged };
}

describe("showing a cover", () => {
  test("the held path becomes an image through file.url", async () => {
    const w = world();
    render(
      <Cover
        api={w.api}
        object={object({ shared: { cover: [{ value: ".yukifile/covers/x.png", from: null }] } })}
      />,
    );

    const img = await screen.findByRole("img", { name: "Cover" });
    expect(img.getAttribute("src")).toBe("asset://.yukifile/covers/x.png");
  });

  test("nothing held and nothing to write with draws nothing", () => {
    const { container } = render(<Cover api={world().api} object={object()} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("choosing one", () => {
  test("lists pictures from a folder, a zip, and the package inside the zip", async () => {
    const w = world();
    render(
      <Cover
        api={w.api}
        app={w.app}
        object={object({
          locations: [
            { path: "Clothing/outfit", kind: "folder", size: null },
            { path: "Clothing/outfit.zip", kind: "file", size: 1 },
          ],
        })}
        onChanged={w.onChanged}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose cover" }));

    expect(await screen.findByText("promo.png")).toBeDefined();
    expect(screen.getByText("cover.jpg")).toBeDefined();
    expect(screen.getByText("x.unitypackage: Assets/a.prefab")).toBeDefined();
    expect(w.calls.api.fsWalk).toHaveBeenCalledWith("Clothing/outfit", 1);
    expect(w.calls.api.unitypackageList).toHaveBeenCalledWith("Clothing/outfit.zip", "x.unitypackage");
  });

  test("picking one stores it and re-reads the object", async () => {
    const w = world();
    render(
      <Cover
        api={w.api}
        app={w.app}
        object={object({ locations: [{ path: "Clothing/outfit", kind: "folder", size: null }] })}
        onChanged={w.onChanged}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose cover" }));
    fireEvent.click(await screen.findByText("promo.png"));

    await waitFor(() => expect(w.calls.app.coverSet).toHaveBeenCalledWith("1", { from: "file", path: "Clothing/outfit/promo.png" }));
    expect(w.onChanged).toHaveBeenCalled();
  });

  test("clearing is offered only for a cover of one's own, and clears the bare field", async () => {
    const w = world();
    const { unmount } = render(
      <Cover
        api={w.api}
        app={w.app}
        object={object({ shared: { cover: [{ value: "x.png", from: "booth#1" }] } })}
        onChanged={w.onChanged}
      />,
    );
    expect(screen.queryByRole("button", { name: "Clear cover" })).toBeNull();
    unmount();

    render(
      <Cover
        api={w.api}
        app={w.app}
        object={object({ shared: { cover: [{ value: "x.png", from: null }] } })}
        onChanged={w.onChanged}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear cover" }));

    await waitFor(() => expect(w.calls.app.objectValueSet).toHaveBeenCalledWith("1", "cover", ""));
  });

  test("a location holding no picture says so", async () => {
    const w = world();
    (w.calls.api.fsWalk as ReturnType<typeof vi.fn>).mockImplementation(async () => []);
    render(
      <Cover
        api={w.api}
        app={w.app}
        object={object({ locations: [{ path: "Empty", kind: "folder", size: null }] })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose cover" }));

    expect(await screen.findByText(/holds a picture the core can read/)).toBeDefined();
  });
});
