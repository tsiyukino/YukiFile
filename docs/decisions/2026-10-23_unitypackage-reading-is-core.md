# Reading a Unity package is core work

Date: 2026-10-23
Status: accepted
Resolves the question left open in `2026-09-01_v1-scope-and-build-order.md`

## Context

That record refused to put `unitypackage.rs` in the core on the argument
that it was "just a container format", because the same argument pulls every
zip-shaped format in. It deferred the question until a consumer existed, so
it could be settled on evidence: if a plugin could read packages through the
existing archive command, it was plugin work; if not, the missing capability
would be specific.

The VRChat plugin is the next thing to build, and `seed/vrc-lessons.md` says
what it needs from a package: the asset paths, because the second segment is
almost always the vendor and that identified 93 of 174 products offline; and
the per-avatar filenames inside, which are how you learn what was bought.

## What the evidence says

A plugin cannot read a package through `archive.list`. That command lists a
zip's central directory and nothing inside any member. A package is gzip over
tar, and the paths are *inside* the tar entries — the `pathname` file of each
asset — so listing the tar's own entry names would give GUIDs and nothing.

A plugin cannot read the bytes itself either, and that is by design.
`2026-09-03_a-viewer-gets-a-url-not-bytes.md` keeps bytes away from plugin
JavaScript so that a plugin which can read cannot also exfiltrate through
`import.propose`. That decision stands. Its consequence is that anything which
has to parse bytes is the core's to do.

So the capability is specific and identifiable: gunzip, untar, read each
asset's `pathname`, and do the same for a package stored inside a zip without
unpacking the zip. That is `commands::unitypackage`.

## What stays out of the core

Everything that means anything. The core reports paths, sizes and whether a
preview exists. It does not know what a vendor is, does not strip lilToon or
Poiyomi, does not match avatar names, and does not decide that a package with
editor scripts is a tool. `vrc-lessons.md` lists each of those as a trap, and
each is a plugin's judgement to make and to get wrong in its own tests.

The core also does not know the extension. `tests/boundary.rs` still refuses
the string `"unitypackage"` in core source. The built-in plugin registers the
file type; the command reads what it is handed.

## Why streamed

The earlier Python read 206 packages into memory in two minutes. The reader
here is one chain — zip entry, gzip, tar — holding one tar entry at a time.
The seed's largest archive is 84 MB and the libraries this is for hold
bigger ones.

## Consequences

`unitypackage.list` joins the plugin list as a read. A built-in
`unitypackage` plugin registers the file type and draws a panel: the asset
count, the folders under `Assets/`, and the first forty paths. It names the
folders and does not call any of them the vendor; that sentence belongs to
the VRChat plugin, which can now be written against a reader that exists.
