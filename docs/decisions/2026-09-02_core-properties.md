# Core properties: reserved, few, and stored in their own tables

Date: 2026-09-02
Status: accepted

## Context

Objects carry values under namespaced paths, and any plugin may contribute a
property. That freedom is the point of the model, but a few things about an
object are not a plugin's to contribute: where it sits on disk, how large it
is, when it changed. The scanner needs those before any plugin is loaded.

An early sketch put the filesystem location in a dedicated column on `objects`.
That stopped working once an object was allowed to span several paths, and it
was the wrong shape anyway — it made "where is this" a special case rather than
a property like any other.

The opposite sketch made the path an ordinary property, `fs#1/path`. It reads
well and it supports zero, one or many locations for free. It also breaks in
three specific ways:

- The path competes in flattening, so a bare `path` field typed by the user, or
  a `path` contributed by some plugin, can shadow where the object actually is.
- The "one file belongs to one object" constraint becomes a partial unique
  index keyed on a path prefix, which hardcodes the reserved name into an index
  definition rather than into a table.
- `size` and `mtime` are integers. Stored as text in the value column, sorting
  by size orders `"9"` after `"100"`.

## Decision

There is a small, closed set of **core properties**. They use the same value
path syntax as any other property and appear through the same API, but they are
reserved: no plugin may declare one, and a user may change a core value but not
create a competing field with the same name. They are stored in their own
tables rather than in `values_`.

The set is one property:

| core property | fields                                | instances |
|---------------|---------------------------------------|-----------|
| `fs`          | `path` · `kind` · `size` · `mtime` · `hash` | 0..N |

That is the whole list.

## The test for admission

**Would the software fail to run without it?**

Not "is it important", not "does the core read it" — either of those can be
argued into admitting anything. Without `fs` the scanner has nothing to scan,
reconcile cannot tell a moved file from a new one, and "open in explorer" has
no target. The application does not work.

Two things that look like candidates and are not:

- `title` — without it the UI shows the basename of the first path. The
  application works, so `title` is an ordinary property that plugins may
  contribute values for and users may edit freely.
- `primary_property`, which decides who draws an object's detail page —
  without it the page falls back to the framework's default layout. The
  application works, so this is a plain column on `objects` and not a core
  property.

Admitting a core property means changing the core, and it goes through a
decision record. The value of the test is that it is strict enough to refuse
things.

## Why a separate table rather than values_

Core properties are exactly the values that need what an EAV table cannot give:
a real unique constraint (one disk path belongs to one object), real types
(`size` and `mtime` are integers), and an index on the scanner's hot lookup
(path to object).

So: **one interface, two implementations.** Plugins, the UI, flattening and
export all see properties. Storage routes the closed core set to typed tables
and everything else to `values_`. This is the ordinary mixed model — hot,
constrained fields get columns, open-ended fields get key-value rows — and it
is safe here precisely because the core set is closed and small. An open set
routed this way would be two mechanisms competing; a closed set of one is a
schema with an escape hatch.

## Why the reserved list is not a hardcoding violation

`~/.claude/CLAUDE.md` forbids enumerated lists baked into logic where data
should drive the shape. The reserved list is not data — it is the core's own
schema, the same kind of thing as a language's keyword table. It changes with
the core version, never with a user's library.

The rule is aimed at something else, and the thing it is aimed at would look
like `if namespace == "vrchat"` appearing in core code. That remains banned,
and the boundary test in `src-tauri/tests/boundary.rs` catches it.

## Consequences

`fs` having instances is what lets an object sit at no path, one path, or
several. `kind`, `size`, `mtime` and `hash` hang on the instance rather than on
the object, because they describe a location and an object may have more than
one. See `2026-09-02_objects-may-span-paths.md`.

Reserving the names gives a second line of defence behind a mechanism that
already covers most of it: fields do not compete by default
(`2026-09-02_fields-have-sources-not-winners.md`), so nothing would shadow
`fs#1/path` even without the reservation. Two independent guarantees, which is
appropriate for the one property the scanner cannot work without.

A plugin wanting to record a path of its own — a Unity project location, an
export target — names it under its own namespace, `unity#1/path`. That was
always the right shape for it.
