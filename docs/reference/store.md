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

| field       | type                | meaning                                    |
|-------------|---------------------|--------------------------------------------|
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

Resolving many stored values down to one per field.

The rule: a bare field wins if it has a value; otherwise the first non-empty
same-named field in mount order takes it.

This runs in the backend because search, sort and export all need it, and two
implementations of one rule drift apart. The frontend also receives the raw
values and decides for itself whether to show the local title, the shop title,
or both — that is display logic and this module has no opinion about it.

`flatten<'a>(values: &'a [StoredValue], mounts: &[Mount<'a>]) -> FlatView<'a>`

Mount order is an argument rather than configuration read inside, which is what
keeps the function pure. Order is per library, so the caller passes the order
belonging to the library being read.

Two kinds of value are skipped rather than resolved: paths that do not parse,
and values under a property the library does not mount. The second matters —
an object can carry values written by a plugin that is not installed now, and
those must not surface as if they were current. They stay in storage, so
installing the plugin brings them back.

Empty values never win; a set field beats an empty one at any rank.

| type            | shape                                                   |
|-----------------|---------------------------------------------------------|
| `StoredValue`   | `{ path: String, value: String }`, one `values` row      |
| `Mount<'a>`     | `{ namespace: &'a str, instance: u32 }`, in mount order  |
| `Origin<'a>`    | `Bare` or `Mounted { namespace, instance }`              |
| `Resolved<'a>`  | `{ value: &'a str, origin: Origin<'a> }`                 |
| `FlatView<'a>`  | `HashMap<&'a str, Resolved<'a>>`                         |

`Origin` is carried through so the UI can show that a title came from a shop
rather than from the user, and so change review can scope a diff to
`booth#1/price` rather than to the whole object.

## Not yet written

`schema` · `values` · `edges` · `vocab` · `history`
