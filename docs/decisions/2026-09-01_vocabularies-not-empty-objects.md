# Referenced names are vocabulary terms, not empty objects

Date: 2026-09-01
Status: accepted

## Context

Assets declare what they are compatible with. An outfit fits Manuka, Shinano
and Kikyo. Those names have to live somewhere.

The tempting answer is to make everything an object: if an outfit references
Manuka and no Manuka object exists, create one. It keeps the model to a single
concept.

Counting the real library killed that idea:

```
avatars referenced by assets   73
avatar bases actually owned    21
```

Selestia is referenced by 22 assets and its base was never bought. Under the
"create an object" approach, 52 of 73 avatar entries — over two thirds — would
be objects with no path, no size and nothing to open, sitting in the same
listings as real files. Every listing, export and backup would then need a rule
for hiding them, which is the same complexity moved somewhere worse.

## Decision

Vocabularies are a separate concept from objects.

A **vocabulary term** is a name with aliases and optional metadata (cover,
link). It has no path. `avatar:selestia` exists because assets point at it.

An **object** is a file or folder. `Bases/MANUKA.unitypackage` is an object.

The two connect by an edge: that object declares `is_avatar → avatar:manuka`.

Terms appear in their own browsing views and in reverse lookups. They never
appear in the file listing, because they are not files.

## Consequences

Not owning a base is representable without inventing anything: the term exists,
no object claims it, and the UI says so. That is useful information rather than
an error state.

Buying the base later adds one object and one edge. The 22 assets already
pointing at the term connect automatically — no migration, no rewriting of
existing records.

Aliases collapse at the term. `桔梗`, `Kikyo` and `Kikyou` are one term with
three surface forms, which the real data requires: Booth lists compatibility in
Japanese while filenames are in English, so an outfit whose folder says
`Kikyo` and whose shop page says `桔梗` has to resolve to one thing.

Vocabularies generalise past this domain. Papers have authors and journals;
music has artists and labels. In each case you reference far more names than
you own items by. A vocabulary is declared by a plugin the same way a property
is.

Academic authors and shop vendors are kept as separate vocabularies rather than
one `person` list. They have different aliasing rules and different useful
fields. If someone turns out to be both, that is two terms joined by an edge —
merging them can wait until it actually happens.

## Prior art

Zotero and Mendeley model authors and journals as entities distinct from
library items. Obsidian shows references to non-existent notes as unresolved
links: visible in the graph and in backlinks, absent from the file list.
MusicBrainz separates artists from releases. All of them arrived at the same
split between things you have and words you describe them with.
