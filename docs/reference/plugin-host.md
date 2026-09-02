# plugin-host

The TypeScript half of the plugin system: what renders where, and how a
plugin's modules get fetched.

The Rust `plugin` module decides *which* plugins load and in what order. This
one takes that settled answer and asks the next questions — for this object,
what goes in each slot, and where does the code for it come from.

## plugin-host/types

The shape of a manifest as JSON, and nothing else.

`Manifest` · `Contributes` · `Requires` · `PropertyInstance` · `bareName()`

**No validation lives here.** `plugin::manifest` refuses a bad id, a reserved
property and an unscoped contribution; `plugin::registry` refuses duplicates,
unsatisfied requirements and cycles. A manifest reaching TypeScript has been
through all of it.

Repeating those checks would put one rule in two languages, and two copies of a
rule drift. The day they disagree the disagreement is silent: one side loads a
plugin the other rejected, and the symptom appears somewhere else entirely.

`bareName("booth#1")` is `"booth"`. Contributions are keyed by the bare name;
objects carry instances.

## plugin-host/slots

`panelsFor` · `viewersFor` · `actionsFor` · `columnsFor`

Each takes the same three arguments and returns `Contribution[]`:

| argument  | is                                                    |
|-----------|-------------------------------------------------------|
| `plugins` | the manifests, in the registry's load order            |
| `carried` | the property instances this object has (`booth#1`)     |
| `order`   | the library's mount order, as `{ namespace, instance }`|

Pure functions of their arguments — no registry, no store, no window. The same
question is asked from the object page, the context menu, the command palette
and the grid header, and a stateful arbiter would answer them differently
depending on what was loaded when.

### The three rules

**Visibility** is whether the object carries the property. One rule, every
slot; panels, actions and columns need no separate treatment.

**Ordering** is mount order. Two plugins scoped to `booth` and `gumroad` are
ordered by which the library mounts first — reusing a decision the user already
made in a place they can see it, rather than inventing a second priority list
per slot. Manifest order decides nothing on its own.

**Placement** requires being scoped to the property. A plugin that neither
declares nor requires it contributes nothing there, even holding a
contribution keyed to it. Within one property the definer comes before anyone
who merely requires it: a price comparison sits after the shop it compares.

### Instances

Mount order ranks property *instances*. An object carrying `booth#1` and
`booth#2` gets a panel for each, ordered by where the library mounts each one;
an instance the library does not mount contributes nothing.

A counter has to be the canonical spelling of its number. `booth#01` is all
digits and reads as 1, so a laxer check lets it match the mount key for
`booth#1` and draw a second panel over the first — one listing rendered twice.
Round-tripping the number through `String()` rules that out, along with `1.0`,
`1e0` and `+1`. A bare `booth` means instance 1.

`columnsFor` collapses duplicates, because a grid header is drawn once for many
objects; two objects both carrying `booth#1` offer that column once. A *second
instance* is not a duplicate — two Booth listings are two prices.

## plugin-host/loader

`modulesOf(manifest)` · `load(manifest, resolve)` · `loadAll(manifests, resolve)`

Panels and viewers are module specifiers. Actions and columns are ids the
plugin already holds, so `modulesOf` returns only the first two, deduplicated —
one component keyed to two properties runs its top-level code once.

### Resolution is injected

`load` takes a `Resolve = (specifier: string) => Promise<unknown>` rather than
calling `import()` itself. Dynamic import ties the loader to a bundler and a
filesystem, so testing it would mean mocking the module system — and a loader
that can only be exercised through its own machinery is one whose failure paths
never get exercised. Production passes `(s) => import(s)`; tests pass a map.

### A broken module is not a broken library

`Registry::load` is all or nothing: a set with an unsatisfied requirement does
not load, because a partly loaded set is a library where some objects have
panels and others do not for reasons nobody can see.

The loader is the opposite, and the asymmetry is the point. By the time
anything reaches it the set has been checked; what can still fail is one module
failing to fetch or parse. Refusing to start over that would let any plugin
author take the application down with a typo. The broken contribution is left
out and reported in `Loaded.failures`, with the slot, the property, the
specifier and a reason.

A resolver returning `undefined` counts as a failure. Left unchecked it reaches
a slot as an undefined component and the error surfaces at render time pointing
at the wrong place. A thrown non-`Error` is stringified rather than read for a
`.message` that is not there.

`loadAll` preserves the order it was given, which is the registry's load order.
Recomputing it here would be a second answer to a settled question.
