# The thumbnail grid

What the library holds, as a grid of covers. It is the page whenever the
Library view is showing and no object is open.

`2026-09-01_ui-primer-not-github-clone.md` names the original problem: nobody
could tell what anything was without opening it. So thumbnails are the main
view, with sidebar filtering, designed against the task rather than copied
from a code browser.

## The parts

| file | does |
|------|------|
| `src/ui/ObjectGrid.tsx` | the toolbar, the cards, paging |
| `src/ui/Card.tsx` | one card and a grid of them, shared with the term page |
| `src/ui/grid.ts` | pure: the placeholder for a missing cover, a card's title, the path under it |
| `src/ui/grid.css` | the grid and card layout, on Primer's CSS variables |
| `src/ui/FilterSidebar.tsx` | the groups to narrow by, with counts |
| `src/ui/filters.ts` | pure: what is chosen, and how a click changes it |

## Two ways of looking, one query

With nothing chosen the grid is one level of the tree a plugin built: the top,
or inside whatever was opened, with breadcrumbs back up. With anything chosen
in the sidebar or typed in the search box it is flat, across the whole
library, titled **Results**: a match three groupings deep is as much a match
as one at the top. Both are `object.query` (`bridge.md`, *bridge::query*), so
the sort applies to either.

The toolbar sorts by name, newest first or oldest first, and sets the card
size: small, medium or large. Pages are sixty cards. Reaching the bottom asks
for the next, and a **Show more** button does the same where the observer is
missing.

## The sidebar

One group per field a plugin's manifest names in `facets`, one per vocabulary
a plugin declares, and **Type**, the properties objects carry. Each row is a
value and how many objects show it. A value of nothing, **Not set**, is a row
of its own, which is how a person finds what still needs sorting; a field
nothing holds yet draws no group at all.

Within a group the choices are alternatives, across groups they all apply.
The numbers beside a group are counted with that group's own choices set
aside, so they say what ticking another box there would add. What is chosen
sits at the top of its group and stays there however long the list, and a
choice the counts no longer mention is still drawn, at zero, so it can be
unticked where it was ticked. A group longer than eight rows offers the rest;
one longer than twelve has a box to type into.

Every choice is also a chip above the grid that removes itself, with
**Clear all** beside them.

## A card

A cover, the name under it, and under that what the thing is and what it
fits: the values of the fields the plugins filter by (`Clothing · SilverSpace`)
and the terms it points at (`Airi, Chiffon, Manuka +10`), with the full list
on hover. `object.summaries` returns both when asked for fields and
vocabularies, read the way a page shows them. A card with neither shows its
path instead, which says where a thing is: the least useful thing to say about
it, and the only thing known about some. Small cards leave the terms out.

- **Name.** The bare `title` if somebody typed one, else the first plugin's
  `title` by mount order, else the location's name.
- **Cover.** The same rule for `cover`, through `file.url`, asked once per
  path and kept: covers are stored under a name made from their content, so a
  changed cover is a new path and never a stale entry.
- **A grouping with no cover** borrows up to four covers from what it holds,
  two levels down, as a mosaic: the top of a library is shelves, and a shelf
  is recognised by what is on it.
- **No cover.** The cover is tinted by what the thing is on disk, in Primer's
  display colours, with an icon and a word: a folder, a Unity package, an
  archive, an image, a document, a file, or a group with no location. A grid
  of freshly scanned products still separates packages from archives at a
  glance.

Choosing a card opens the object's page. A card whose object contains
something carries a pill with the count, a button of its own, which opens it
in the grid; the card itself is never a button inside a button. A grouping
with no location is nothing but what it holds, so choosing it opens it too.
Inside a grouping an info button beside the breadcrumbs opens the grouping's
own page.

The last object opened is outlined when the grid comes back, so the eye finds
its place.

## Finding covers

**Find covers…** in the Library menu looks through every object that has no
cover from anyone, skipping groupings, which borrow theirs. For each it lists
the pictures in its folder (two levels down), in its archives, and, when
ticked, the previews Unity stores in its packages and in packages inside its
archives, then keeps the one `bestCover` ranks highest
(`src/ui/covers.ts`, `src/ui/coverHunt.ts`):

- a picture beside the product beats a preview inside its package;
- a name that says cover, thumbnail, main, preview, promo, サムネ or 表紙 wins;
- a name that says normal, mask, matcap, emission, texture, readme or licence
  loses, and an object holding nothing better gets no cover at all rather
  than a normal map;
- among previews, a prefab's (the product as worn) beats a material's, which
  beats a texture's;
- shallower and larger break ties.

One object at a time, with a progress bar and **Stop**; an archive that cannot
be read is counted and passed over. The chosen picture goes through
`cover.set` with `found`, which writes it as `found#1/cover`: a source like a
plugin's that always ranks after every plugin's (`store.md`, *found*). A
shop's picture, fetched before or after, is shown instead, and a person's own
pick outranks both. A wrong guess is cleared from the object's page. Running
it twice is harmless: the second run looks only at what the first left
without.
