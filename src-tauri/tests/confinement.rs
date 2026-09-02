//! A path a plugin names must stay inside the library.
//!
//! `plugin::commands::ALLOWED` says `archive.list` and `hash.of` only read.
//! What a list cannot say is *what* they may read, and plugins are TypeScript
//! passing strings. Without the check these tests cover, "read-only" would
//! mean read-only access to the whole disk through a command whose stated
//! reason is listing a zip.
//!
//! This is a separate file from `boundary.rs` because it checks a different
//! kind of promise. The boundary tests read source and ask whether the code is
//! shaped right; these run the code and ask whether it refuses.

use std::fs;

use rusqlite::Connection;
use yukifile::bridge::error::BridgeError;
use yukifile::bridge::Library;

/// A library rooted in a fresh temporary directory.
fn library() -> (Library, tempdir::Dir) {
    let dir = tempdir::Dir::new();
    fs::write(dir.path().join("inside.txt"), b"in the library").expect("write");
    fs::create_dir(dir.path().join("sub")).expect("mkdir");
    fs::write(dir.path().join("sub").join("deep.txt"), b"deeper").expect("write");

    let connection = Connection::open_in_memory().expect("open");
    let library = Library::new(dir.path(), connection).expect("library");
    (library, dir)
}

#[test]
fn a_path_inside_the_library_resolves() {
    let (library, _dir) = library();

    let resolved = library.resolve("inside.txt").expect("should resolve");
    assert!(resolved.starts_with(library.root()));
}

#[test]
fn a_nested_path_resolves() {
    let (library, _dir) = library();

    assert!(library.resolve("sub/deep.txt").is_ok());
}

#[test]
fn a_parent_escape_is_refused() {
    // The plain case, and the one every reviewer checks for.
    let (library, _dir) = library();

    assert!(matches!(
        library.resolve("../secret.txt"),
        Err(BridgeError::OutsideLibrary(_)) | Err(BridgeError::NotFound(_))
    ));
}

#[test]
fn an_escape_that_exists_outside_is_refused_rather_than_read() {
    // The parent directory really holds this file, so a check that only
    // reported "not found" would be passing for the wrong reason. This is the
    // case that separates a refusal from an accident.
    let (library, dir) = library();
    let outside = dir.path().parent().expect("has a parent").join("outside.txt");
    fs::write(&outside, b"not yours").expect("write");

    let attempt = library.resolve("../outside.txt");
    let _ = fs::remove_file(&outside);

    assert!(
        matches!(attempt, Err(BridgeError::OutsideLibrary(_))),
        "an existing file outside the library was reachable: {attempt:?}"
    );
}

#[test]
fn a_winding_escape_is_refused() {
    // `a/../../b` normalises to `../b`. Checking the spelling rather than the
    // resolved path is what misses this.
    let (library, dir) = library();
    let outside = dir.path().parent().expect("has a parent").join("winding.txt");
    fs::write(&outside, b"not yours").expect("write");

    let attempt = library.resolve("sub/../../winding.txt");
    let _ = fs::remove_file(&outside);

    assert!(matches!(attempt, Err(BridgeError::OutsideLibrary(_))), "{attempt:?}");
}

#[test]
fn an_absolute_path_is_refused() {
    let (library, _dir) = library();

    let absolute = if cfg!(windows) { r"C:\Windows\win.ini" } else { "/etc/passwd" };
    assert!(matches!(
        library.resolve(absolute),
        Err(BridgeError::OutsideLibrary(_))
    ));
}

#[test]
#[cfg(windows)]
fn a_drive_relative_path_is_refused() {
    // `C:file` is NOT absolute by Path::is_absolute -- it means "file, on
    // whatever the current directory of drive C happens to be" -- and joining
    // it onto the root discards the root entirely.
    let (library, _dir) = library();

    assert!(
        matches!(library.resolve("C:Windows"), Err(BridgeError::OutsideLibrary(_))),
        "a drive-relative path escaped"
    );
}

#[test]
#[cfg(windows)]
fn a_prefixed_path_is_refused_without_touching_the_disk() {
    // The containment check would refuse these anyway, once the path has been
    // resolved. Refusing them earlier is what keeps the answer from depending
    // on whether the file exists: with only the late check, a missing target
    // reports NotFound and an existing one reports OutsideLibrary, which tells
    // a plugin what sits on the user's other drives.
    //
    // Both of these are refused the same way, and neither exists.
    let (library, _dir) = library();

    for probe in [r"C:definitely-not-here-8f3a", r"\\?\C:\definitely-not-here-8f3a"] {
        assert!(
            matches!(library.resolve(probe), Err(BridgeError::OutsideLibrary(_))),
            "{probe} was answered with something other than a flat refusal"
        );
    }
}

#[test]
#[cfg(windows)]
fn a_verbatim_prefix_is_refused() {
    let (library, _dir) = library();

    assert!(matches!(
        library.resolve(r"\\?\C:\Windows\win.ini"),
        Err(BridgeError::OutsideLibrary(_))
    ));
}

#[test]
fn a_leading_slash_does_not_escape() {
    // On Windows `/abs` is not absolute and joins onto the root's drive,
    // landing outside the library while passing both an is_absolute check and
    // a prefix check. Only comparing the resolved path catches it.
    let (library, _dir) = library();

    assert!(library.resolve("/inside.txt").is_err());
}

#[test]
fn an_empty_path_is_refused() {
    let (library, _dir) = library();

    assert!(matches!(library.resolve(""), Err(BridgeError::BadRequest(_))));
}

#[test]
fn a_sibling_directory_sharing_the_roots_name_is_outside() {
    // The classic prefix bug: comparing paths as strings makes
    // `/lib/seed_other` look like it starts with `/lib/seed`. Path::starts_with
    // compares components, so this must be refused.
    let (library, dir) = library();
    let name = dir.path().file_name().expect("named").to_string_lossy().to_string();
    let sibling = dir.path().parent().expect("parent").join(format!("{name}_other"));
    fs::create_dir_all(&sibling).expect("mkdir");
    fs::write(sibling.join("peek.txt"), b"not yours").expect("write");

    let attempt = library.resolve(&format!("../{name}_other/peek.txt"));
    let _ = fs::remove_dir_all(&sibling);

    assert!(matches!(attempt, Err(BridgeError::OutsideLibrary(_))), "{attempt:?}");
}

#[test]
fn the_error_does_not_name_the_users_disk() {
    // A plugin has no business learning where the library sits. The message
    // repeats what the plugin already sent, not what the core resolved it to.
    let (library, _dir) = library();

    let error = library.resolve("../../elsewhere").expect_err("refused");
    let message = error.to_string();

    let root = library.root().display().to_string();
    assert!(
        !message.contains(&root),
        "the refusal leaked the library root: {message}"
    );
}

/// A temporary directory that cleans up when dropped.
///
/// Written here rather than pulled in as a dependency: it is nine lines, and
/// the crate that would replace it is unmaintained.
mod tempdir {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    pub struct Dir(PathBuf);

    impl Dir {
        pub fn new() -> Self {
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("yukifile-confine-{}-{n}", std::process::id()));
            std::fs::create_dir_all(&path).expect("create temp dir");
            Self(path)
        }

        pub fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
