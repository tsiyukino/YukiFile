import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

vi.mock("./invoke.js", () => ({
  invoke: async (command: string) => {
    switch (command) {
      case "plugin_list": return [{"id": "yukifile.archive", "contributes": {"properties": ["archive"], "file_types": {"zip": ["archive"]}, "panels": {"archive": "./panel"}, "columns": {"archive": ["entries", "unpacked"]}}, "directory": "archive"}, {"id": "yukifile.pdf", "contributes": {"properties": ["pdf"], "file_types": {"pdf": ["pdf"]}, "panels": {"pdf": "./panel"}, "viewers": {"pdf": "./viewer"}}, "directory": "pdf"}, {"id": "yukifile.paper", "contributes": {"properties": ["paper"], "shared": ["title"], "forms": {"paper": "./form"}, "panels": {"paper": "./panel"}}, "requires": {"properties": ["pdf"]}, "directory": "paper"}, {"id": "yukifile.unitypackage", "contributes": {"properties": ["unitypackage"], "file_types": {"unitypackage": ["unitypackage"]}, "panels": {"unitypackage": "./panel"}}, "directory": "unitypackage"}, {"id": "yukifile.explorer", "contributes": {"library_actions": ["scan"], "library_action_module": "./action"}, "directory": "explorer"}];
      case "mount_order": return [{ namespace: "archive", instance: 1 }, { namespace: "pdf", instance: 1 }, { namespace: "paper", instance: 1 }];
      case "object_ids": return { ids: ["1"], total: 1 };
      case "object_flat": return { id: "1", shared: { title: [{ value: "Cross Maid", from: null }] }, regions: [{ property: "archive", instance: 1, fields: {} }], skipped: [], carries: ["archive#1"], locations: [{ path: "a.zip", kind: "file", size: 3 }] };
      case "changes_pending": return [];
      case "object_summaries": return [{ id: "1", name: "Cross Maid", path: "a.zip", kind: "file" }];
      case "object_edges": return [];
      case "path_list": return [];
      case "term_vocabularies": return [];
      default: throw new Error(`unexpected ${command}`);
    }
  },
}));

// Loading five plugins' modules through Vite's glob under a full suite's
// load takes longer than the default five seconds allows.
test("the shell renders a library with one object", { timeout: 30_000 }, async () => {
  const { App } = await import("./App.js");
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  render(<App />);
  expect(await screen.findByText("Cross Maid", {}, { timeout: 20_000 })).toBeDefined();
  console.log(errors.mock.calls.map((c) => String(c[0]).slice(0, 300)).join("\n---\n"));
});
