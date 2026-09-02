# Architecture

Yukifile manages libraries of files and folders. The distinguishing choice is
that the core has no idea what a VRChat outfit or an academic paper is. It
stores objects, hangs typed properties on them, records relationships, and
arbitrates between plugins that want the same screen real estate. Everything
domain-specific lives in a plugin.

The design came out of organising a real 35 GB VRChat asset library by hand
(see `seed/vrc-lessons.md`). Most of the structural decisions below exist
because something in that library broke a simpler design.

## The object model

An **object** is a thing in the library. It may sit at one location on disk, at
several, or at none at all. A location is a `fs` instance:

```
42/fs#1/path   "Clothing/AW KLASSIK MAID"
42/fs#1/kind   "folder"
42/fs#2/path   "Clothing/AW KLASSIK MAID.zip"
42/fs#2/kind   "file"
```

Spanning is not a hypothetical. The seed library has 43 products that exist as
an extracted folder *and* the zip it came from, and the old scan recorded the
second one in an `archives` array — a path smuggled in under another name
because the model had no room for it.

A path still belongs to exactly one object. Object-to-path is one-to-many;
path-to-object stays one-to-one, because a scan that finds a file has to know
which object it belongs to, and reconcile's move detection needs one answer
rather than several.

An object with no location is a grouping. The core does not name it or treat it
as a separate kind — what it *is* comes from the properties it carries, so
`playlist` makes it a playlist and `collection` makes it a collection. The only
thing the core does differently is that "open in explorer" does not exist
without a path. Groupings hold their members through `contains` edges, which is
also how one file can belong to both a product and a user's collection at once.

Objects carry **values**, stored under namespaced paths:

```
42/title                 "BE NATURAL (Lapwing)"
42/note                  "bought the fullset"
42/booth#1/url           "https://booth.pm/ja/items/8264237"
42/booth#1/title         "▸ BE NATURAL ◂【9Avatars】"
42/booth#1/price         2900
42/vrchat#1/category     "clothing"
```

The namespace is not decoration. `title` and `booth#1/title` are different
facts: one is what you call the thing, the other is what the shop calls it.
Storing them flat would mean that renaming a product locally causes every
subsequent shop fetch to report a conflict on a field you already decided
about. The `#1` suffix is an instance counter, which is what lets one object
carry both a Booth page and a Gumroad page without either overwriting the
other.

A small, closed set of **core properties** is reserved to the core. Today that
set is `fs` alone, and the test for admission is whether the software would
fail to run without it: without `fs` the scanner has nothing to scan and
"open in explorer" has no target. `title` fails that test and is an ordinary
property. Core properties use the same path syntax and the same API as any
other, but no plugin may declare one, and they are stored in typed tables
because they need a real unique constraint on paths and real integers for
sizes.

## Reading: sources, not winners

A product sold on two shops has three titles, and all three are true. Reading
does not pick a winner and discard the rest — it returns the **sources** for a
field, best first. Anything that needs one value takes the first; the detail
page can show them all, attributed.

Fields do not compete by default. A plugin declares which of its fields
contribute to a shared concept, and only those join:

```
booth contributes:  properties ["booth"]
                    shared     ["title", "price", "url", "cover"]
```

So `booth#1/title` becomes a source for `title`, while `booth#1/item_id` is
Booth's own and is read through its full path. Isolation is the default because
the alternative lets installing a plugin silently change values the user is
already looking at, on objects they never touched.

Among the sources for a field, the rule is one line: a bare field wins if it
has a value, otherwise the first non-empty source in mount order. Mount order
ranks property *instances* rather than names — an object carrying `booth#1` and
`booth#2` needs the two ranked — and it belongs to the library, so two
libraries can disagree about which shop they trust.

Mount order is a rule and applies everywhere. For a single object a **pin**
overrides it:

```
42/@pin/cover   "gumroad#1"
```

Rules and choices are kept apart on purpose. A per-field priority setting —
"for covers, always prefer Gumroad" — is invisible at the point it takes effect
and impossible to debug later. A pin is visible on the object it affects, next
to the value it changes, with an obvious way to undo it.

Resolution runs in the backend because search, sort and export all need it, and
two implementations of one rule drift apart. It reports what it could not
place, and the two reasons differ: a value under a property this library does
not mount is routine, since an object can carry values written by a plugin that
is not installed and they wait in storage until it is; a value whose path does
not parse is corruption, and nothing on the write side rules it out while the
import contract and plugins both write that column. Neither stops the rest of
the object from resolving.

## Facts and meanings

Properties come in two kinds, and conflating them was the first thing that
went wrong in the prototype.

**Factual properties** are attached automatically because they are observably
true: `file`, `folder`, `archive`, `pdf`, `docx`, `image`. Nothing is inferred.
A `.pdf` is a pdf. These properties are useful on their own — `pdf` brings text
extraction and a page count, `archive` brings listing contents without
unpacking — and none of that requires knowing whether the document is a paper
or the archive is an outfit.

**Semantic properties** are attached by a person: `vrchat`, `booth`, `paper`,
`dataset`. The software never guesses these. It cannot reliably tell a VRChat
outfit from a research dataset by looking at file extensions, and pretending
otherwise produces confident wrong answers that are worse than blanks.

Semantic properties build on factual ones. `paper` can offer DOI lookup and
citation generation because `pdf` already provides text extraction. That
layering is why the split matters beyond tidiness.

Properties hang on objects, not on libraries. A VRChat library containing a
paper about VRChat is a normal situation, and that paper object carries `paper`
while its neighbours carry `vrchat`. A library declares which semantic
properties it expects, but that only affects ordering and defaults in the
picker — it never restricts what you can attach.

## Edges and vocabularies

Anything that points at something else is an **edge**, not a field:

```
outfit    --requires-->  mochifitter core
gagset21  --patches-->   gagset
avatar    --contains-->  outfit, hair, texture
noir141   --supersedes-->noir12
outfit    --supports-->  avatar:manuka
outfit    --owned-->     avatar:lapwing
```

One table, one `kind` column. Plugin dependencies, product bundles, version
successors and compatibility all reduce to this, and reverse lookup ("what fits
Manuka?") becomes one indexed query instead of a scan over array fields.

Edges point at objects or at **vocabulary terms**. A vocabulary is a controlled
list of names with aliases — avatars, authors, journals, labels. It exists
separately from objects because the two are not the same thing and the real
library proves it: 73 avatars are referenced by assets, 21 avatar bases are
actually owned. Modelling the other 52 as empty objects would fill the library
with pathless shells that show up in every listing and every backup.

The vocabulary approach means `Selestia` is a term with 22 assets pointing at
it and no base owned; the term page still works, still shows a cover, still
lists everything compatible. Buying the base later adds one object and one
`is_avatar` edge, and the 22 existing assets connect to it with no migration.
Aliases (`桔梗` / `Kikyo` / `Kikyou`) collapse to one term, which matters
because Booth lists compatibility in Japanese while filenames use English.

## Changes are reviewed, not applied

Writing a value into an empty field just happens. Overwriting a field that
already holds a different value produces a **change set** — a reviewable batch,
shaped like a pull request.

This is source-agnostic on purpose. A change set from an AI import, from
another machine's export, and from a Booth fetch are the same kind of thing.
There is no per-field provenance tag, because the question at review time is
"do I want this value" and not "who suggested it".

The review UI distinguishes additions from modifications. Additions default to
accepted since they are lossless; modifications default to unaccepted. The most
useful control is "accept additions only", which fills in blanks without
touching decisions already made.

Applying one is all or nothing. A pull request either merges or it does not,
and a change set that half-applied would leave sixteen of thirty-one fields
written with a batch in the history that reads no differently from a complete
one. Every write in a change set runs inside one transaction, so a failure
part-way takes the values and their history records back together.

History is kept at field level: path, old value, new value, timestamp, batch.
It is small — roughly a couple of megabytes for a library this size after years
of edits — so it is stored plainly, without git-style delta packing. Thumbnails
never enter history; replacing a cover replaces the file.

History is written by whoever is making the decision, not automatically on
every write. A scan importing 1518 objects is not 1518 edits; it is those
fields existing for the first time.

## Plugins

The core is an arbiter. Plugins declare what they contribute; the core decides
placement, ordering, and what happens when two plugins want the same slot. No
plugin reaches into the core to modify it, and the core has no branch anywhere
that names a specific plugin.

A manifest declares contributions:

```json
{
  "id": "yukifile.vrc",
  "contributes": {
    "properties":   ["vrchat", "vrchat.clothing", "booth"],
    "shared":       ["title", "price", "url", "cover"],
    "vocabularies": ["avatar"],
    "actions":      { "booth": ["fetch-booth"], "vrchat": ["export-to-unity"] },
    "panels":       { "vrchat": "./panels/Vrchat", "booth": "./panels/Booth" },
    "viewers":      {},
    "scanProfiles": ["vrc-assets"]
  },
  "requires": { "properties": [] }
}
```

Dependencies name field contracts, not plugins. An AI-summary plugin for VRChat
requires the `vrchat` property; whichever plugin provides it satisfies the
requirement.

Every UI contribution is keyed by the property it belongs to. That single fact
answers a question that has no answer in positional terms: a plugin does not
say where on screen it wants to be, it says which property it is scoped to, and
the core places that property's region. Two plugins can no more collide than
two properties can, and ordering falls out of mount order, which already
exists.

Visibility follows from the same key. A contribution appears when the object
carries the property — panels, actions and columns alike, with no separate
rule for each. Requiring a property is also the ticket into its region: a
price-comparison plugin that requires `booth` and `gumroad` may place a panel
among theirs, and a plugin that requires neither may not. The permission check
and the dependency declaration are the same statement.

The built-in modules — `folder`, `file`, `archive`, `pdf`, `docx`, `image` —
use this same API with no privileges. They are the first real consumers of the
extension points, which is the point: if a built-in needs the core to make an
exception for it, the extension point is wrong and gets fixed before any
third-party plugin depends on it.

Plugin logic is TypeScript. Heavy work is not: scanning, hashing, archive
reading, PDF text extraction and database access are Rust in the core, exposed
to plugins as commands. This keeps the plugin barrier low without paying for it
in performance — parsing 206 unitypackages took two minutes in Python during
the manual cleanup and takes seconds in parallel Rust. A plugin that genuinely
needs custom heavy computation can ship WASM.

Three slots cover the UI in the first version: detail panels, full-screen
viewers, and list columns — each scoped to a property. Actions are a fourth,
and they are deliberately independent of layout: an object carrying `pdf`
offers the PDF plugin's actions through the context menu and the command
palette no matter who drew the page. That is what lets a plugin own an object's
whole page without stranding the user, and it is why no layout has to reserve a
slot for other plugins.

The arbitration is split across the two languages along the line between what
is decided once and what is asked per object. Rust settles which plugins load
and in what order, all or nothing, because a partly loaded set is a library
where some objects have panels and others do not for reasons nobody can see.
TypeScript takes that order and answers, for each object, what belongs in each
slot — a pure function of the manifests, the object's properties and mount
order, with no state of its own, because the same question is asked from the
object page, the context menu and the grid header and all three have to get
the same answer.

Fetching a plugin's code is where the all-or-nothing rule stops. Dependencies
were checked before anything loaded, so what can still go wrong is one module
failing to parse — and refusing to start over that would let any plugin author
take the application down with a typo. A module that fails is left out and
reported; the rest of the library keeps working.

Owning a page is the direction, not the first version. A VRChat asset page and
a paper page have little in common, so the core imposes no mandatory header and
lets one plugin — chosen per object by the user, since only they know whether a
PDF is a prop or a document — draw the whole thing, falling back to the core's
own layout when nobody claims it. v1 ships that default layout and the four
slots; ownership and the component library a plugin would need to draw a page
wait for a second real plugin to design against.

Grids and lists are never owned. The grid exists to be scanned, and tiles drawn
differently per object defeat scanning — which was the original problem. The
core draws them; plugins contribute columns and badges.

## Storage

Library data lives in `.yukifile/` at the library root by default, so the whole
library is self-contained and can be copied to another machine. Users who want
the library kept clean can move it to AppData, keyed by library name; switching
migrates the data.

Thumbnails are files on disk with paths in the database, never blobs. Only
product covers are stored — one image per source. Everything works offline;
network access happens when the user selects objects and presses fetch, never
on a timer and never during a scan.

## Import and export

One contract serves three cases: exporting the library for an AI to analyse,
importing results back, and moving between machines. It is defined before the
UI because it is the interface to everything outside the application, including
a future MCP server, which is a protocol wrapper over this same contract rather
than a second path into the data.

Imports are idempotent, matched on path, and carry a `reason` field per
suggestion. The reason is not decoration: during the manual cleanup, a
classifier repeatedly misfiled outfits as editor tools because they bundled
lilToon, and the mistake was only obvious once the reasoning was visible.
