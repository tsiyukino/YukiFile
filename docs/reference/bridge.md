# bridge

Where `plugin::commands::ALLOWED` becomes callable code.

The allowlist names what a plugin may ask for. This module is the other half:
each row there has exactly one `#[tauri::command]` function here, and a test
fails if either side gains or loses one.

## Why annotations live only here

`tests/boundary.rs` originally refused `#[tauri::command]` anywhere in the
core, so that "what can a plugin do?" had one answer. Wiring commands has to
write that annotation somewhere, so the rule became narrower **and** stricter:

| before | now |
|--------|-----|
| no annotation anywhere under `src/` | annotations only under `src/bridge/` |
| — | the set of them must *equal* the allowlist |

Confining them is what makes the correspondence checkable — a set that can be
enumerated can be compared, one scattered across the tree cannot. Both
directions fail loudly:

- **listed, not implemented** — a documented capability that errors at runtime
- **implemented, not listed** — a capability nobody reviewed

`handler_name("object.get")` is `"object_get"`. The mapping is a `replace`,
not a table somebody maintains, so a command cannot be listed under one name
and implemented under another.

## Two lists, not one

`ALLOWED` is what plugins may call. `APP_ONLY` is what only the application
itself may call, reachable from its own UI and never from a plugin's `Api`.

The split was forced by a test rather than chosen in advance. `library.scan`
was written onto `ALLOWED` first, and `no_command_writes_directly` refused it:
a scan writes objects and paths without review, which the plugin surface
forbids. Routing a scan through change-set review is not the answer either — a
scan importing 1518 objects is not 1518 edits, and asking a person to approve
each would make the first run of the application its worst experience.

So the question is who is asking. `docs.yml` already draws this line for the
network: access happens when the user presses a button, and a plugin is not a
button. `APP_ONLY` is the same rule applied to the filesystem.

Both lists are checked the same way. Every `#[tauri::command]` must be on
exactly one of them, in both directions, and `commands.test.ts` additionally
asserts that no `APP_ONLY` command is reachable from `apiFor`.

| command          | list     | effect |
|------------------|----------|--------|
| `object.create`  | APP_ONLY | Write  |
| `object.forget`  | APP_ONLY | Write  |

`library.scan` was the first row here and is gone: deciding what counts as an
object turned out to be domain knowledge the core has none of, so the
capability stopped existing rather than moving lists. What sits here now is the
writing a person does through the application's own interface.

### Object ids cross as strings

Ids are 62 bits — time in the high bits so inserts land at the right of the
B-tree, randomness in the low so two machines can merge without colliding. A
JavaScript number holds 53.

Sent as a number, `3750587936530965241` arrives as `3750587936530965000`, and
the next lookup fails with "no such object". Nothing in that message points at
rounding, which is what made it worth fixing at the boundary rather than
documenting as a caveat.

So ids serialise as strings and commands take them as strings, parsing at the
edge. Narrowing the ids themselves would have traded a boundary detail for a
real constraint on the store.

## bridge::objects

`object_create_in(library, new)` · `object_forget_in(library, id)`

Making and unmaking objects on somebody's say-so. Separate from
`bridge::commands` because a read is a read and a write has to be atomic,
refusable, and reversible.

### What an object is comes from the person

`properties` is a list. An object is what its properties say it is, plural — a
PDF can be a paper and a VRChat asset at once, and each contributes its own
fields. The core attaches what it is handed and interprets none of the names.

Choosing a property also mounts it. Nothing draws a region for a property the
library does not mount, so the first object to be a paper would otherwise never
show its own form's values.

`paths` may be empty, which makes a grouping. That is a normal thing to make and
not a special case: an object with no location is one whose properties say what
it is, same as any other.

### Values arrive nested by property

```
values: { "paper": { "doi": "10.1000/x" } }   →   paper#1/doi
shared: { "title": "A paper" }                →   title
```

The core writes the namespaced path itself. A flat map would put the spelling of
`paper#1/doi` in the caller's hands, and a form returning a bare `doi` would land
in the shared field space — which is what property namespaces exist to prevent.
Values for a property the object was not given are refused rather than written
somewhere nothing draws.

A property name that is not one is refused by `store::carried`, which asks
`store::path::is_namespace`. `paper#1` with instance 1 would spell `paper#1#1`,
which parses as nothing: no region draws it and no skip list mentions it, since
that list is built from values and a property chosen with an empty form has
none.

### One transaction

A half-made object — properties attached, values missing — is worse than no
object, because nothing in the library says which half ran. A refused create
leaves the object count unchanged, which is asserted rather than assumed.

### Creating writes no history

`store::history` is written by `changes::apply`, when an accepted change set
overwrites a field that already held something. Creation writes only empty
fields, so there is nothing to record an old value for.

That matches what the architecture says about a scan importing 1518 objects:
"not 1518 edits; it is those fields existing for the first time." Editing an
object afterwards is a different question, and the command for it does not exist
yet.

### The path has to be there

`Library::resolve` canonicalises, which is what confines it, and a path that is
not on disk cannot be canonicalised. So adding one that is not there comes back
as `NotFound`.

That is the opposite of the import contract, deliberately: an import may describe
a library somebody is about to copy in, while a person clicking "add" is looking
at the thing. `kind` still comes from the caller, because the disk browser
already walked and knows.

A path another object holds comes back as `PathTaken` naming it. The raw failure
is `UNIQUE constraint failed: object_paths.path`, which would tell somebody
adding a folder that the database is broken.

### Forgetting

`object.forget` removes an object and everything hung on it, through one delete
and the schema's cascades. The files on disk are untouched — this manages what
it knows about things, not the things.

It exists because a library where every mistake is permanent is one nobody will
risk organising. Forgetting frees the path it held, so a mis-click can be redone
properly.

## bridge::library

`Library::new(root, connection)` · `resolve(path)` · `with_connection` ·
`with_connection_mut`

### Confining paths is the bridge's job, not the allowlist's

The list says `archive.list` and `hash.of` only read. What a list cannot say is
*what* they may read, and plugins are TypeScript passing strings. Without the
check here, "read-only" would mean read-only access to the whole disk through a
command whose stated reason is listing a zip.

Every path a plugin names is joined to the library root, **canonicalised**, and
refused unless the result is still under the root. Four things make that hold,
and each is one mutation away from being decorative:

| the check | what it catches |
|-----------|------------------|
| resolve before comparing | `sub/../../elsewhere`, and symlinks out |
| canonicalise the root too | otherwise the two sides are never comparable |
| `Path::starts_with`, not string | `library_other/` is not inside `library/` |
| refuse Windows prefixes early | `C:file` discards the root when joined |

The prefix check is the subtle one: containment would refuse `C:Windows`
anyway, once resolved. Refusing it earlier keeps the answer from depending on
whether the file exists — with only the late check, a missing target reports
`NotFound` and an existing one reports `OutsideLibrary`, and the difference
tells a plugin what sits on the user's other drives.

Refusals repeat the path the plugin sent, never the resolved one. A plugin has
no business learning where the library sits.

`with_connection_mut` is separate from `with_connection` because
`schema::in_transaction` needs `&mut Connection`, and handing every reader a
mutable borrow would let a read open a transaction by accident.

## bridge::error

`BridgeError` — one flat enum, `Serialize`.

Tauri requires a command's error to serialise. The core's error types do not,
and adding derives would push a serialization concern into `store` and
`commands`, which have no business knowing they are ever spoken to over IPC.
The bridge collapses them instead, so the dependency points one way.

Messages are written for a plugin author deciding what to do next — "the file
is not an archive" — not for tracing which layer noticed. They never carry the
underlying `io::Error` text, which names absolute paths on the user's disk.

## bridge::views

`ObjectView` · `ValueView` · `EdgeView` · `TermView` · `HistoryView` ·
`FlatObjectView` · `SourceView` · `RegionView` · `SkippedView`

The store's row types have no serde derives, deliberately. `store::Edge`
describes a row in a table; a column added for an index is not a change to what
plugins are told. Converting is more typing and one fewer coupling.

`ObjectView` returns values under their **stored** paths, not flattened.
Flattening is a separate question with its own mount order, and a panel
rendering its own property's region wants `booth#1/title` rather than a winner.

## bridge::commands

Thirteen functions, each thin: parse, call the core function that already does the
work, convert the result.

| command          | calls                    |
|------------------|--------------------------|
| `object.get`     | `values::Values::rows`   |
| `object.list`    | `values::Values::rows`   |
| `object.flat`    | `store::flatten::flatten`|
| `object.ids`     | `values::object_ids`     |
| `plugin.list`    | `Registry::plugins`      |
| `mount.order`    | `values::mount_order`    |
| `object.edges`   | `edges::from`            |
| `term.resolve`   | `vocab::resolve`         |
| `term.list`      | `vocab::terms`           |
| `archive.list`   | `commands::archive::list`|
| `hash.of`        | `commands::hash::of_path`|
| `history.of`     | `history::of_object`     |
| `import.propose` | `changes::build::import` |

None of them holds logic of its own. A second copy of a rule behind an IPC
boundary is a copy that drifts where nobody is testing it.

### object.flat resolves; object.get does not

`object.get` hands back values under their stored paths (`booth#1/title`).
`object.flat` hands back the resolved view: shared fields with every source
ranked, private fields grouped by the region that owns them.

Resolution runs here rather than in TypeScript because search, sort and export
all need the same answer, and two implementations of one rule drift apart. The
object page is only the first caller.

**Which fields are shared comes from the manifests.** `values::mount_order`
reads the mounts table, which holds no opinion about sharing -- it predates the
plugin host. `Registry::shared_fields` does hold that opinion, because each
manifest declares it. Joining the two in this command is what makes
`booth#1/title` a source for `title` rather than a field Booth keeps to itself.

Without a registry every field stays private. That is the safe reading of "no
manifest has said otherwise" rather than a degraded mode: a library running no
plugins has nothing that could be sharing a name.

Shared and private stay apart across the boundary. Merging them here and
splitting again in TypeScript by looking for a `/` would hand back a job
`flatten` already did.

A value under a property this library does not mount is **not** reported in
`skipped`. An object may carry values written by a plugin that is not
installed, and they wait in storage until it is; a permanent warning on healthy
objects is a warning nobody reads. Malformed paths and pins that cannot take
effect are reported, because those are defects.

### Browsing is paged, and the cap is the bridge's

`object.ids` takes the last id seen rather than a page number: a number drifts
as objects are added, and a grid that skipped an object because one arrived
mid-scroll is wrong in a way nobody reports. Ordering is by id, because
anything a person would rather sort by is a value, and values are resolved
rather than stored in a column.

The limit is clamped here and not in the store. The store may read what it
likes; a plugin may not ask for a 1518-object library in one call. A limit of
zero is clamped up rather than honoured — a caller asking for nothing is asking
by mistake, and an empty page reads as "the library is empty".

`plugin.list` and `mount.order` exist because slot arbitration runs in the
frontend. The manifests are read from disk in Rust at startup and the mount
order lives in the database; neither is reachable from TypeScript otherwise.

`MountView` deliberately omits the `shared` list. Which fields are shared comes
from the manifests, which `plugin.list` already returned — sending it twice
would give the frontend two answers to keep in step.

`import.propose` is the only one that changes anything, and it does not decide
what lands: `changes::build::import` writes into empty fields and queues
anything that would overwrite an existing value as a change set for a person.
A plugin gets the same treatment as an AI import or another machine's export,
because they are the same kind of thing. The whole import runs in one
transaction.

`object.list` leaves out ids it cannot find rather than failing — a grid asking
for forty objects while one is being deleted should draw thirty-nine.
