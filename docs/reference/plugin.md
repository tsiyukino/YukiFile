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

### Module specifiers name no extension

`"./panel"`, never `"./panel.js"`. Which extension a module carries on disk --
`.ts` in development, `.js` after a build, a hashed name after bundling -- is
the resolver's business, and a manifest that spells one out has to be edited
whenever the build output changes. `ExtensionInSpecifier` refuses it.

Path syntax is left alone: `./panels/v1.2/Booth` and `../panel` both pass,
because the check reads the last segment's extension rather than looking for
dots.

## plugin::discover

`in_directory(root) -> Found { manifests, skipped }`

A plugin is a directory holding a `manifest.json`. Discovery reads them and
hands back what parsed, alongside what did not and why.

**Reading is not loading.** A broken directory is skipped and reported; an
unsatisfied dependency refuses the whole set. See
[archive-plugin.md](archive-plugin.md) for why the two are separate calls.

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

## plugin::commands

What a plugin may ask the core to do.

Plugins are TypeScript; the heavy work is not. Scanning, hashing, archive
reading and database access are Rust, exposed as commands a plugin calls — so
the barrier to writing a plugin stays low without costing performance, because
a plugin is never the thing doing the scanning.

`ALLOWED` · `is_allowed(name)` · `lookup(name)` · `proposing()`

### The surface is a list, not a scattering of annotations

Every command a plugin can reach is one row in `ALLOWED`. Widening what plugins
can do is then a diff to one array.

Marking functions individually would work as well at runtime and much worse in
review: nobody notices one more annotation in a file of forty, and "what can a
plugin do?" would have no single place to answer it. `boundary.rs` confines
Tauri command attributes to `src/bridge/` and fails unless the set of them
equals this list, in both directions -- see [bridge.md](bridge.md).

What the list cannot say is what a command may do with its arguments. `hash.of`
is read-only, but nothing here stops it reading the whole disk; that check
lives in `bridge::library`.

Each row carries a `reason`. A command nobody can justify in a sentence is a
command that should not be on the list, and a test refuses an empty one.

### What is deliberately absent

**No command writes a value, an edge or a term.** The only `Propose` command is
`import.propose`: a plugin submits a document and a person reviews it. A plugin
quietly overwriting a decision is the failure change sets exist to prevent.

Nothing opens a file dialog, spawns a process, or reaches the network.
`docs.yml` says network access happens when the user presses a button, and a
plugin is not a button.

| command          | effect  |
|------------------|---------|
| `object.get`     | Read    |
| `object.list`    | Read    |
| `object.edges`   | Read    |
| `term.resolve`   | Read    |
| `term.list`      | Read    |
| `archive.list`   | Read    |
| `hash.of`        | Read    |
| `history.of`     | Read    |
| `import.propose` | Propose |
