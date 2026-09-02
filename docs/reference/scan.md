# scan

What is on disk, what it factually is, and what changed since the last look.

One module so far. `walk` reports; it does not decide. What an entry means is
`factual`'s question and whether it is new, moved or gone is `reconcile`'s —
keeping those apart is what lets reconciliation be tested on synthetic input
with no filesystem at all.

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
