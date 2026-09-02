//! Content hashes, which are what let a move be told from a delete plus an add.
//!
//! [`reconcile`](crate::scan::reconcile) accepts a matching hash as the only
//! proof that an object moved. Without one it reports a removal and an
//! addition, and every value and edge attached to that object has to be
//! reattached by hand. The seed library's own reorganisation moved 174
//! products, so this is not a rare path.
//!
//! # Not a security boundary
//!
//! BLAKE3, used for speed rather than for its cryptographic properties. The
//! question being asked is "are these the same bytes I saw last week", about
//! files the user already has on their own disk. Nothing here defends against
//! someone crafting a collision, because someone who can write files into the
//! library can simply edit them.
//!
//! # Folders are hashed by their listing
//!
//! A folder has no contents of its own, and most of the seed library's moves
//! moved folders. Hashing the names and sizes of what a folder directly holds
//! gives it an identity that survives being moved and changes when its
//! contents do — without reading a byte of any file inside it.
//!
//! That is deliberately shallow. A deep hash would make every folder above a
//! changed file change too, so touching one texture would report its product,
//! its category and the library root as all having new content.

use std::fs::{self, File};
use std::io::{self, Read};
use std::path::Path;

/// How much to read at a time. Large enough that the syscall overhead is
/// amortised, small enough that a 2 GB unitypackage does not become 2 GB of
/// resident memory.
const CHUNK: usize = 64 * 1024;

/// The hash of a file's contents.
///
/// Streams rather than reading the file in: the seed library's largest single
/// archive is 84 MB, and a library is expected to hold things far bigger.
pub fn of_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0u8; CHUNK];

    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

/// The hash of a folder's direct listing: each child's name, kind and size.
///
/// Shallow on purpose. Recursing would make a change to one file change the
/// hash of every folder above it, so editing a texture would report its
/// product, its category and the library root as all having moved or changed.
/// A folder's identity here is what it directly holds, which is what survives
/// the folder being moved.
pub fn of_folder(path: &Path) -> io::Result<String> {
    let mut children = Vec::new();

    for item in fs::read_dir(path)? {
        let item = item?;
        let metadata = item.metadata()?;

        // Lossy is right here and wrong in `walk`. There, the name becomes a
        // primary key and two unreadable names must not collapse into one;
        // here it is one field of a digest, and refusing to hash a folder
        // because one child has an odd name would lose the whole folder's
        // identity over a detail that does not identify it.
        let name = item.file_name().to_string_lossy().into_owned();
        let kind = if metadata.is_dir() { "d" } else { "f" };
        let size = if metadata.is_dir() { 0 } else { metadata.len() };

        children.push((name, kind, size));
    }

    // Sorted, because read_dir order is the filesystem's business and a
    // folder that hashes differently on each scan would report every folder
    // as changed, every time.
    //
    // No test covers this. NTFS hands these back in name order already, so
    // removing the sort breaks nothing here — but the guarantee is not
    // NTFS's to make, and a library on a filesystem that hands them back in
    // creation order would rehash every folder on every scan.
    children.sort();

    let mut hasher = blake3::Hasher::new();
    for (name, kind, size) in children {
        hasher.update(name.as_bytes());
        hasher.update(b"\0");
        hasher.update(kind.as_bytes());
        hasher.update(b"\0");
        hasher.update(&size.to_le_bytes());
        hasher.update(b"\0");
    }
    Ok(hasher.finalize().to_hex().to_string())
}

/// The hash of whatever is at a path, file or folder.
pub fn of_path(path: &Path) -> io::Result<String> {
    if fs::symlink_metadata(path)?.is_dir() {
        of_folder(path)
    } else {
        of_file(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct TempTree(PathBuf);

    impl TempTree {
        fn new(label: &str) -> Self {
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let root = std::env::temp_dir().join(format!("yukifile-hash-{label}-{unique}"));
            fs::create_dir_all(&root).expect("create");
            Self(root)
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn file(&self, relative: &str, contents: &[u8]) -> PathBuf {
            let path = self.0.join(relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("parents");
            }
            fs::write(&path, contents).expect("write");
            path
        }

        fn dir(&self, relative: &str) -> PathBuf {
            let path = self.0.join(relative);
            fs::create_dir_all(&path).expect("dir");
            path
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    // --- files ------------------------------------------------------------

    #[test]
    fn the_same_bytes_hash_the_same() {
        // The whole point: this is what proves a move rather than a delete
        // plus an add.
        let tree = TempTree::new("same");
        let here = tree.file("old/thing.zip", b"identical contents");
        let there = tree.file("new/thing.zip", b"identical contents");

        assert_eq!(of_file(&here).expect("a"), of_file(&there).expect("b"));
    }

    #[test]
    fn different_bytes_hash_differently() {
        let tree = TempTree::new("differ");
        let a = tree.file("a.txt", b"one");
        let b = tree.file("b.txt", b"two");

        assert_ne!(of_file(&a).expect("a"), of_file(&b).expect("b"));
    }

    #[test]
    fn a_hash_is_stable_across_calls() {
        // An unstable hash would report every file as changed on every scan.
        let tree = TempTree::new("stable");
        let file = tree.file("a.txt", b"contents");

        assert_eq!(of_file(&file).expect("a"), of_file(&file).expect("b"));
    }

    #[test]
    fn a_name_does_not_affect_a_file_hash() {
        // A rename with unchanged contents must still read as the same bytes.
        let tree = TempTree::new("rename");
        let before = tree.file("old-name.zip", b"contents");
        let after = tree.file("completely different name.zip", b"contents");

        assert_eq!(of_file(&before).expect("a"), of_file(&after).expect("b"));
    }

    #[test]
    fn an_empty_file_hashes() {
        let tree = TempTree::new("empty");
        let file = tree.file("empty.txt", b"");

        assert!(!of_file(&file).expect("hash").is_empty());
    }

    #[test]
    fn a_file_larger_than_one_chunk_hashes_correctly() {
        // Streaming: the seed library's largest archive is 84 MB, and a
        // library is expected to hold bigger.
        let tree = TempTree::new("chunks");
        let big = vec![b'x'; CHUNK * 3 + 7];
        let file = tree.file("big.bin", &big);

        let streamed = of_file(&file).expect("streamed");
        let at_once = blake3::hash(&big).to_hex().to_string();

        assert_eq!(streamed, at_once, "chunked reading changed the result");
    }

    #[test]
    fn one_changed_byte_changes_the_hash() {
        let tree = TempTree::new("onebyte");
        let mut contents = vec![b'a'; CHUNK * 2];
        let before = tree.file("a.bin", &contents);
        let first = of_file(&before).expect("first");

        contents[CHUNK + 1] = b'b';
        let after = tree.file("b.bin", &contents);

        assert_ne!(first, of_file(&after).expect("second"));
    }

    #[test]
    fn a_missing_file_is_an_error_not_a_hash() {
        let tree = TempTree::new("missing");
        assert!(of_file(&tree.path().join("nothing")).is_err());
    }

    // --- folders ----------------------------------------------------------

    #[test]
    fn a_folder_hashes_its_listing() {
        let tree = TempTree::new("folder");
        tree.file("product/body.fbx", b"mesh");
        tree.file("product/readme.txt", b"thanks");

        assert!(!of_folder(&tree.path().join("product")).expect("hash").is_empty());
    }

    #[test]
    fn a_moved_folder_keeps_its_hash() {
        // Most of the seed library's 174 moves moved folders.
        let tree = TempTree::new("movedir");
        tree.file(".OLD/AW KLASSIK MAID/body.fbx", b"mesh");
        tree.file(".OLD/AW KLASSIK MAID/readme.txt", b"thanks");
        tree.file("Clothing/AW KLASSIK MAID/body.fbx", b"mesh");
        tree.file("Clothing/AW KLASSIK MAID/readme.txt", b"thanks");

        let before = of_folder(&tree.path().join(".OLD/AW KLASSIK MAID")).expect("a");
        let after = of_folder(&tree.path().join("Clothing/AW KLASSIK MAID")).expect("b");

        assert_eq!(before, after, "a moved folder did not keep its identity");
    }

    #[test]
    fn adding_a_file_changes_a_folder_hash() {
        let tree = TempTree::new("addfile");
        tree.file("product/a.txt", b"x");
        let before = of_folder(&tree.path().join("product")).expect("before");

        tree.file("product/b.txt", b"y");
        let after = of_folder(&tree.path().join("product")).expect("after");

        assert_ne!(before, after);
    }

    #[test]
    fn resizing_a_file_changes_its_folder_hash() {
        let tree = TempTree::new("resize");
        tree.file("product/a.txt", b"short");
        let before = of_folder(&tree.path().join("product")).expect("before");

        tree.file("product/a.txt", b"considerably longer contents");
        let after = of_folder(&tree.path().join("product")).expect("after");

        assert_ne!(before, after);
    }

    #[test]
    fn a_folder_hash_is_shallow() {
        // A deep hash would make editing one texture report its product, its
        // category and the library root as all having changed.
        //
        // The edit has to change the file's *size*, or the product folder's
        // own listing is unchanged too and the test proves nothing about
        // depth. The pair of assertions is the point: the level that holds
        // the file notices, and the level above it does not.
        let tree = TempTree::new("shallow");
        tree.file("category/product/texture.png", b"original");

        let category_before = of_folder(&tree.path().join("category")).expect("cat before");
        let product_before = of_folder(&tree.path().join("category/product")).expect("prod before");

        tree.file("category/product/texture.png", b"a considerably longer replacement");

        let category_after = of_folder(&tree.path().join("category")).expect("cat after");
        let product_after = of_folder(&tree.path().join("category/product")).expect("prod after");

        assert_ne!(product_before, product_after, "the folder holding the file did not notice");
        assert_eq!(category_before, category_after, "a change two levels down reached the top");
    }

    #[test]
    fn a_folder_hash_does_not_depend_on_listing_order() {
        // Pins the behaviour callers depend on. It cannot prove the sort is
        // load-bearing: NTFS returns these in name order anyway, so removing
        // the sort leaves this green. The sort stays because the guarantee is
        // not the filesystem's to make.
        let tree = TempTree::new("order");
        tree.file("one/a.txt", b"x");
        tree.file("one/b.txt", b"y");
        tree.file("one/c.txt", b"z");

        let first = of_folder(&tree.path().join("one")).expect("first");
        let second = of_folder(&tree.path().join("one")).expect("second");

        assert_eq!(first, second);
    }

    #[test]
    fn an_empty_folder_hashes() {
        let tree = TempTree::new("emptydir");
        let empty = tree.dir("nothing");

        assert!(!of_folder(&empty).expect("hash").is_empty());
    }

    #[test]
    fn two_folders_holding_different_things_differ() {
        let tree = TempTree::new("twodirs");
        tree.file("a/thing.txt", b"x");
        tree.file("b/other.txt", b"x");

        assert_ne!(
            of_folder(&tree.path().join("a")).expect("a"),
            of_folder(&tree.path().join("b")).expect("b")
        );
    }

    #[test]
    fn a_folder_and_a_file_of_the_same_name_hash_differently() {
        // 33 seed products are a folder and a zip sharing a stem.
        let tree = TempTree::new("twins");
        tree.file("AW KLASSIK MAID/body.fbx", b"mesh");
        let zip = tree.file("AW KLASSIK MAID.zip", b"mesh");

        assert_ne!(
            of_folder(&tree.path().join("AW KLASSIK MAID")).expect("folder"),
            of_file(&zip).expect("file")
        );
    }

    // --- of_path ----------------------------------------------------------

    #[test]
    fn of_path_picks_the_right_one() {
        let tree = TempTree::new("either");
        let file = tree.file("a.txt", b"x");
        let folder = tree.dir("d");

        assert_eq!(of_path(&file).expect("file"), of_file(&file).expect("direct"));
        assert_eq!(of_path(&folder).expect("folder"), of_folder(&folder).expect("direct"));
    }

    #[test]
    fn of_path_on_something_missing_is_an_error() {
        let tree = TempTree::new("gone");
        assert!(of_path(&tree.path().join("nothing")).is_err());
    }

    // --- what this is for -------------------------------------------------

    #[test]
    fn a_hash_lets_reconcile_prove_a_move() {
        // The end-to-end reason this module exists: without it every move in
        // the seed library's reorganisation reads as a delete plus an add.
        use crate::scan::reconcile::{Found, Known, reconcile};
        use crate::scan::walk::{Entry, Kind};

        let tree = TempTree::new("endtoend");
        let moved = tree.file("Accessory/Endeavor_v1.0.4.zip", b"product bytes");
        let hash = of_file(&moved).expect("hash");

        let library = [Known {
            object: 7,
            path: ".AASHAREE/TRINKETS/Endeavor_v1.0.4.zip".into(),
            kind: Kind::File,
            size: Some(13),
            mtime: Some(1000),
            hash: Some(hash.clone()),
        }];
        let disk = [Found::hashed(
            Entry {
                path: "Accessory/Endeavor_v1.0.4.zip".into(),
                kind: Kind::File,
                size: Some(13),
                mtime: Some(1000),
            },
            &hash,
        )];

        let changes = reconcile(&library, &disk);
        assert_eq!(changes.moved.len(), 1, "the move was not proven");
        assert_eq!(changes.moved[0].object, 7);
    }
}

