# commands

Heavy work the core does on a plugin's behalf.

Scanning, hashing, archive reading and text extraction are Rust because they
have to be fast; plugins are TypeScript because they have to be easy to write.
These are the seam.

**Nothing here runs on its own.** The core does not read every archive it walks
past — a plugin asks, when a plugin has a reason to. That is why this is
`commands` and not a step inside `scan`: opening every zip in a 35 GB library
would put the cost of reading them into a scan that only needed to know the
files exist.

## commands::archive

`list(&Path) -> Result<Listing, ArchiveError>`

Lists what a zip holds without unpacking it. A zip's central directory carries
every entry's name and size, so this costs a seek and a few kilobytes rather
than the gigabyte the archive weighs.

That difference is what makes a third of the seed library visible: 103 archives
were never unpacked, 54 of them holding unitypackages, and a scanner that only
sees loose files is blind to all of it.

```rust
struct Member {
    path: String,           // stored name, `/` separators
    size: u64,              // uncompressed
    compressed_size: u64,
    is_dir: bool,
    escapes_root: bool,
}
```

`Listing` offers `unpacked_size()`, `files()` (skipping the directory entries
some writers include) and `escaping()`.

Members come back sorted, so two listings of one archive agree.

### `escapes_root`

True when the stored name would land outside the archive root if extracted: a
`..` segment, a leading `/`, or a Windows drive letter.

Nothing is extracted here, so this cannot overwrite a file today. It is
reported because the name still reaches a database and a screen, and a caller
that later grows an extract command needs the flag already in the data rather
than discovering it needs one.

The check runs on the stored name **before** separators are normalised, and
splits on separators rather than searching for a substring — `..cache` and
`a..b` are ordinary names.

### Errors

`Unreadable(io::Error)` — the file could not be opened.

`NotAnArchive(String)` — not a zip, or damaged. The seed library has one RAR
that could not be opened at all; that is a fact to record about the object
rather than a scan failure.

A damaged entry in the middle of an otherwise readable archive is skipped, not
fatal: a partly readable archive tells the user more than nothing.

### What it does not do

Decide what the contents mean. A plugin reading the list may conclude things
about it; this module reports names and sizes. Reading inward and concluding
"this is a tool" is the inference that misfiles the twelve seed products
shipping lilToon.

## commands::hash

Content hashes, which are what let a move be told from a delete plus an add.

`reconcile` accepts a matching hash as the only proof of a move. Without one it
reports a removal and an addition, and every value and edge attached to that
object has to be reattached by hand — 174 times, for a reorganisation the size
of the seed library's own.

`of_file(&Path)` · `of_folder(&Path)` · `of_path(&Path)` — all return
`io::Result<String>`.

### Not a security boundary

BLAKE3, for speed rather than for its cryptographic properties. The question is
"are these the same bytes I saw last week", about files already on the user's
own disk. Nothing here defends against a crafted collision, because whoever can
write files into the library can simply edit them.

Files are read in 64 KB chunks rather than loaded whole: the seed library's
largest archive is 84 MB and a library is expected to hold bigger.

### Folders hash their listing, shallowly

A folder has no contents of its own, and most of the seed library's moves moved
folders. So a folder's hash covers the names, kinds and sizes of what it
*directly* holds — no file contents are read.

Shallow on purpose. A deep hash would make a change to one file change the hash
of every folder above it, so editing a texture would report its product, its
category and the library root as all having new content. A test asserts both
halves: the folder holding the file notices, the one above it does not.

The listing is sorted before hashing. No test proves that is load-bearing —
NTFS returns entries in name order anyway — but the guarantee is not the
filesystem's to make, and a filesystem returning them in creation order would
rehash every folder on every scan.
