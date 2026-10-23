# The term page

A vocabulary term, and everything in the library that points at it.

## Why a term has a page

`2026-09-01_vocabularies-not-empty-objects.md`: the seed library references
73 avatars and owns 21 bases. An avatar is a term, not an object, so "what fits
Manuka?" has somewhere to be answered even for an avatar nobody owns. The
answer comes from what the library holds, which is the question worth asking —
a shop page lists every avatar a product supports, and only some of those are
owned.

This is the reverse lookup the edge table was built for, reaching a screen.

## The parts

| file | does |
|------|------|
| `src/ui/vocabulary.ts` | grouping by kind, the count in words |
| `src/ui/Terms.tsx` | `TermList`, the pane; `TermPage`, the term |
| `bridge::commands::term_vocabularies_in` | which vocabularies the library holds |
| `bridge::commands::term_objects_in` | what points at one term, by kind |

Both commands are on the plugin list. They read, and a plugin's avatar panel
has as good a reason to ask them as the framework's page.

## The pane

A vocabulary picker and the terms in the chosen one, by label, with the id
underneath when it differs. **The vocabularies come from the terms table, not
the manifests.** The seed's avatars arrive by import, and a pane that only
listed what a plugin declared would show nothing until the plugin that draws
them is written. A library with no vocabulary says so.

## The page

The label, where it lives, and one line: how many objects point at it. Then
one list per kind of edge, in the order the kinds first appear, each row an
object by its name and path and a way into it.

**Counted by object, grouped by edge.** An outfit that both `supports` and is
`owned` for an avatar is one object and two edges; the count says one, and the
object appears under both headings, because "what do I have for it" and "what
exists for it" are the two questions a person brings.

A term nothing points at says so. A term the vocabulary no longer holds is a
different fact and gets a blank slate, not an empty list.

## Where it leads

Opening an object from a term page leaves the term behind: the page shows the
object, and the pane still shows the term list. The object's own **Points at**
section is where the edge can be removed or another added, and its vocabulary
picker lists the library's vocabularies as well as the manifests', so a person
can say an outfit fits an avatar before any plugin draws avatars.
