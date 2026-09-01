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
as `booth#1/title` and the two spellings cannot both name one value.

A dot binds tighter than the separator: `vrchat.clothing` is one namespace, not
a nested path.

### `ParseError`

`Empty` · `TooManySegments` · `BadInstance` · `InstanceOnField`

Implements `Display` and `std::error::Error`.

## store::flatten

Ranking the stored values of one object into candidates per field.

The rule: a bare field wins if it has a value; otherwise the first non-empty
same-named field in mount order takes it.

`flatten<'a>(values: &'a [StoredValue], mounts: &[Mount<'a>]) -> FlatView<'a>`

Mount order is an argument rather than configuration read inside, which is what
keeps the function pure. It ranks property **instances**, not property names —
an object carrying both `booth#1` and `booth#2` needs the two ranked against
each other — and the order belongs to the library, so the caller passes the one
belonging to the library being read.

Empty values are dropped rather than ranked: a blank is the absence of a value,
not a candidate that happens to be short.

### `FlatView<'a>`

Holds every candidate per field, best first, plus what could not be placed.

| method                | returns                    | use                                     |
|-----------------------|----------------------------|-----------------------------------------|
| `value(field)`        | `Option<&'a str>`          | the winning value — search, sort, export |
| `winner(field)`       | `Option<&Resolved<'a>>`    | the winner with its origin               |
| `candidates(field)`   | `&[Resolved<'a>]`          | every candidate, best first              |
| `fields()`            | `impl Iterator<Item = &'a str>` | fields that resolved to something   |
| `skipped()`           | `&[Skipped<'a>]`           | values that could not be placed          |
| `is_empty()`          | `bool`                     | no field resolved                        |

Keeping the losers is what lets the frontend show the local title large with
the shop title underneath, or offer whichever of two prices is lower, without a
second implementation of the ranking rule living over there. Which candidate to
display is the frontend's decision; this module has no opinion about it.

### `Skipped<'a>` and `SkipReason`

`Skipped { path: &'a str, reason: SkipReason }`

| reason                    | meaning                                          |
|---------------------------|--------------------------------------------------|
| `NotMounted`              | routine — a plugin that is not installed wrote it |
| `Malformed(ParseError)`   | corruption — surface it                           |

The distinction is the point. An unmounted property is expected: an object can
carry values written by a plugin that is not installed right now, and they must
not surface as if they were current. They stay in storage, so installing the
plugin brings them back.

A malformed path is not expected. `values.path` is written by the import
contract and by plugins, so nothing on the write side rules it out, and a
caller that never hears about it will never find the defect. Neither kind of
skip stops the rest of the object from resolving — one bad row must not take
down a library view.

### Supporting types

| type            | shape                                                    |
|-----------------|----------------------------------------------------------|
| `StoredValue`   | `{ path: String, value: String }`, one `values` row       |
| `Mount<'a>`     | `{ namespace: &'a str, instance: u32 }`, in mount order   |
| `Origin<'a>`    | `Bare` or `Mounted { namespace, instance }`               |
| `Resolved<'a>`  | `{ value: &'a str, origin: Origin<'a> }`                  |

`Origin` is carried through so the UI can show that a title came from a shop
rather than from the user, and so change review can scope a diff to
`booth#1/price` rather than to the whole object.

## Not yet written

`schema` · `values` · `edges` · `vocab` · `history`
