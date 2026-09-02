# v1 scope, revised: the model, not the layout system

Date: 2026-09-02
Status: accepted
Revises `2026-09-01_v1-scope-and-build-order.md`

## Context

Designing the object model in detail added capabilities the original v1 scope
did not account for. Objects span paths, fields have sources rather than
winners, pins override mount order per object, UI ownership follows properties,
and plugins can own an object's whole page.

Most of those cost little. Two do not:

- **`@yukifile/ui`**, the component library a plugin needs in order to draw an
  object page — `ObjectCover`, `ObjectTitle`, `ObjectPaths`, `ObjectActions`,
  each carrying source lists, pins and fallbacks. Publishing it makes it a
  public API with the same weight as the property API.
- **Layout ownership**, with arbitration, an escape hatch, and a default layout
  that must survive any object and any misbehaving plugin.

Together they roughly double the v1 frontend, and neither is exercised by the
one plugin v1 ships.

## Decision

v1 builds the model and the property-scoped extension points. It does not build
layout ownership and does not publish the component library.

**In v1**

- The store: objects with 0..N `fs` instances, values, edges, vocabularies,
  history, pins
- Change sets and the import/export contract
- The plugin host: manifests, dependency resolution on property contracts, slot
  arbitration
- Contribution slots: `panel`, `action`, `viewer`, scoped by property
- The framework's default object page, drawing property regions in mount order
- Built-ins: `folder`, `file`, `archive`
- The PDF plugin: a panel, a viewer, actions

**Deferred**

- Layout ownership (`objects.primary_property` is in the schema; nothing reads
  it yet)
- `@yukifile/ui` as a published API
- Companion regions around a viewer
- Cross-plugin panels of the price-comparison kind
- Everything the earlier record already deferred: Booth fetch, AI import, MCP,
  unitypackage support, the `pdf`/`docx`/`image` built-ins beyond the PDF
  plugin, WASM plugins, AppData relocation

## Why defer the component library rather than ship a small one

A component library designed against one consumer is designed against nothing.
The PDF plugin needs a title and a cover; the VRChat plugin will need avatar
compatibility rendering, source lists across two shops, and a variant picker.
Publishing three components now and discovering the shape is wrong when the
second plugin arrives means either breaking plugins or carrying the mistake.

The same reasoning defers unitypackage support in the earlier record: a design
with no consumer is a guess, and a guess frozen into a public API is expensive
in a way a guess in private code is not.

Deferring costs little because the framework still draws the default page, and
that page renders titles, covers, paths and actions for every object. v1 users
see all of it; what they do not get is a plugin replacing it.

## Why the deferral does not compromise the model

Layout ownership is a frontend capability. Nothing in the store, the plugin
host, the contract or the change set pipeline depends on it. The property-scoped
model — contributions as (property, slot) pairs, visibility from the object's
properties, ordering from mount order — is fully exercised by panels, actions
and a viewer.

`objects.primary_property` ships in the schema unread, for the same reason the
edge and term tables ship in v1 with no plugin consuming them: schema added
later is a migration, and the column is one nullable field.

## Consequences

The build order is unchanged. Layer 6 builds the default object page rather than
an ownership system, and layer 7's PDF plugin contributes into it.

When layout ownership arrives, plugins written against v1 do not change: a panel
contributed to a property region is still a panel when an owner plugin decides
where that region goes. This is the same property that let the viewer decision
survive the surface discussion — plugins declaring what they are rather than
where they go keeps host-side changes from reaching them.

v1 ships with two capabilities in the schema and no consumer: vocabularies and
edges (from the earlier record) and now `primary_property`. If any of them is
still unused when the second plugin lands, that is worth revisiting.
