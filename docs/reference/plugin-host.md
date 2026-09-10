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

## plugin-host/picker

`choosable(plugins)` · `formsFor(plugins, chosen, order)`

What a new object can be, and who asks for the rest.

### Arbitration runs the other way round

Every function in `slots` starts from what an object carries. Here there is no
object: the choice is what will decide the properties. Two of `collect`'s three
arguments would be empty by definition, which is why this is its own module
rather than another pass over the same shape.

### A type is a semantic property

Nothing here is a new vocabulary. `choosable` returns the properties plugins
declare, minus anything named in some plugin's `file_types` — those are factual,
attached because a `.pdf` is a pdf, and offering one would invite marking a
`.docx` as a pdf and getting a viewer that cannot read it.

The distinction is derived, not declared. A manifest field saying "this one is
semantic" could disagree with the `file_types` entry beside it.

### A domain is the dot already in the name

`vrchat.booth` sits under `vrchat` because
[`2026-09-01_object-property-model.md`](../decisions/2026-09-01_object-property-model.md)
made nested sub-types property names containing a dot, and storage has parsed
them since. `Choice.path` is that name split, precomputed so grouping does not
split strings in a render loop.

The list is sorted by property name, which puts a sub-type next to what it
extends and keeps the order stable across runs.

### Ordering is mount order

`formsFor` sorts by the library's mount order, the same rule every other slot
uses. A second priority list would give the user two places to manage one thing.

A chosen property the library has never mounted sorts **last** rather than being
dropped. The first object to be a paper is exactly when its form matters, and
that is before anything mounted `paper`. Only instance 1 contributes a rank: a
new object carries the first instance, and ranking on a `booth#2` that does not
exist yet would order the forms by nothing.

### Today it returns nothing

The three built-in plugins declare only factual properties — `archive` from
`.zip`, `pdf` from `.pdf`, and the explorer declares none at all. So the picker
is empty until a plugin ships a semantic property, which is what the
architecture predicts: the software never guesses that something is a paper, and
no built-in claims to know.

## plugin-host/loader

`modulesOf(manifest)` · `load(manifest, resolve)` · `loadAll(manifests, resolve)`

Panels, viewers and forms are module specifiers. Actions and columns are ids
the plugin already holds, so `modulesOf` returns only the three, deduplicated —
one component keyed to two properties runs its top-level code once. The library
action module is a fourth, not keyed by property.

A slot whose module is never collected here parses, appears in arbitration and
draws nothing, so a test names the manifest fields that carry specifiers rather
than trusting the list to stay in step.

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
