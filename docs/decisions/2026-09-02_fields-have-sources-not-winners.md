# A field has sources, not a winner

Date: 2026-09-02
Status: accepted

## Context

A product sold on two shops carries three titles:

```
title            "BE NATURAL (Lapwing)"        what I call it
booth#1/title    "> BE NATURAL <"              what Booth calls it
gumroad#1/title  "BE NATURAL fullset"          what Gumroad calls it
```

The first implementation of `flatten` returned the winner and a list of losing
candidates. The vocabulary was wrong, and the wrong vocabulary produced a wrong
design: none of these three is losing. All three are true, and a user looking at
the detail page wants to see all three.

Two separate needs had been collapsed into one:

| need | wants | where |
|------|-------|-------|
| a single value | a fallback order | search, sort, export, grid tiles |
| the whole picture | grouping, with attribution | detail page |

Ranking served the first and the second was left as a by-product ("read the
candidate list yourself"). The second is not a by-product; it is the case the
architecture doc names when it says the frontend should show "the local title
large with the shop title underneath".

## Decision

A field resolves to an ordered list of **sources**, best first. There is a
primary source, which is what anything needing one value reads. There are no
losers.

Fields **do not compete by default.** A plugin declares which of its fields
contribute to a shared concept:

```json
{
  "id": "yukifile.booth",
  "contributes": {
    "properties": ["booth"],
    "shared": ["title", "price", "url", "cover"]
  }
}
```

`booth#1/title` joins the sources for `title`. `booth#1/item_id`, undeclared,
is Booth's alone and is read through its full path.

Grouping is **implicit**: two plugins declaring `shared: ["title"]` contribute
to the same `title`, with no central registry of shared concepts. A typo
(`titel`) silently forms its own group of one rather than joining. Tooling
catches that — a shared field with exactly one source library-wide is worth a
warning at plugin load — rather than a curated list in the core, which would
become a second dumping ground and would mean new shared concepts require a
core change.

## Why isolation is the right default

Under competition-by-default, installing a plugin can silently change what a
user already sees. They took no action on any object, added no data, and the
price on forty products now reads differently because a newly installed plugin
happened to write a field called `price`.

Isolation-by-default cannot do that. A new plugin's fields are inert until its
author says they describe a shared concept, and that author is the only party
who knows: the Booth plugin's author knows `title` is one rendering of a concept
other sources also have, and that `item_id` is Booth's alone. The core cannot
infer it and the user should not have to.

## Ordering, and overriding it

Sources are ordered by mount order — see
`2026-09-02_mount-order-and-pins.md`, which also covers pinning a specific
source on a specific object.

## Naming follows the model

The first implementation's names encoded the wrong idea and are corrected:

| was | is | why |
|-----|-----|-----|
| `winner()` | `primary()` | it is what gets shown first, not what won |
| `candidates()` | `sources()` | they are origins, not applicants |
| "losing candidates" | "other sources" | there are no losers |

`Origin` keeps its name. It was written so the UI could show that a title came
from a shop rather than from the user, which was already the right idea before
the rest of the vocabulary caught up.

## Consequences

The flattening rule is still one line: **only fields declared shared take part;
among those, a bare field wins if it has a value, otherwise the first non-empty
source in mount order.**

`Mount` carries the shared field list of the plugin instance it belongs to,
because `shared` is declared per plugin and a mount is one plugin instance.

Core property fields are not shared by anyone, so nothing can contribute a
competing `fs#1/path`. That falls out of this decision; the reservation in
`2026-09-02_core-properties.md` is a second, independent guarantee.

The frontend can render a full source list without re-deriving the ranking,
which is what keeps a second copy of this rule from growing over there.
