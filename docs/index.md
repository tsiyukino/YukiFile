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

## Reference

Generated per module from the source.

- [store.md](reference/store.md) — value paths and the flattening rule. The
  rest of the store is not written yet.

## Seed

Not documentation, but the data the first library was built from:

- `seed/vrc-lessons.md` — what organising a real 35 GB VRChat library taught us.
  Written for whoever builds the AI-assisted organising prompt.
- `seed/_MOVE_MANIFEST.md` — 174 products with category, source, and avatar
  compatibility.
- `seed/sources.json` — 178 resolved product sources.
- `seed/manifest.json`, `seed/inventory.json` — structured scan output.
- `seed/alias.json`, `seed/av.json` — the avatar vocabulary, bilingual.
