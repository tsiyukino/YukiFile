# store

Objects, the values hung on them, the edges between them, and the vocabularies
those edges point at.

Five modules exist so far. `path` and `flatten` are pure — they take what they
need as arguments and touch no database, no filesystem and no clock. `schema`
owns the database, `id` owns the clock and the randomness, and `values` is the
one that reads and writes.

## store::path

The syntax of a value path. Three shapes occur:

```text
title                  a bare field, entered by the user
booth#1/title          a field under one mounted property instance
vrchat.clothing/parts  a property whose type name contains a dot
```

### `ValuePath<'a>`

A parsed path, borrowing from the input rather than allocating.

| field       | type                | meaning                                      |
|-------------|---------------------|----------------------------------------------|
| `namespace` | `Option<&'a str>`   | the owning property, `None` for a bare field |
| `instance`  | `Option<u32>`       | which mount, `None` for a bare field         |
| `field`     | `&'a str`           | the field name, never empty                  |

`ValuePath::parse(&'a str) -> Result<ValuePath<'a>, ParseError>`

`ValuePath::is_bare(&self) -> bool` — true when no property owns the value.

`impl Display` round-trips through `parse`, with one normalisation: a namespace
written without a counter is written back with one, so `booth/title` is stored
as `booth#1/title`. That matters beyond tidiness — the `values_` primary key is
`(object_id, field_path)`, and two spellings of one path would slip past it.

A dot binds tighter than the separator: `vrchat.clothing` is one namespace, not
a nested path.

### `MountRef<'a>`

A reference to one mounted property instance — `booth#1`, with no field. This
is what a pin holds, since a pin names a source rather than a value.

`MountRef::parse(&'a str) -> Result<MountRef<'a>, ParseError>`

`impl Display` writes the instance out, like `ValuePath`.

The two types do not parse each other's input: `MountRef::parse("booth#1/title")`
and `ValuePath::parse("booth#1")` both fail. They are different shapes and
conflating them silently drops data.

### `ParseError`

`Empty` · `TooManySegments` · `BadInstance` · `InstanceOnField` · `NotAName`

Implements `Display` and `std::error::Error`.

Namespaces and fields must be non-empty and free of whitespace. Without that
rule anything at all parses as a namespace, and a corrupt pin target reads as a
plugin nobody installed rather than as junk. `.` and `@` stay legal — property
type names contain dots (`vrchat.clothing`) and the reserved namespaces start
with `@` (`@pin`).

## store::flatten

Resolving one object's stored values into the sources for each field.

A product sold on two shops has three titles and all of them are true.
Resolution does not pick one and discard the rest; it returns the sources for a
field, best first. Anything needing a single value takes the first. Nothing is
named for winning, because nothing loses.

`flatten<'a>(values: &'a [StoredValue], mounts: &[Mount<'a>]) -> FlatView<'a>`

Mount order is an argument rather than configuration read inside, which keeps
the function pure. It ranks property **instances**, not property names — an
object carrying both `booth#1` and `booth#2` needs the two ranked — and it
belongs to the library, so the caller passes the order of the library being
read.

Empty values are dropped rather than ranked: a blank is the absence of a value,
not a source that happens to be short.

### The ranking

```
pinned source  <  bare field  <  first mount  <  second mount  <  ...
```

No two ranks may share a value. A tie hands the decision to whatever order the
database returned rows in, which is not a decision anyone made.

### Sharing

Fields do not compete by default. A `Mount` carries the `shared` list its plugin
declared, and only those fields join the sources for a bare name:

```rust
Mount { namespace: "booth", instance: 1, shared: &["title", "price"] }
```

`booth#1/title` becomes a source for `title`. `booth#1/item_id`, undeclared,
stays Booth's own: it is read through `flat.plugin_value(("booth", 1),
"item_id")` and never appears under `item_id`.

`Mount::isolated(namespace, instance)` builds a mount sharing nothing.

Grouping is implicit: two plugins declaring the same string contribute to the
same field, with no central registry.

### Pins

A pin overrides mount order for one field on one object:

```text
@pin/cover  =  "gumroad#1"
```

It reorders rather than discards — the other sources stay in the list, so the
detail page can still show them.

A pin that cannot act is reported through `skipped()` rather than ignored. A
pin is a deliberate write; accepting it, storing it and then never applying it
without a word is the same failure malformed paths used to have. Two ways it
can miss: the target plugin is gone (`PinNotMounted`), or the target is mounted
but does not share that field, so there is no ordering to override
(`PinOnUnsharedField`). Neither is deleted, so the choice returns when the
plugin does.

`PIN_NAMESPACE` is the reserved namespace (`@pin`). Pins never appear as fields
of their own in the result.

### `FlatView<'a>`

Shared fields and plugin-private fields are held apart rather than sharing one
key space. The framework's object page renders them differently — a shared
field is one row with its sources listed, a private field belongs inside its
plugin's region — and deciding which is which by looking for a `/` in a string
would hand back a job this module already did.

Shared fields, addressed by bare name:

| method            | returns                         | use                                |
|-------------------|---------------------------------|------------------------------------|
| `value(field)`    | `Option<&'a str>`               | the first value — search, sort, export |
| `primary(field)`  | `Option<&Source<'a>>`           | the first source, with its origin  |
| `sources(field)`  | `&[Source<'a>]`                 | every source, best first           |
| `fields()`        | `impl Iterator<Item = &'a str>` | shared fields that resolved        |

Private fields, addressed by the mount that owns them
(`MountKey<'a> = (&'a str, u32)`):

| method                        | returns                                  |
|-------------------------------|------------------------------------------|
| `plugin_value(mount, field)`  | `Option<&'a str>`                        |
| `plugin_fields(mount)`        | `impl Iterator<Item = (&'a str, &'a str)>` |
| `plugin_mounts()`             | `impl Iterator<Item = MountKey<'a>>`     |

And for both: `skipped()` returns what could not be placed, `is_empty()` is
true when neither kind resolved.

Keeping every source is what lets the frontend show the local title large with
the shop titles underneath, or offer whichever of two prices is lower, without a
second implementation of the ranking rule living over there.

### `Skipped<'a>` and `SkipReason`

`Skipped { path: &'a str, reason: SkipReason }`

| reason                  | meaning                                            |
|-------------------------|----------------------------------------------------|
| `NotMounted`            | routine — a plugin that is not installed wrote it   |
| `Malformed(ParseError)` | corruption — surface it                             |
| `PinNotMounted`         | a pin whose target plugin is gone                   |
| `PinOnUnsharedField`    | a pin on a field its target does not share          |

An unmounted property is expected: an object can carry values written by a
plugin that is not installed right now, and they must not surface as if they
were current. They stay in storage, so installing the plugin brings them back.

A malformed path is not expected. The import contract and plugins both write
that column, so nothing on the write side rules it out, and a caller that never
hears about it will never find the defect. Neither kind of skip stops the rest
of the object from resolving — one bad row must not take down a library view.

### Supporting types

| type            | shape                                                              |
|-----------------|--------------------------------------------------------------------|
| `StoredValue`   | `{ path: String, value: String }`, one `values_` row                |
| `Mount<'a>`     | `{ namespace, instance, shared: &[&str] }`, in mount order          |
| `Origin<'a>`    | `Bare` or `Mounted { namespace, instance }`                         |
| `Source<'a>`    | `{ value: &'a str, origin: Origin<'a> }`                            |

`Origin` is carried through so the UI can show that a title came from a shop
rather than from the user, and so change review can scope a diff to
`booth#1/price` rather than to the whole object.

## store::schema

The tables and their migrations. One library is one database file, so there is
no `libraries` table — mount order and everything else belongs to the library
the file is in.

`open(&Path) -> Result<Connection>` · `open_in_memory() -> Result<Connection>`

**Every connection goes through one of these.** `foreign_keys` is a
per-connection setting that SQLite does not store in the file, so a connection
opened any other way has no foreign keys and no cascades: rows pointing at
deleted objects simply stay. Setting it during migration is not enough, since
migration runs on one connection and the application then uses others.

`migrate(&mut Connection) -> Result<()>` · `latest_version() -> i64`

Migrations exist from v1 even though there is only one, because building the
mechanism at the moment it is first needed means inventing how to change the
schema while changing it. Layer 3 adds the change set tables as v2. Each
migration runs in its own transaction, so a failure leaves the database at the
last version that fully applied.

### Tables

| table          | holds                                                        |
|----------------|--------------------------------------------------------------|
| `objects`      | identity, and `primary_property` (unread in v1)              |
| `object_paths` | where an object sits on disk — 0..N rows, `path` unique      |
| `values_`      | values under field paths, keyed `(object_id, field_path)`    |
| `mounts`       | this library's property instance order                       |
| `terms`        | vocabulary terms, keyed `(vocab, id)`                        |
| `aliases`      | surface forms collapsing to a term                           |
| `edges`        | one table, one `kind` column, target is an object or a term  |
| `history`      | field-level changes, grouped by `batch`                      |

`field_path` rather than `path` in `values_`: one is where a value hangs on an
object, the other is where the object sits on disk, and two things called
`path` in one join is how someone writes the wrong query and gets rows back.

`kind`, `size`, `mtime` and `hash` hang on the location, not the object — an
object holding a folder and a zip has no single answer to "is it a file".
`hash` is null until computed, so reconcile must cope with null rather than
assume every row has one.

### What the database enforces

| guarantee                                   | mechanism                    |
|---------------------------------------------|------------------------------|
| one file belongs to one object              | `object_paths.path UNIQUE`   |
| one field holds one value                   | `values_` primary key        |
| an edge targets an object **or** a term     | `CHECK` on `edges`           |
| no edge outlives its target                 | foreign keys + `ON DELETE CASCADE` |
| an object id is never a string              | `STRICT` tables              |
| "what fits Manuka?" is one index hit        | `edges_by_term`              |

`edges.kind` is free text: the core does not enumerate valid edge kinds, so a
plugin adding `cites` or `remixes` needs no schema change.

## store::id

Object identifiers: 64-bit, time-ordered, and derived from nothing.

```text
 63   62        21 20       0
[sign][ milliseconds ][ random ]
```

An id says nothing about the object. The seed library's own history is 174
products being moved between folders, and an identity that changes on move
loses every value and edge attached to it — so neither the path nor the content
can be the key.

Time in the high bits keeps a scan's thousand inserts landing at the right of
the B-tree rather than scattering it. Randomness in the low bits is what lets
two machines merge libraries without a rewrite, which the import contract
needs; a sequential counter would collide on every row.

42 timestamp bits run to 2109. 41 would have run out in 2039, which is not a
lifetime for a library meant to be kept.

`IdGenerator::new()` · `IdGenerator::with(clock, entropy)` · `next() -> i64`

`timestamp_of(id) -> u64` recovers the millisecond, for debugging.

### Collisions are expected

21 random bits is about two million values per millisecond. A scan inserting a
thousand objects puts them all in one millisecond, so birthday maths gives
roughly a one-in-five chance of a collision somewhere in the batch.

That is designed for rather than prevented: **the primary key is the guarantee,
and the caller retries on violation.** Retrying belongs to the caller because it
means knowing an insert failed, and this module has no database. A test asserts
collisions stay rare rather than absent — asserting they never happen would be
asserting the documented behaviour does not occur.

### `Clock` and `Entropy`

Both are traits with system implementations (`SystemClock`, `SystemEntropy`).
They are injectable so the collision path is reachable in a test; a generator
reading the clock directly could only be tested by waiting.

`SystemEntropy` is xorshift seeded from `RandomState`, not a cryptographic
generator. Ids are not secrets, and the property needed is spread within a
millisecond rather than unpredictability.

Both halves are masked when composed, so a clock past 2109 or an `Entropy`
returning more bits than the tail holds cannot corrupt the other half or push
an id negative. SQLite integers are signed, and a negative id would sort before
every existing row.

## store::values

Objects and the values hung on them. The first module that touches the
database: it creates objects, normalises paths going in, and hands rows to
`flatten` coming out.

It decides no policy. Writing into an empty field just happens; overwriting a
field that already holds something different is **reported, not applied**. What
to do about that — a reviewable change set — belongs to a layer that knows what
a change set is, and keeping the decision out of here is what lets one write
path serve an AI import, another machine's export and a shop fetch without
knowing which it is serving.

`Values::new()` · `Values::with_ids(generator)` — the second takes an injected
generator so a test can force an id collision.

| method                                  | does                                       |
|-----------------------------------------|--------------------------------------------|
| `create_object(&conn)`                  | new object, retrying past an id collision  |
| `set(&conn, object, path, value)`       | write into an empty field, else conflict   |
| `overwrite(&conn, object, path, value)` | write regardless — for an accepted change  |
| `get(&conn, object, path)`              | one stored value, by exact path            |
| `rows(&conn, object)`                   | every stored value, unresolved             |

`view(&rows, &mounts) -> FlatView` resolves. It is free rather than a method
because it needs no generator, and the borrow makes the lifetime plain: the
view points into the rows.

`mount_order(&conn) -> Vec<(String, u32)>` reads this library's order. The
shared-field list is not stored with it — that comes from each plugin's
manifest, which the plugin host owns.

### `Written` and `WriteError`

`Written` says what happened: `Added` · `Unchanged` · `Replaced` · `Cleared`.
An empty value clears the field rather than storing a blank, since a blank is
the absence of a value and would leave a row resolution has to skip anyway.

`WriteError::Conflict { existing, incoming }` carries both values, which is
what the layer above turns into a change set entry. The others are `BadPath`,
`NoSuchObject` and `Database`.

### Path normalisation and id retries

Paths are normalised on the way in, so `booth/title` and `booth#1/title` cannot
both exist naming one value — the primary key compares strings, and without
this it would not catch them.

`create_object` retries a colliding id three times and then fails. Ids carry a
random tail, so two objects made in the same millisecond can draw the same one
and the primary key catches it. Retrying forever would turn a broken generator
into a hang instead of an error.

## Not yet written

`values` · `edges` · `vocab` · `history` — the modules that read and write
these tables.
