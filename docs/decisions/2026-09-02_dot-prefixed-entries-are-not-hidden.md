# A leading dot does not hide anything

Date: 2026-09-02
Status: accepted

## Context

Scanners skip dot-prefixed entries. It is the Unix convention, every file
manager does it, and every walk library offers it as a default.

Counting the seed library says not to:

```
objects in the library                     174
whose path starts with a dot-segment       137
```

The top-level grouping is `.MIYOYUGI/`, `.AVATARS/`, `.APLUGINS/`,
`.MARYCIA/`, `.AASHAREE/`, `.LAPWING/` — twelve such folders, alongside four
without a dot (`BDSM/`, `NSFW/`, `Airi_Ver1.00/`).

That is not hiding. A dot sorts before a letter in a file manager, so the user
prefixed the folders they open most and left the rest alone. Applying the
convention would have lost 79% of the library, and lost it *silently*: the scan
would report 37 objects and no error.

## Decision

The walk reports dot-prefixed files and directories like any other.

One exception: `.yukifile/`, which holds the library's own database and covers.
It is excluded wherever it appears in the tree, including inside a copy of one
library nested in another. That is not a convention being applied — it is the
one directory that is definitionally not part of what the library holds.

There is no configuration for this. A setting would be one nobody knows to
look for at the moment it matters, which is the same objection that refused
per-field source priority in `2026-09-01_object-property-model.md`.

## Consequences

Anything the user can see in a file manager, the scan sees too. The rule a user
can state is "Yukifile shows what is in the folder", with no footnote.

A library that genuinely contains dot-directories meant as hidden — a `.git`
checkout, a `.venv` — has them scanned. Those are objects like any other and a
user who does not want them can say so; the alternative is guessing which
leading dots mean "hide me" and which mean "sort me first", and the seed data
proves the guess would be wrong far more often than right.

The convention is not universal in the first place: it comes from an accident
in an early `ls` implementation, and Windows has no notion of it. A
cross-platform library manager inheriting it would be inheriting a bug.
