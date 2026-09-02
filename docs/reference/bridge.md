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

`ObjectView` · `ValueView` · `EdgeView` · `TermView` · `HistoryView`

The store's row types have no serde derives, deliberately. `store::Edge`
describes a row in a table; a column added for an index is not a change to what
plugins are told. Converting is more typing and one fewer coupling.

`ObjectView` returns values under their **stored** paths, not flattened.
Flattening is a separate question with its own mount order, and a panel
rendering its own property's region wants `booth#1/title` rather than a winner.

## bridge::commands

Nine functions, each thin: parse, call the core function that already does the
work, convert the result.

| command          | calls                    |
|------------------|--------------------------|
| `object.get`     | `values::Values::rows`   |
| `object.list`    | `values::Values::rows`   |
| `object.edges`   | `edges::from`            |
| `term.resolve`   | `vocab::resolve`         |
| `term.list`      | `vocab::terms`           |
| `archive.list`   | `commands::archive::list`|
| `hash.of`        | `commands::hash::of_path`|
| `history.of`     | `history::of_object`     |
| `import.propose` | `changes::build::import` |

None of them holds logic of its own. A second copy of a rule behind an IPC
boundary is a copy that drifts where nobody is testing it.

`import.propose` is the only one that changes anything, and it does not decide
what lands: `changes::build::import` writes into empty fields and queues
anything that would overwrite an existing value as a change set for a person.
A plugin gets the same treatment as an AI import or another machine's export,
because they are the same kind of thing. The whole import runs in one
transaction.

`object.list` leaves out ids it cannot find rather than failing — a grid asking
for forty objects while one is being deleted should draw thirty-nine.
