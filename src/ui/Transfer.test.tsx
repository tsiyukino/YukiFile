import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { AppApi } from "../plugin-host/commands.js";
import { Transfer } from "./Transfer.js";

function world(over: { target?: string | null; document?: string | null } = {}) {
  const app = {
    libraryExportFile: vi.fn(async () => ({ objects: 174, terms: 76, edges_left_out: 2 })),
    libraryImportFile: vi.fn(async () => ({ written: 10, unchanged: 3, objects_created: 2, terms: 0, edges: 0, pending: 7 })),
  };
  const dialogs = {
    pickTarget: vi.fn(async () => over.target ?? "C:\\out.json"),
    pickDocument: vi.fn(async () => over.document ?? "C:\\seed.json"),
  };
  const onChanged = vi.fn();
  render(<Transfer app={app as unknown as AppApi} dialogs={dialogs} onChanged={onChanged} />);
  return { app, dialogs, onChanged };
}

describe("export", () => {
  test("writes where the dialog said and reports what it wrote", async () => {
    const w = world();

    fireEvent.click(screen.getByRole("button", { name: "Export…" }));

    await waitFor(() => expect(w.app.libraryExportFile).toHaveBeenCalledWith("C:\\out.json"));
    expect(await screen.findByText("exported 174 objects, 76 terms, 2 edges to pathless objects left out")).toBeDefined();
  });

  test("a closed dialog writes nothing", async () => {
    const w = world({ target: null });

    fireEvent.click(screen.getByRole("button", { name: "Export…" }));

    await waitFor(() => expect(w.dialogs.pickTarget).toHaveBeenCalled());
    expect(w.app.libraryExportFile).not.toHaveBeenCalled();
  });
});

describe("import", () => {
  test("reads the chosen file, says what happened, and re-reads the library", async () => {
    const w = world();

    fireEvent.click(screen.getByRole("button", { name: "Import…" }));

    await waitFor(() => expect(w.app.libraryImportFile).toHaveBeenCalledWith("C:\\seed.json"));
    expect(await screen.findByText("imported: 2 added, 10 written, 3 unchanged, some need review")).toBeDefined();
    expect(w.onChanged).toHaveBeenCalled();
  });

  test("a refusal is shown", async () => {
    const w = world();
    w.app.libraryImportFile.mockImplementation(async () => {
      throw { kind: "bad_request", detail: "cannot read document" };
    });

    fireEvent.click(screen.getByRole("button", { name: "Import…" }));

    expect(await screen.findByText("the core refused: bad_request")).toBeDefined();
  });
});
