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
| `src/ui/Terms.tsx` | `TermList`, in the sidebar; `TermPage`, the term |
| `bridge::commands::term_vocabularies_in` | which vocabularies the library holds |
| `bridge::commands::term_objects_in` | what points at one term, by kind |

Both commands are on the plugin list. They read, and a plugin's avatar panel
has as good a reason to ask them as the framework's page.

## The sidebar

A vocabulary picker, a box to filter by, and the terms in the chosen one, by
label, with the id beside it when it differs. The box matches the label or the
id, since an avatar is typed in whichever script a person thinks of it in. **The vocabularies come from the terms table, not
the manifests.** The seed's avatars arrive by import, and a pane that only
listed what a plugin declared would show nothing until the plugin that draws
them is written. A library with no vocabulary says so.

## The page

A page heading with the label, and one line under it: the vocabulary, the id,
and how many objects point at it. **Show in the grid** takes the window to the
grid narrowed to the term, where the sidebar can narrow it further. Then one
grid of cards per kind of edge, in the order the kinds first appear: the same
cards the library grid draws, so an outfit looks the same on its avatar's page
as on its shelf.

**Counted by object, grouped by edge.** An outfit that both `supports` and is
`owned` for an avatar is one object and two edges; the count says one, and the
object appears under both headings, because "what do I have for it" and "what
exists for it" are the two questions a person brings.

A term nothing points at says so. A term the vocabulary no longer holds is a
different fact and gets a blank slate, not an empty list.

## Where it leads

Opening an object from a term page shows it over the term page, and Back
returns to the term. The sidebar still shows the term list. The object's own **Points at**
section is where the edge can be removed or another added, and its vocabulary
picker lists the library's vocabularies as well as the manifests', so a person
can say an outfit fits an avatar before any plugin draws avatars.
