# Documentation

## Explanation

- [architecture.md](explanation/architecture.md) — the object model, properties,
  edges, vocabularies, change sets, and how plugins attach to the core.

## Decisions

- [2026-09-01 object-property model](decisions/2026-09-01_object-property-model.md)
  — why properties are typed but stored under namespaced paths.
- [2026-09-01 vocabularies, not empty objects](decisions/2026-09-01_vocabularies-not-empty-objects.md)
  — why referenced names are terms rather than pathless objects.
- [2026-09-01 Tauri and the plugin boundary](decisions/2026-09-01_tauri-and-plugin-boundary.md)
  — runtime choice, and where the line between plugin code and core code sits.
- [2026-09-01 Primer, not a GitHub clone](decisions/2026-09-01_ui-primer-not-github-clone.md)
  — design system, which GitHub patterns to copy, and the quality bar for the UI.
- [2026-09-01 v1 scope and build order](decisions/2026-09-01_v1-scope-and-build-order.md)
  — why the first version ships a PDF plugin rather than the VRChat one, and
  why unitypackage support waits for a consumer.
- [2026-09-01 viewer extension point](decisions/2026-09-01_viewer-extension-point.md)
  — why a viewer renders into a region without knowing where that region is.
- [2026-09-02 core properties](decisions/2026-09-02_core-properties.md)
  — the reserved set the core cannot run without, and why it lives in its own
  tables.
- [2026-09-02 objects may span paths](decisions/2026-09-02_objects-may-span-paths.md)
  — an object sits at zero, one or several locations; a path still belongs to
  one object.
- [2026-09-02 fields have sources, not winners](decisions/2026-09-02_fields-have-sources-not-winners.md)
  — reading returns every source for a field, and fields do not compete unless
  a plugin says they do.
- [2026-09-02 mount order and pins](decisions/2026-09-02_mount-order-and-pins.md)
  — one library-wide rule, plus per-object choices that stay visible where they
  apply.
- [2026-09-02 UI ownership follows properties](decisions/2026-09-02_plugins-own-the-object-page.md)
  — contributions are (property, slot) pairs, actions are independent of
  layout, and grids are never owned.
- [2026-09-02 v1 scope, revised](decisions/2026-09-02_v1-scope-revised.md)
  — why layout ownership and the component library wait for a second plugin.
- [2026-09-02 a leading dot does not hide anything](decisions/2026-09-02_dot-prefixed-entries-are-not-hidden.md)
  — why the scan ignores the Unix convention, and what it would have cost.

## Reference

Generated per module from the source.

- [store.md](reference/store.md) — objects, values, edges, vocabularies,
  history, and the schema they live in.
- [scan.md](reference/scan.md) — walking a library root, typing entries, and
  working out what changed.
- [commands.md](reference/commands.md) — heavy work a plugin calls into.
- [contract.md](reference/contract.md) — the import and export document shape.
- [changes.md](reference/changes.md) — proposals, review, and applying them.

## Seed

Not documentation, but the data the first library was built from:

- `seed/vrc-lessons.md` — what organising a real 35 GB VRChat library taught us.
  Written for whoever builds the AI-assisted organising prompt.
- `seed/_MOVE_MANIFEST.md` — 174 products with category, source, and avatar
  compatibility.
- `seed/sources.json` — 178 resolved product sources.
- `seed/manifest.json`, `seed/inventory.json` — structured scan output.
- `seed/alias.json`, `seed/av.json` — the avatar vocabulary, bilingual.
