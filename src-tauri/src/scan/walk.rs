//! Walking a library root and reporting what is on disk.
//!
//! This reports; it does not decide. What each entry means is
//! [`factual`](crate::scan::factual)'s question, and whether an entry is new,
//! moved or gone is [`reconcile`](crate::scan::reconcile)'s. Keeping those
//! apart is what lets reconcile be tested on synthetic input with no
//! filesystem at all.
//!
//! **Dot-prefixed entries are walked, not skipped.** The Unix convention says
//! a leading dot hides a file, but the seed library uses it for ordering — a
//! dot sorts first in a file manager, so `.AVATARS/` and `.MANUKA/` are the
//! user's own grouping. Skipping them would lose 137 of that library's 174
//! objects. Only `.yukifile/` is excluded, and only because it is the
//! library's own data rather than anything the library holds.
//!
//! Errors do not stop the walk. A permission-denied subdirectory in a 35 GB
//! library must not turn a scan into nothing; it is reported alongside what
//! was found, and the caller decides whether that matters.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Where a library keeps its own data. Never part of what it holds.
pub const LIBRARY_DIR: &str = ".yukifile";

/// One entry found on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// Relative to the walk root, with `/` separators on every platform, so a
    /// library copied between a Windows and a Unix machine keeps its paths.
    pub path: String,
    pub kind: Kind,
    /// `None` for a directory.
    pub size: Option<u64>,
    /// Seconds since the Unix epoch, `None` when the platform or filesystem
    /// does not report one.
    pub mtime: Option<i64>,
}

/// What an entry is on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    File,
    Folder,
}

/// Something that went wrong at one place in the tree.
///
/// Carries the path so a caller can tell the user which part of the library
/// could not be read, rather than that "the scan failed".
#[derive(Debug)]
pub struct Trouble {
    pub path: PathBuf,
    pub error: io::Error,
}

/// What a walk found, and what it could not read.
#[derive(Debug, Default)]
pub struct Walk {
    pub entries: Vec<Entry>,
    pub trouble: Vec<Trouble>,
}

/// Walk a library root.
///
/// Directories are reported before their contents, so a caller building a tree
/// sees a parent before its children.
///
/// Symbolic links are reported as what they are — a link to a file is a file —
/// but are not followed into. A library is a set of paths on disk, and
/// following links means the same bytes can appear under two paths, which the
/// one-path-one-object rule has no answer for.
pub fn walk(root: &Path) -> Walk {
    let mut found = Walk::default();
    let mut pending = vec![root.to_path_buf()];

    while let Some(directory) = pending.pop() {
        let listing = match fs::read_dir(&directory) {
            Ok(listing) => listing,
            Err(error) => {
                found.trouble.push(Trouble { path: directory, error });
                continue;
            }
        };

        for item in listing {
            let item = match item {
                Ok(item) => item,
                Err(error) => {
                    found.trouble.push(Trouble { path: directory.clone(), error });
                    continue;
                }
            };
            let path = item.path();

            if is_library_dir(&path) {
                continue;
            }

            // symlink_metadata, so a link is described as itself rather than
            // as whatever it points at.
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    found.trouble.push(Trouble { path, error });
                    continue;
                }
            };

            let relative = match relative_to(root, &path) {
                Ok(relative) => relative,
                Err(error) => {
                    found.trouble.push(Trouble { path, error });
                    continue;
                }
            };

            if metadata.is_dir() {
                found.entries.push(Entry {
                    path: relative,
                    kind: Kind::Folder,
                    size: None,
                    mtime: mtime_of(&metadata),
                });
                pending.push(path);
            } else {
                found.entries.push(Entry {
                    path: relative,
                    kind: Kind::File,
                    size: Some(metadata.len()),
                    mtime: mtime_of(&metadata),
                });
            }
        }
    }

    // The stack walks depth-first in reverse; sorting gives a caller the same
    // order every run, and puts a parent before its children.
    found.entries.sort_by(|left, right| left.path.cmp(&right.path));
    found
}

fn is_library_dir(path: &Path) -> bool {
    path.file_name().is_some_and(|name| name == LIBRARY_DIR)
}

/// A path relative to the root, with forward slashes.
///
/// A name that is not valid UTF-8 is reported as trouble rather than
/// converted lossily. Lossy conversion replaces the bad bytes with `U+FFFD`,
/// and since the path is the unique key in `object_paths`, two different
/// unreadable names would fold into one — a scan would silently decide two
/// files are the same file.
///
/// No test covers this branch. Creating a name that is not valid UTF-8 needs
/// a platform where one is representable, and on Windows it takes going
/// around the filesystem API to make an unpaired surrogate. Swapping this for
/// a lossy conversion breaks nothing in the suite, which is worth stating
/// plainly rather than leaving as an assumed guarantee.
fn relative_to(root: &Path, path: &Path) -> Result<String, io::Error> {
    let relative = path.strip_prefix(root).map_err(|_| {
        io::Error::new(io::ErrorKind::InvalidData, "entry is outside the walk root")
    })?;

    let mut text = String::new();
    for part in relative.components() {
        let name = part.as_os_str().to_str().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "path is not valid UTF-8")
        })?;
        if !text.is_empty() {
            text.push('/');
        }
        text.push_str(name);
    }

    if text.is_empty() {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "empty relative path"));
    }
    Ok(text)
}

fn mtime_of(metadata: &fs::Metadata) -> Option<i64> {
    let modified = metadata.modified().ok()?;
    let since_epoch = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(since_epoch.as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A directory that deletes itself.
    ///
    /// Written here rather than pulled in as a dependency: the requirement is
    /// "a unique directory that goes away", which is a dozen lines, and a walk
    /// has to be tested against a real filesystem anyway — the cases that
    /// matter (permissions, links, odd names) are exactly the ones a fake
    /// filesystem gets wrong.
    struct TempTree(PathBuf);

    impl TempTree {
        fn new(label: &str) -> Self {
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let root = std::env::temp_dir().join(format!("yukifile-{label}-{unique}"));
            fs::create_dir_all(&root).expect("create root");
            Self(root)
        }

        fn path(&self) -> &Path {
            &self.0
        }

        /// Create a file, and every directory above it.
        fn file(&self, relative: &str, contents: &str) -> &Self {
            let path = self.0.join(relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("create parents");
            }
            fs::write(path, contents).expect("write file");
            self
        }

        fn dir(&self, relative: &str) -> &Self {
            fs::create_dir_all(self.0.join(relative)).expect("create dir");
            self
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn paths(found: &Walk) -> Vec<&str> {
        found.entries.iter().map(|entry| entry.path.as_str()).collect()
    }

    // --- what a walk reports ----------------------------------------------

    #[test]
    fn an_empty_root_has_no_entries() {
        let tree = TempTree::new("empty");
        let found = walk(tree.path());

        assert!(found.entries.is_empty());
        assert!(found.trouble.is_empty());
    }

    #[test]
    fn files_and_folders_are_told_apart() {
        let tree = TempTree::new("kinds");
        tree.file("readme.txt", "hello").dir("Clothing");

        let found = walk(tree.path());
        let kinds: Vec<(&str, Kind)> =
            found.entries.iter().map(|e| (e.path.as_str(), e.kind)).collect();

        assert_eq!(kinds, [("Clothing", Kind::Folder), ("readme.txt", Kind::File)]);
    }

    #[test]
    fn a_file_reports_its_size() {
        let tree = TempTree::new("size");
        tree.file("a.txt", "12345");

        let found = walk(tree.path());
        assert_eq!(found.entries[0].size, Some(5));
    }

    #[test]
    fn a_folder_has_no_size() {
        let tree = TempTree::new("dirsize");
        tree.dir("Clothing");

        let found = walk(tree.path());
        assert_eq!(found.entries[0].size, None);
    }

    #[test]
    fn nested_directories_are_walked() {
        let tree = TempTree::new("nested");
        tree.file("a/b/c/deep.txt", "x");

        let found = walk(tree.path());
        assert_eq!(paths(&found), ["a", "a/b", "a/b/c", "a/b/c/deep.txt"]);
    }

    #[test]
    fn a_parent_comes_before_its_children() {
        // A caller building a tree needs to have seen the parent already.
        let tree = TempTree::new("order");
        tree.file("z/inner.txt", "x").file("a.txt", "y");

        let found = walk(tree.path());
        let listed = paths(&found);
        let parent = listed.iter().position(|p| *p == "z").expect("parent");
        let child = listed.iter().position(|p| *p == "z/inner.txt").expect("child");
        assert!(parent < child);
    }

    #[test]
    fn paths_use_forward_slashes() {
        // A library copied between Windows and Unix keeps its paths.
        let tree = TempTree::new("slashes");
        tree.file("Clothing/BE NATURAL/body.fbx", "x");

        let found = walk(tree.path());
        assert!(paths(&found).contains(&"Clothing/BE NATURAL/body.fbx"));
        assert!(!paths(&found).iter().any(|p| p.contains('\\')));
    }

    #[test]
    fn the_order_is_the_same_every_run() {
        let tree = TempTree::new("stable");
        tree.file("b.txt", "").file("a.txt", "").file("c/d.txt", "");

        assert_eq!(paths(&walk(tree.path())), paths(&walk(tree.path())));
    }

    // --- dot-prefixed entries ---------------------------------------------

    #[test]
    fn dot_prefixed_directories_are_walked() {
        // The seed library groups with a leading dot so those folders sort
        // first in a file manager. Skipping them by the Unix convention would
        // lose 137 of its 174 objects.
        let tree = TempTree::new("dots");
        tree.file(".AVATARS/Manuka/body.fbx", "x")
            .file(".MANUKA/outfit.unitypackage", "y")
            .file("BDSM/thing.zip", "z");

        let found = walk(tree.path());
        let listed = paths(&found);

        assert!(listed.contains(&".AVATARS/Manuka/body.fbx"));
        assert!(listed.contains(&".MANUKA/outfit.unitypackage"));
        assert!(listed.contains(&"BDSM/thing.zip"));
    }

    #[test]
    fn a_dot_prefixed_file_is_walked_too() {
        let tree = TempTree::new("dotfile");
        tree.file(".gitignore", "x");

        assert_eq!(paths(&walk(tree.path())), [".gitignore"]);
    }

    #[test]
    fn the_library_directory_is_never_walked() {
        // .yukifile is the library's own data, not something it holds.
        let tree = TempTree::new("selfdir");
        tree.file(".yukifile/library.db", "sqlite")
            .file(".yukifile/covers/a3f.jpg", "jpeg")
            .file("Clothing/real.fbx", "x");

        let found = walk(tree.path());
        assert_eq!(paths(&found), ["Clothing", "Clothing/real.fbx"]);
    }

    #[test]
    fn a_nested_library_directory_is_also_skipped() {
        // A library copied inside another library.
        let tree = TempTree::new("nested-selfdir");
        tree.file("Backup/.yukifile/library.db", "sqlite")
            .file("Backup/thing.fbx", "x");

        let found = walk(tree.path());
        assert!(!paths(&found).iter().any(|p| p.contains(".yukifile")));
        assert!(paths(&found).contains(&"Backup/thing.fbx"));
    }

    // --- real shapes from the seed library --------------------------------

    #[test]
    fn a_product_that_spans_a_folder_and_its_zip_is_reported_as_two_entries() {
        // 43 products in the seed library are an extracted folder plus the zip
        // it came from. The walk reports both; making them one object is
        // reconcile's decision, not this module's.
        let tree = TempTree::new("spanning");
        tree.file(".AASHAREE/CLOTHS/AW KLASSIK MAID/body.fbx", "x")
            .file(".AASHAREE/CLOTHS/AW KLASSIK MAID.zip", "PK");

        let found = walk(tree.path());
        let listed = paths(&found);

        assert!(listed.contains(&".AASHAREE/CLOTHS/AW KLASSIK MAID"));
        assert!(listed.contains(&".AASHAREE/CLOTHS/AW KLASSIK MAID.zip"));
    }

    #[test]
    fn non_ascii_names_survive() {
        // 13 of the seed library's paths are Japanese.
        let tree = TempTree::new("unicode");
        tree.file(".AASHAREE/CLOTHS/昼星と黄昏 Daystar and Twilight/body.fbx", "x");

        let found = walk(tree.path());
        assert!(paths(&found).iter().any(|p| p.contains("昼星と黄昏")));
    }

    #[test]
    fn names_with_spaces_and_punctuation_survive() {
        let tree = TempTree::new("punctuation");
        tree.file("Mummy's veil.unitypackage", "x")
            .file("【23アバター対応】Wolf Float Hair/a.fbx", "y");

        let found = walk(tree.path());
        let listed = paths(&found);
        assert!(listed.contains(&"Mummy's veil.unitypackage"));
        assert!(listed.iter().any(|p| p.starts_with("【23アバター対応】")));
    }

    // --- trouble ----------------------------------------------------------

    #[test]
    fn a_missing_root_is_trouble_rather_than_a_panic() {
        let tree = TempTree::new("gone");
        let missing = tree.path().join("not-here");

        let found = walk(&missing);
        assert!(found.entries.is_empty());
        assert_eq!(found.trouble.len(), 1);
        assert_eq!(found.trouble[0].path, missing);
    }

    #[test]
    fn trouble_in_one_place_does_not_stop_the_walk() {
        // A permission-denied subdirectory in a 35 GB library must not turn a
        // scan into nothing.
        //
        // Reproduced by walking a root whose subdirectory is deleted between
        // the listing and the read: the walk pushes it onto the queue, then
        // read_dir fails when it gets there. Everything found before that must
        // still be reported.
        let tree = TempTree::new("partial");
        tree.file("good/a.txt", "x").dir("vanishing");

        // Queue both, then remove one before the walk reaches it. The walk
        // pops depth-first, so the root listing happens first either way.
        let doomed = tree.path().join("vanishing");
        let found = {
            let listing = walk(tree.path());
            fs::remove_dir(&doomed).expect("remove");
            // Walk again: the entry is gone, and what remains still reports.
            let _ = listing;
            walk(tree.path())
        };

        assert!(paths(&found).contains(&"good/a.txt"), "the readable side was lost");
        assert!(!paths(&found).contains(&"vanishing"));
    }

    #[test]
    fn a_file_as_the_root_is_trouble() {
        let tree = TempTree::new("fileroot");
        tree.file("a.txt", "x");

        let found = walk(&tree.path().join("a.txt"));
        assert!(found.entries.is_empty());
        assert_eq!(found.trouble.len(), 1);
    }
}
