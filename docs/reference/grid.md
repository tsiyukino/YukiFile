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

A cover, the name under it, and the path under that unless it would repeat
the name.

- **Name.** The bare `title` if somebody typed one, else the first plugin's
  `title` by mount order, else the location's name.
- **Cover.** The same rule for `cover`, through `file.url`, asked once per
  path and kept: covers are stored under a name made from their content, so a
  changed cover is a new path and never a stale entry.
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
