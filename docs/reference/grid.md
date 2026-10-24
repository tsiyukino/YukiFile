# The thumbnail grid

What the library holds, as a grid of covers. It is the content area whenever
nothing else is on the page.

`2026-09-01_ui-primer-not-github-clone.md` names the original problem: nobody
could tell what anything was without opening it. So thumbnails are the main
view, not a mode beside a list. The list this replaces drew names in a narrow
pane; the grid draws pictures across the page.

## The parts

| file | does |
|------|------|
| `src/ui/grid.ts` | pure: the placeholder for a missing cover, a card's title, the path under it |
| `src/ui/grid.css` | the grid and card layout, on Primer's CSS variables |
| `src/ui/ObjectGrid.tsx` | the grid: a page of cards at a time, one level at a time |

## Where a card's picture and name come from

`object.summaries` answers both, so a page of sixty cards is one command and
not sixty.

- **Name.** The bare `title` if somebody typed one. Otherwise the first
  plugin's `title`, by mount order, so a product a shop listing named is shown
  by that name without anyone copying it. Namespaces starting with `@` are
  never read for this. Failing all of that, the location's name.
- **Cover.** The same rule for `cover`: bare first, then by mount order. The
  path is a library path, turned into something an `<img>` can load with
  `file.url`. Each path is asked for once and the answer is kept, so paging back
  and forth does not ask again.

A card with no cover, or whose cover file has gone, draws an icon for what the
thing is on disk: a folder, a package, an archive, a picture, a document, any
other file, or a stack for a grouping with no location. Choosing the icon by
extension is allowed here for the reason the Disk pane may: it decides what to
draw, not what the thing means.

Under the name sits the path, unless it would repeat the name. A product named
by its shop shows where it sits. One named after its own file shows the folder
it is in.

## Navigating

A page of sixty at a time, with **Show more** while the grid is short of the
total.

A folder, or a grouping without a location, carries a chevron. The chevron
opens it, so the grid shows what it `contains`; **Back** climbs out again.
Clicking the card itself is choosing the object, never opening it, the same
split the list and the Disk pane make.

## In the shell

Choosing a card replaces the grid with the object's page, which has a **Back**
button beside **Forget**. Back returns to the grid. The grid keeps no state
across that: it opens again at the top level. Remembering where it was is a
later refinement, once filters exist and there is more worth remembering.

The pane's Library segment lists nothing but the count. The grid is the
listing, and selecting the segment from any page is the way home. The Disk,
Terms and Review panes still open objects, and an object they open shows the
same page with the same Back.

A library with nothing in it shows a grid that says so, rather than a blank
slate with instructions; the pane above it holds the scan and the Disk pane is
one click away.
