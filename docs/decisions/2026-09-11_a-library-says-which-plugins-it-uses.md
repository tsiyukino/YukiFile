# A library says which plugins it uses

**Date:** 2026-09-11
**Status:** accepted

## The problem

Scanning moved out of the core and into a plugin, which was right: what counts
as an object is domain knowledge, and `docs.yml` says the core has none. But
the plugin that took it over recorded every file and every folder, so a library
of 441 paths became 441 objects -- including 281 game textures under one folder
that nobody will ever organise individually.

The obvious reading is that the scan is too eager. It is not. The plugin's rule
is "record everything", and it followed that rule exactly. The question is why
that rule was running at all.

## What was actually wrong

Discovery loads every directory under `plugins/`, and everything discovered
runs. So "record every file and folder" was never a choice the library made --
it was what happened because a directory existed.

That is the same mistake as putting the scanning rule in the core, moved one
layer out. The decision still lived somewhere the user could not see or change.
Naming the plugin `folder` made it worse: the name reads like infrastructure,
which is why its rule got treated as a default rather than as one library's
answer.

## Decision

Two changes, one idea.

**The plugin is named for what it is.** `yukifile.folder` became
`yukifile.explorer`. It is a file explorer: it records every file and every
folder, nothing is left out and nothing is grouped. That is a rule, not a
default, and the name now says so.

**A library declares which plugins it runs**, in `.yukifile/plugins.json`.
Discovery still reads the directory; `plugin::enabled` filters what the
registry loads. Absent means all, so no existing library changes behaviour.

## Consequences

Opting out requires naming what you do want rather than what you do not. That
is the right way round -- the file then says what the library runs, which is
the thing worth reading -- but it does mean a library wanting everything except
one plugin has to list the rest.

**Disabling a plugin does not undo what it recorded.** The 441 objects were
written by an import, and turning the explorer off going forward leaves them
where they are. Withdrawing what an import created is real work and does not
exist yet; today the answer is a fresh library.

There is no interface for editing the list. It is a file, edited by hand, and a
toggle in the application is the obvious next thing rather than a missing part
of this one.
