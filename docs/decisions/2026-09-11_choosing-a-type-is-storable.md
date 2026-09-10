# Choosing a type is a fact worth storing

**Date:** 2026-09-11
**Status:** accepted

## The problem

An object is what its properties say it is — plural, chosen by a person, never
guessed. The picker is where that choice happens, and it is multi-select: a PDF
can be a paper and a VRChat asset at once, each contributing its own fields.

Carried properties were derived from the values stored under them. So a person
who picked "VRChat", was shown its form, filled nothing in, and confirmed got an
object carrying nothing. No panel, no viewer, no region, and no message saying
the choice had been dropped.

Under multi-select that is the common case, not an edge one. Cancelling discards
everything, so people confirm with some forms still blank rather than lose what
they already typed.

## The mistake this repeats

`paper#1/present = true` was tried earlier and removed; migration V3 deletes
those rows. It looked like the cheap fix and was not: a marker field has to be
understood by flattening, filtered out of every read, and cleaned up when
abandoned. Every reader of values had to know about a value that was not one.

## Decision

`object_properties`, a table beside `object_paths`, recording which properties
an object carries by decision. Migration V4.

`object.flat` now assembles `carries` from three sources, collapsed into a set:
what a person decided, what the object's locations observably bring, and what
values already mention. Only the first survives an empty form.

Flattening is untouched. `plugin_mounts()` still means "mounts that contributed
a field", which is what it should always have meant.

## Why a table rather than a field

The marker costs more everywhere it is read; the table costs once where it is
written. More than that, the two statements are genuinely different — "this is a
paper" is a decision, "this paper has a DOI" is content — and storing only the
second was what lost the first.

`detach` leaves values alone, so undoing a mis-click does not destroy what was
typed before it, and they read back the moment the property returns.

## Consequences

Carrying is now separate from mounting, and the two can disagree. An object may
carry a property the library does not mount; its values wait in storage, which
is what the architecture already said happens.

**Mounting still has no inverse.** The first object to use `paper` mounts it
library-wide, permanently. `detach` undoes one object's choice and cannot undo
the mount. That is probably right, but it makes the picker a one-way door at
library scope and nothing surfaces it yet.

An earlier version of this plan claimed storage needed no changes, on the
grounds that `carries` already read stored properties. It does — through
`plugin_mounts()`, which only reports mounts that contributed a field. Running
the code is what showed the difference.
