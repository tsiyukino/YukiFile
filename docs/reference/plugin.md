# plugin

What a plugin declares, and how the core arbitrates between plugins.

The core is an arbiter. It reads manifests, checks that everything required is
provided by something, and hands back a load order. It never asks a plugin to
identify itself beyond its manifest, and `src-tauri/tests/boundary.rs` fails if
core source names a specific plugin.

## plugin::manifest

`Manifest::parse(&str)` · `Manifest::check()` · `Manifest::scope()`

```rust
struct Manifest { id: String, contributes: Contributes, requires: Requires }
```

### Dependencies name properties, never plugins

`Requires` holds property names and has **no field that could hold a plugin
id**. An AI-summary plugin requires `vrchat`; whichever plugin provides it
satisfies that, so swapping one provider for another is not a migration. The
rule is not one anybody has to remember, because there is nowhere to write the
violation down.

### UI contributions are keyed by property

`panels`, `actions`, `viewers` and `columns` are all keyed by the property they
are scoped to. A plugin does not say where on screen it wants to be; the core
places that property's region, and ordering falls out of mount order.

Visibility follows from the same key: a contribution appears when the object
carries the property. Panels, actions and columns need no separate rule.

**Requiring a property is the ticket into its region.** A contribution keyed by
a property the plugin neither declares nor requires is refused at parse
(`UnscopedContribution`) — the permission check and the dependency declaration
are the same statement.

### Reserved names

`fs`, `@pin` and `@import` belong to the core. A plugin declaring one is
refused rather than allowed to shadow something it does not know exists.

`file_types` maps an extension to the factual properties it brings, which is
how the core holds the matching and none of the extensions.

## plugin::registry

`Registry::load(Vec<Manifest>) -> Result<Registry, RegistryError>`

All or nothing. A partly loaded set is a library where some objects have panels
and others do not for reasons nobody can see.

| method                    | answers                                      |
|---------------------------|----------------------------------------------|
| `plugins()`               | everything, in load order                    |
| `provider_of(property)`   | which plugin defines it                      |
| `scoped_to(property)`     | everyone with something to show in its region |
| `shared_fields()`         | which fields compete for a bare name          |

`scoped_to` includes plugins that *require* the property as well as the one
that defines it — requiring it is what buys the right to contribute there.

`shared_fields` is what `flatten` needs. A plugin declaring nothing shared
keeps every field to itself, which is the safe default: fields that compete by
accident change values on objects the user never touched.

### What is refused

| error               | why                                              |
|---------------------|--------------------------------------------------|
| `DuplicateId`       | two plugins claim one id                          |
| `DuplicateProperty` | a property is a contract; two definitions of one contract means one is about to surprise somebody |
| `Unsatisfied`       | something requires a property nothing provides    |
| `Circular`          | plugins require each other, so no order starts them all |

Load order is a depth-first walk that reports a cycle rather than looping, and
the error names every plugin in the chain.
