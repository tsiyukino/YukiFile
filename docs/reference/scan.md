# scan

What is on disk, what it factually is, and what changed since the last look.

Three modules. `walk` reports what is on disk, `factual` says what an entry
observably is, and `reconcile` says what changed. Only `walk` touches a
filesystem, which is what lets the other two be tested on written-down input.

## scan::walk

`walk(&Path) -> Walk`

```rust
struct Walk { entries: Vec<Entry>, trouble: Vec<Trouble> }
struct Entry { path: String, kind: Kind, size: Option<u64>, mtime: Option<i64> }
enum Kind { File, Folder }
struct Trouble { path: PathBuf, error: io::Error }
```

`Entry.path` is relative to the root with `/` separators on every platform, so
a library copied between Windows and Unix keeps its paths. A folder has no
size. Entries come back sorted, which makes the order the same every run and
puts a parent before its children.

### Dot-prefixed entries are walked

Not skipped. The seed library groups with a leading dot because a dot sorts
first in a file manager, and applying the Unix convention would silently drop
137 of its 174 objects. See
`docs/decisions/2026-09-02_dot-prefixed-entries-are-not-hidden.md`.

`LIBRARY_DIR` (`.yukifile`) is the one exclusion, anywhere in the tree. It
holds the library's own database and covers, so it is definitionally not part
of what the library holds.

### Trouble does not stop a walk

A permission-denied subdirectory in a 35 GB library must not turn a scan into
nothing. Whatever could not be read is reported in `trouble`, with the path so
a caller can say which part of the library was unreadable rather than that
"the scan failed", and everything else still comes back in `entries`.

A name that is not valid UTF-8 is trouble rather than a lossy conversion:
`U+FFFD` substitution would fold two different unreadable names into one path,
and the path is the unique key in `object_paths`. That branch has no test —
Windows will not let one create such a name through the filesystem API — and
the source says so rather than implying coverage.

### Symbolic links

Reported as what they are (a link to a file is a file), never followed into.
Following them lets the same bytes appear under two paths, which the
one-path-one-object rule has no answer for.

## scan::factual

What an entry observably is. A `.pdf` is a pdf; a directory is a folder. The
restraint is the feature: these attach without a person confirming them, so
anything that could be wrong does not belong here.

### The core owns the matching, not the list

`archive`, `pdf`, `image` and the rest come from the built-in modules, which
use the same contribution API as any third-party plugin. This module holds a
`Rules` set and no extension of its own — a plugin adding `.blend` registers a
rule rather than editing the core. `src-tauri/tests/boundary.rs` fails if a
file extension appears in core source.

`FILE` and `FOLDER` are the exception, and the only one. Every entry is one or
the other by definition of being on a filesystem, and a scan that could not
tell them apart until a plugin loaded would have nothing to report.

```rust
let mut rules = Rules::new();
rules.add_all("docx", &["archive", "document", "docx"]);
rules.properties(&entry)   // BTreeSet<String>
```

| method                          | does                                        |
|---------------------------------|---------------------------------------------|
| `add(extension, property)`      | declare one fact about an extension         |
| `add_all(extension, &[..])`     | several at once                             |
| `properties(&entry)`            | what this entry observably is               |
| `known()`                       | every property any rule can attach          |
| `is_empty()`                    | whether any rule is registered              |

Results are sorted and deduplicated, so two scans of one tree produce the same
set and a difference between them means something changed rather than that a
map iterated differently.

Two plugins may claim one extension without either overriding the other — a
`.docx` being both an archive and a document is two facts, not a conflict.

### What it refuses to do

Organising the seed library by hand produced inferences that look reasonable
and are wrong (`seed/vrc-lessons.md`), and this module makes none of them:

- **It does not read inside an archive.** A Santa outfit held 23 files matching
  `Assets/**/Editor/*.cs`, all of them lilToon's shader inspector. "Has editor
  scripts, therefore is a tool" misfiles twelve products.
- **It does not judge a folder by its name.** `Texture/` is sometimes loose
  PNGs belonging to its parent and sometimes a category folder holding
  eighteen products. Excluding by name dropped all eighteen, silently, twice.
- **It never attaches a semantic property.** `vrchat`, `booth`, `paper` and
  `dataset` come from a person. A filename cannot tell a VRChat outfit from a
  research dataset.

A folder whose name ends in something extension-shaped is still a folder:
`Airi_Ver1.00` and `mochi_bob1.0` are directories in the seed library.
`.gitignore` is a file called `.gitignore`, not a file of type `gitignore` —
reachable because dot-prefixed entries are walked.

## scan::reconcile

`reconcile(&[Known], &[Found]) -> Changes`

Pure. It takes what the library holds and what a walk found, and returns the
difference — no filesystem, no database, no clock.

```rust
struct Changes {
    added:      Vec<Added>,       // a path no object claims
    removed:    Vec<Removed>,     // a path an object claims that is gone
    moved:      Vec<Moved>,       // proven by a matching hash
    touched:    Vec<Touched>,     // same path, different size or mtime
    candidates: Vec<MoveCandidate>, // a question, not an answer
}
```

`Changes::is_empty()` ignores candidates: they are questions, and a library
with unanswered questions is not out of date.

### Moves are claimed on evidence, never on resemblance

Getting this wrong one way loses every value and edge attached to an object;
the other way silently merges two things the user kept apart.

**A content hash is the only proof accepted.** `object_paths.hash` is null
until computed — hashing 1518 files must not block a first scan from showing
results — so much of an early reconcile has nothing to go on and says so.

A hash is only proof when it is unique on both sides. A third of the seed
library's archives are redundant copies, so identical content under several
paths is normal, and pairing them arbitrarily would move an object somewhere
the user did not put it. Ambiguous hashes fall through to a removal and an
addition.

### Candidates

Every one of the seed library's 174 moves kept its basename, which makes the
filename look like a reliable signal. It is not: 33 of those products are a
folder and a zip sharing a stem.

So a basename match with no hash becomes a `MoveCandidate` — offered to a
caller that can ask the user or hash both sides and reconcile again. It is
*also* reported as a removal and an addition, so a caller that ignores
candidates is left with a correct if pessimistic answer rather than a lost
object. An ambiguous basename suggests nothing.

### Touched

Same path, different size or mtime. Reported separately from an untouched path
because it is what tells a caller which hashes are stale. A folder has no size,
so its mtime is all there is — and that is enough to say its contents changed.

### Objects with several paths

One location of a spanning object can move while the others stay, and losing
one is a removal of that path rather than a deletion of the object. Whether an
object without locations should survive is the caller's decision; this module
reports paths.
