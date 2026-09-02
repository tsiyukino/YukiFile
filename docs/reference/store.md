# store

Objects, the values hung on them, the edges between them, and the vocabularies
those edges point at.

Two modules exist so far. Both are pure: they take what they need as arguments
and touch no database, no filesystem and no clock.

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

`Empty` · `TooManySegments` · `BadInstance` · `InstanceOnField`

Implements `Display` and `std::error::Error`.

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

`booth#1/title` becomes a source for `title`. `booth#1/item_id`, undeclared, is
read through its full path — `flat.value("booth#1/item_id")` — and never
appears under `item_id`.

`Mount::isolated(namespace, instance)` builds a mount sharing nothing.

Grouping is implicit: two plugins declaring the same string contribute to the
same field, with no central registry.

### Pins

A pin overrides mount order for one field on one object:

```text
@pin/cover  =  "gumroad#1"
```

It reorders rather than discards — the other sources stay in the list, so the
detail page can still show them. A pin naming a source that is not mounted is
ignored and the field falls through to mount order; it is not an error and not
deleted, so reinstalling the plugin restores the choice.

`PIN_NAMESPACE` is the reserved namespace (`@pin`). Pins never appear as fields
of their own in the result.

### `FlatView<'a>`

| method            | returns                         | use                                |
|-------------------|---------------------------------|------------------------------------|
| `value(field)`    | `Option<&'a str>`               | the first value — search, sort, export |
| `primary(field)`  | `Option<&Source<'a>>`           | the first source, with its origin  |
| `sources(field)`  | `&[Source<'a>]`                 | every source, best first           |
| `fields()`        | `impl Iterator<Item = &'a str>` | fields that resolved to something  |
| `skipped()`       | `&[Skipped<'a>]`                | values that could not be placed    |
| `is_empty()`      | `bool`                          | nothing resolved                   |

Keeping every source is what lets the frontend show the local title large with
the shop titles underneath, or offer whichever of two prices is lower, without a
second implementation of the ranking rule living over there.

### `Skipped<'a>` and `SkipReason`

`Skipped { path: &'a str, reason: SkipReason }`

| reason                  | meaning                                           |
|-------------------------|---------------------------------------------------|
| `NotMounted`            | routine — a plugin that is not installed wrote it  |
| `Malformed(ParseError)` | corruption — surface it                            |

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

## Not yet written

`schema` · `values` · `edges` · `vocab` · `history`
