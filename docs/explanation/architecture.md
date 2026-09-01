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

An **object** is one file or one folder on disk. That is the whole definition,
and it is deliberately strict: an object maps to exactly one path. There is no
such thing as an object that spans two folders. If you want to split a product
into two, you make two folders on disk and add them separately; if you want to
merge, you make one folder and move both in. The library never invents virtual
groupings that the filesystem does not have, because the moment it does, every
export, backup and "open in explorer" has to explain itself.

Objects carry **values**, stored under namespaced paths:

```
42/title                 "BE NATURAL (Lapwing)"
42/note                  "bought the fullset"
42/booth#1/url           "https://booth.pm/ja/items/8264237"
42/booth#1/title         "▸ BE NATURAL ◂【9Avatars】"
42/booth#1/price         2900
42/vrchat/category       "clothing"
```

The namespace is not decoration. `title` and `booth#1/title` are different
facts: one is what you call the thing, the other is what the shop calls it.
Storing them flat would mean that renaming a product locally causes every
subsequent shop fetch to report a conflict on a field you already decided
about. The `#1` suffix is an instance counter, which is what lets one object
carry both a Booth page and a Gumroad page without either winning.

Reading flattens. The rule is one line: a bare field wins if it has a value;
otherwise fall back to the first non-empty same-named field in property mount
order. Mount order ranks property *instances* rather than property names — an
object carrying both `booth#1` and `booth#2` needs the two ranked against each
other — and the order belongs to the library, so two libraries can disagree
about which shop they trust.

Flattening lives in the backend rather than the UI because search, sort and
export all need it, and two implementations of one rule drift apart. It keeps
the values that lost: the winner is what search and export read, but the
frontend is free to render whatever it likes from the ranked candidates —
showing the local title large with the shop title underneath, or picking
whichever of two prices is lower. That kind of display logic stays in the
frontend; the backend has no opinion about it. Handing over the whole ranking
rather than the winner alone is what keeps the frontend from growing a second
copy of the rule.

Resolution reports what it could not place, and the two reasons are not alike.
A value under a property the library does not mount is routine — an object can
carry values written by a plugin that is not installed right now, and they wait
in storage until it is. A value whose path does not parse is corruption, and
since `values.path` is written by the import contract and by plugins, nothing
on the write side rules it out. Neither one stops the rest of the object from
resolving.

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

History is kept at field level: path, old value, new value, timestamp, batch.
It is small — roughly a couple of megabytes for a library this size after years
of edits — so it is stored plainly, without git-style delta packing. Thumbnails
never enter history; replacing a cover replaces the file.

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
    "vocabularies": ["avatar"],
    "actions":      ["fetch-booth", "export-to-unity"],
    "panels":       { "vrchat": "./panels/Vrchat", "booth": "./panels/Booth" },
    "viewers":      [],
    "scanProfiles": ["vrc-assets"]
  },
  "requires": { "properties": [] }
}
```

Dependencies name field contracts, not plugins. An AI-summary plugin for VRChat
requires the `vrchat` property; whichever plugin provides it satisfies the
requirement.

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

Three extension points cover the UI in the first version: detail panels,
full-screen viewers (a PDF reader opening in a tab or window), and list
columns. Plugins cannot rearrange the application layout. That restriction is
temporary and deliberate — layout extension points designed against only six
built-in modules would mostly be guesses.

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
