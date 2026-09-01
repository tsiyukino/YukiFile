# Objects carry namespaced properties, not a fixed schema

Date: 2026-09-01
Status: accepted

## Context

The first sketch of this project was a VRChat asset manager with tables for
products, variants and avatars. Working through a real 35 GB library showed
that model was both too specific and wrong in detail, and the requirement had
also grown: the same software should manage papers, datasets and anything else,
with VRChat as one plugin among several.

Two candidate models:

**A. Typed components.** A property is a named schema. `booth` means exactly
`{url, title, author, price, cover}`. Automation knows which fields to fill.

**B. Free key-value pairs.** Any object can hold any field. Maximum freedom,
but "fetch from Booth" has nowhere defined to write.

A is a special case of B, so the question was really how to get both.

## Decision

Properties are typed (A) and users can also add bare fields (B). Values are
stored under namespaced paths:

```
42/title              local name
42/booth#1/title      what the shop calls it
42/booth#1/price      2900
42/gumroad#1/price    2400
```

Reading flattens: a bare field wins if set, otherwise fall back to the first
non-empty same-named field in mount order. Flattening runs in the backend
because search, sort and export need it too.

The `#1` instance suffix lets one object carry two shop pages without either
overwriting the other.

Nested sub-types (`vrchat.clothing/parts`) are just property types whose names
contain a dot. Storage needs no change to support them.

Anything referring to another object or a vocabulary term is an edge, not a
field.

## Why not flatten in storage

The obvious simplification is to store `title` once and let the last writer
win. It fails on the real library. Rename a product locally to something you
recognise, and the next Booth fetch reports a conflict on `title` — every
time, forever, because the fetch has no memory of your decision. Keeping the
shop's title in its own namespace means a re-fetch updates `booth#1/title` and
never touches yours.

The same argument covers two shops on one object, which flat storage cannot
represent at all.

## Consequences

Storage is one `values(object_id, path, value)` table. Flattening is a pure
function, so it is testable in isolation. History records changes per path, so
diffs are naturally scoped to `booth#1/price` rather than to a whole object.

The cost is a string prefix on every value and a resolution step on read. That
is cheap now and expensive to retrofit later, which is why it goes in first.

Deliberately excluded: per-field source priority configuration. Fallback order
is mount order, and users reorder mounts if they care. Per-field priority is
the kind of setting nobody remembers configuring and nobody can debug.
