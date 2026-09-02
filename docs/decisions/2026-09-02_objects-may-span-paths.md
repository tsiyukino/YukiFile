# An object may sit at no path, one path, or several

Date: 2026-09-02
Status: accepted
Supersedes the object model paragraph in `docs/explanation/architecture.md`

## Context

The original definition was deliberately strict:

> An object is one file or one folder on disk. That is the whole definition...
> an object maps to exactly one path. There is no such thing as an object that
> spans two folders.

That was written while the project was a VRChat asset manager. The requirement
has since grown to a general library manager, and the constraint costs more
than it buys.

Two things forced the change. The first is that the seed library already
contains the shape the rule forbids: `vrc-lessons.md` records that **43 zips
had an extracted sibling folder of the same name**, and `inventory.json` stores
that as a `path` plus an `archives` array — a second path smuggled in under
another name because the model had no room for it. One product, two locations,
already true in the data.

The second is that a general manager needs groupings that are not files at all:
a playlist, a collection, a series. Under the old rule those are unrepresentable
without inventing a fake path.

## Decision

An object has **zero, one, or several** locations, each a `fs` instance:

```
42/fs#1/path   "Clothing/AW KLASSIK MAID"
42/fs#1/kind   "folder"
42/fs#2/path   "Clothing/AW KLASSIK MAID.zip"
42/fs#2/kind   "file"
```

**A path still belongs to exactly one object.** Object-to-path becomes
one-to-many; path-to-object stays one-to-one. Relaxing the second as well would
leave a scan unable to say which object a file it just found belongs to, and
reconcile's move detection would have several candidate answers where it needs
one.

An object with no `fs` instance has no location. It is not a distinct kind of
thing and the core does not name it — what it *is* comes from the properties it
carries. Carrying `playlist` makes it a playlist; carrying `collection` makes it
a collection; carrying nothing makes it a bare grouping. The core's only
special handling is that "open in explorer" does not exist without a path.

## `kind` describes a location, not an object

`file` and `folder` moved from the object to the `fs` instance. An object with a
folder and a zip has no single answer to "is it a file or a folder", because the
question is asked at the wrong level. It is a property of each location.

`label` was dropped in the same pass. It duplicated `title`, which already
exists as an ordinary property. Display name is `title` when set, otherwise the
basename of the first path; an object with no path and no title is nameless,
which is a usability problem for the creation UI to prevent, not a data
integrity problem for the database to enforce.

## What the original rule was protecting

The rule gave one reason, and it is a real one:

> The library never invents virtual groupings that the filesystem does not have,
> because the moment it does, every export, backup and "open in explorer" has to
> explain itself.

Each of those three now needs an answer, and each has one:

**Open in explorer.** With several paths, open the first, or offer the choice.
With none, the action does not exist — a grouping is not a file, and its detail
page showing its members is the whole of what it can offer.

**Export and backup.** With several paths, all of them. With none, the object
exports as a manifest of what it contains rather than as an empty directory.
The import contract already carries objects and edges, so a grouping round-trips
as a row plus its `contains` edges.

**Scanning.** Unchanged, because path-to-object stayed one-to-one. A file found
on disk maps to at most one object, and reconcile keeps working.

## Containment is edges, not paths

An object holding other objects uses `contains` edges, which the edge table
already supports and which `docs.yml` requires:

> Anything that points at another object or a vocabulary term is an edge, not
> a field.

This also answers the multiple-membership case cleanly. One file object can be
contained by both a product and a user's collection: the file exists once,
the edges are many. Spanning paths and containing objects are independent — an
object may do both.

## Boundary against the vocabulary decision

`2026-09-01_vocabularies-not-empty-objects.md` argues against pathless objects,
counting 52 avatar names that would become empty shells in every listing. That
decision stands, and this one does not contradict it.

The distinction is who creates them and how many. That decision refuses to
**automatically** mint an object for every referenced name — 73 references
producing 52 pathless shells nobody asked for. This decision permits a user to
**deliberately** create a grouping. A vocabulary term is still not an object,
and a name referenced by an asset still does not become one.

If a future change proposes auto-creating pathless objects, the earlier decision
is the one that governs, and the answer is still no.

## Consequences

The 43 redundant archives become one object each with two `fs` instances, rather
than two objects or one object with a smuggled `archives` array.

`objects` holds identity and little else; locations live in their own table with
their own unique constraint. See `2026-09-02_core-properties.md` for why `fs` is
stored that way rather than in `values_`.

Anything reading "the path of an object" must now handle zero and several. Code
written against the old assumption is wrong rather than merely incomplete, which
is why this lands before the store is built rather than after.
