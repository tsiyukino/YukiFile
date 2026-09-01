# v1 ships the core and a PDF plugin, not the VRChat plugin

Date: 2026-09-01
Status: accepted

## Context

The architecture is written down but nothing is built. The question was which
slice to build first, and specifically which plugin to build against the
contribution API.

The obvious candidate was the VRChat plugin, since the whole design came out of
organising a VRChat library. It turned out to be the wrong first consumer.

## Decision

v1 is the core, the built-in modules `folder`, `file` and `archive`, and a PDF
viewer plugin. The VRChat plugin is deferred.

Build order:

```
0  tests/boundary.rs      the core/plugin boundary test, written first
1  store/                 schema, path, flatten, values, edges, vocab, history
2  scan/ + commands/      walking and factual typing; heavy work as commands
3  changes/ + contract.rs change sets and the import/export contract
4  plugin/ + plugin-host/ manifest, registry, loader, slot arbitration
5  plugins/               folder, file, archive
6  src/views/             grid, sidebar, detail, review, term page, viewer host
7  plugins/pdf            the first viewer consumer
```

Each layer is runnable and testable before the next one starts.

## Why PDF rather than VRChat

The first plugin exists to expose defects in the extension points. The VRChat
plugin is too heavy to do that job: it carries vendor-namespace stripping,
token matching for avatar names, and alias resolution, so roughly half of any
failure would be a heuristic bug rather than an API bug. Attribution is the
whole value of building it, and the VRChat plugin destroys attribution.

A PDF plugin carries almost no domain knowledge. When it breaks against the
API, the API is what broke.

The trade is that PDF exercises properties, panels, viewers and core commands,
but not vocabularies and not edges. Those two get code and tests in layer 1
with no plugin consuming them in v1. That is accepted deliberately: the edge
and term tables are schema, and schema added later means a migration, which is
the same argument the namespaced-path decision makes for going in first.

Adding an `author` vocabulary to the PDF plugin to manufacture a consumer was
rejected. Authors belong to a `paper` semantic property, not to the `pdf`
factual one, and blurring that line is the mistake the architecture names as
the first thing the prototype got wrong.

## Why unitypackage support is not in v1

An earlier draft put `unitypackage.rs` in the core, arguing it is a container
format (gzip, then tar) rather than a domain concept.

The argument does not hold on its own: `.docx`, `.epub` and `.whl` are all zip
containers too, and the same reasoning would pull every format into the core.
Shape does not determine ownership; consumers do.

With the VRChat plugin deferred, unitypackage support has no consumer in v1, so
it is not written at all — neither in the core nor in a plugin. When the VRChat
plugin is built, the decision resolves on evidence instead of speculation:

- If the plugin can read unitypackages through the existing archive command,
  it was always plugin work and the extension point is validated.
- If it cannot, the missing capability is identifiable and specific, and that
  is what the core adds.

The cost is that the measured performance problem (206 unitypackage manifests,
two minutes in Python) stays unsolved in v1. Optimising for a consumer that
does not exist optimises an imagination.

## Excluded from v1

Booth network fetch, AI import, the MCP server, the `pdf` `docx` and `image`
built-ins beyond the PDF plugin itself, WASM plugins, and moving library data
to AppData.

Fetch and AI import are both wrappers over machinery v1 does build — the change
set pipeline and the import contract — so deferring them costs nothing
structural. Three more built-in modules of the same shape as `archive` would
validate nothing the first three do not.

## Consequences

The contract in layer 3 lands before the UI, which means every layer above it
can be exercised against the 174 real objects in `seed/` rather than against
toy fixtures.

`vocab.rs` and `edges.rs` ship tested and unused. If they are still unused when
the second plugin arrives, that is a signal worth revisiting.
