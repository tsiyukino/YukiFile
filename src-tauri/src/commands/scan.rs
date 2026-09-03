//! Bringing a library up to date with the disk.
//!
//! Walk the root, work out what changed, apply it. Each of those three already
//! exists — `scan::walk`, `scan::reconcile`, `store::paths` — and this is the
//! order they go in and nothing else. Putting it here rather than in the bridge
//! keeps it callable without an IPC boundary, which is what let it be tested.
//!
//! # Hashing is not free, so it is not automatic
//!
//! Reconcile detects a move by matching hashes, and a hash means reading the
//! file. Hashing 35 GB on every scan to catch the handful of files that moved
//! is the wrong trade, so a first pass runs without hashes and reports what it
//! could not decide: a removal and an addition sharing a basename become a
//! *candidate*, not a move.
//!
//! [`resolve_candidates`] is the second pass, hashing only those files. In the
//! seed library that is a few dozen rather than 1518, and it turns "these might
//! be the same file" into an answer.
//!
//! # An object per location, until something says otherwise
//!
//! A scan creates one object per new path. It does not decide that a folder
//! and the zip beside it are one product — that judgement needs evidence a
//! scan does not have, and `seed/vrc-lessons.md` records what guessing costs.
//! Merging two objects into one is a later, deliberate act.

use std::path::Path;

use rusqlite::Connection;

use crate::commands::hash;
use crate::scan::factual::Rules;
use crate::scan::reconcile::{self, Changes, Found, Step};
use crate::scan::walk;
use crate::store::paths;
use crate::store::values::Values;

/// Why a scan could not finish.
#[derive(Debug)]
pub enum ScanError {
    Storage(rusqlite::Error),
    /// A value could not be written. A scan writes only paths it builds
    /// itself, so this is a defect here rather than bad input.
    Write(crate::store::values::WriteError),
}

impl std::fmt::Display for ScanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Storage(error) => write!(f, "{error}"),
            Self::Write(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for ScanError {}

impl From<rusqlite::Error> for ScanError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(error)
    }
}

impl From<crate::store::values::WriteError> for ScanError {
    fn from(error: crate::store::values::WriteError) -> Self {
        Self::Write(error)
    }
}

/// What a scan did.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Scanned {
    /// Locations recorded for the first time.
    pub added: usize,
    /// Locations an object no longer has.
    pub removed: usize,
    /// Locations that changed path without changing content.
    pub moved: usize,
    /// Locations whose size or mtime changed.
    pub touched: usize,
    /// Objects created, one per added path with nothing to attach it to.
    pub objects_created: usize,
    /// Removals and additions that share a basename, with no hash to decide.
    /// Hashing them is [`resolve_candidates`].
    pub candidates: usize,
    /// Paths that could not be read, with the reason.
    pub unreadable: Vec<String>,
}

/// Which entries a scan is allowed to skip.
///
/// The library's own data directory, and nothing else. A leading dot is not on
/// this list: `2026-09-02_dot-prefixed-entries-are-not-hidden.md` measured 137
/// of 174 seed paths starting with one, so the Unix convention would have
/// hidden most of the library.
const SKIP: &[&str] = &[".yukifile"];

/// Look at the disk and record what changed.
///
/// Belongs inside a transaction: half a scan is a library whose paths describe
/// a disk that never existed.
pub fn run(
    connection: &Connection,
    values: &mut Values,
    root: &Path,
    rules: &Rules,
) -> Result<Scanned, ScanError> {
    let walked = walk::walk(root);
    let known = paths::known(connection)?;

    let found: Vec<Found> = walked
        .entries
        .iter()
        .filter(|entry| !skipped(&entry.path))
        .map(|entry| Found::new(entry.clone()))
        .collect();

    let changes = reconcile::reconcile(&known, &found);
    let mut outcome = apply(connection, values, &changes, rules)?;

    outcome.unreadable = walked
        .trouble
        .iter()
        .map(|trouble| trouble.path.display().to_string())
        .collect();

    Ok(outcome)
}

/// Apply what reconcile worked out, in the order it says.
///
/// The order is not a preference: a move updates a path in place and a removal
/// deletes one, so applying a removal first turns a move into a delete plus an
/// add — undoing the care reconcile took to tell them apart.
fn apply(
    connection: &Connection,
    values: &mut Values,
    changes: &Changes,
    rules: &Rules,
) -> Result<Scanned, ScanError> {
    let mut outcome = Scanned { candidates: changes.candidates.len(), ..Scanned::default() };

    for step in changes.steps() {
        match step {
            Step::Move(moved) => {
                paths::move_path(connection, &moved.from, &moved.to)?;
                outcome.moved += 1;
            }
            Step::Touch(touched) => {
                paths::touch(connection, &touched.path, touched.size, touched.mtime)?;
                outcome.touched += 1;
            }
            Step::Remove(removed) => {
                paths::forget(connection, &removed.path)?;
                outcome.removed += 1;
            }
            Step::Add(added) => {
                let object = values.create_object(connection)?;
                outcome.objects_created += 1;

                paths::record(
                    connection,
                    object,
                    &added.path,
                    added.kind,
                    added.size,
                    added.mtime,
                    None,
                )?;
                outcome.added += 1;

                mount_factual(connection, added, rules)?;
            }
        }
    }

    Ok(outcome)
}

/// Mount whatever the entry observably is.
///
/// Factual properties only: a `.pdf` is a pdf. Nothing here infers that an
/// archive is an outfit, because the software cannot tell and a confident
/// wrong answer is worse than a blank.
///
/// Mounting and not writing. Resolution drops values under an unmounted
/// property, so a property has to be mounted for anything later to be
/// readable — but the property itself is a fact about the entry rather than a
/// field with a value, and writing a marker to represent it put a row reading
/// "present: true" on every object page.
fn mount_factual(
    connection: &Connection,
    added: &reconcile::Added,
    rules: &Rules,
) -> Result<(), ScanError> {
    let entry = walk::Entry {
        path: added.path.clone(),
        kind: added.kind,
        size: added.size,
        mtime: added.mtime,
    };

    // Mounting is what makes a property's values readable: resolution drops
    // values under a property the library does not mount.
    //
    // Nothing is written under the property itself. A factual property is a
    // fact about the entry, not a field with a value, and the marker this used
    // to write -- `file#1/present = true` -- put a row reading "present: true"
    // on every object page, which is a sentence that says nothing. What the
    // object carries is answered by its locations and by whichever plugin
    // fills the property in.
    for property in rules.properties(&entry) {
        crate::store::values::mount(connection, &property, 1)?;
    }

    Ok(())
}

/// Hash the paths a first pass could not decide between, and rerun.
///
/// Only the candidates are hashed — a few dozen rather than the whole library.
/// Returns what changed on the second look, which is normally the moves the
/// first pass had to report as questions.
pub fn resolve_candidates(
    connection: &Connection,
    values: &mut Values,
    root: &Path,
    rules: &Rules,
    changes: &Changes,
) -> Result<Scanned, ScanError> {
    if changes.candidates.is_empty() {
        return Ok(Scanned::default());
    }

    // Hash both sides of every candidate: the path on disk to know what it is
    // now, and the recorded path to know what the library thought it was.
    for candidate in &changes.candidates {
        // Hash the file at its new spelling and record that hash against the
        // path the library still believes in. The next reconcile sees the two
        // agree and reports a move rather than a question.
        let on_disk = root.join(&candidate.to);
        let Ok(digest) = hash::of_path(&on_disk) else { continue };

        connection.execute(
            "UPDATE object_paths SET hash = ?2 WHERE path = ?1",
            rusqlite::params![candidate.from, digest],
        )?;
    }

    run(connection, values, root, rules)
}

/// Whether an entry is the library's own data.
fn skipped(path: &str) -> bool {
    path.split('/').any(|segment| SKIP.contains(&segment))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::schema;

    struct Dir(std::path::PathBuf);

    impl Dir {
        fn new(tag: &str) -> Self {
            use std::sync::atomic::{AtomicU32, Ordering};
            static COUNTER: AtomicU32 = AtomicU32::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("yukifile-scan-{tag}-{}-{n}", std::process::id()));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).expect("create");
            Self(path)
        }

        fn file(&self, name: &str, bytes: &[u8]) -> &Self {
            let full = self.0.join(name);
            if let Some(parent) = full.parent() {
                std::fs::create_dir_all(parent).expect("mkdir");
            }
            std::fs::write(full, bytes).expect("write");
            self
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn library() -> Connection {
        let mut connection = Connection::open_in_memory().expect("open");
        schema::migrate(&mut connection).expect("migrate");
        connection.pragma_update(None, "foreign_keys", true).expect("fk");
        connection
    }

    #[test]
    fn a_first_scan_records_what_is_there() {
        let dir = Dir::new("first");
        dir.file("a.txt", b"one").file("b.txt", b"two");

        let connection = library();
        let mut values = Values::new();
        let outcome =
            run(&connection, &mut values, dir.path(), &Rules::new()).expect("scan");

        assert_eq!(outcome.added, 2);
        assert_eq!(outcome.objects_created, 2);
        assert_eq!(paths::known(&connection).expect("known").len(), 2);
    }

    #[test]
    fn scanning_twice_changes_nothing_the_second_time() {
        // The property that makes a scan safe to run on a timer or a button.
        let dir = Dir::new("twice");
        dir.file("a.txt", b"one");

        let connection = library();
        let mut values = Values::new();
        run(&connection, &mut values, dir.path(), &Rules::new()).expect("first");
        let second = run(&connection, &mut values, dir.path(), &Rules::new()).expect("second");

        assert_eq!(second.added, 0);
        assert_eq!(second.objects_created, 0, "a second object was invented");
        assert_eq!(paths::known(&connection).expect("known").len(), 1);
    }

    #[test]
    fn a_folder_is_recorded_as_well_as_its_contents() {
        // A folder is an object in its own right: 43 seed products are a
        // folder plus the zip beside it, and the folder is the thing a person
        // opens.
        let dir = Dir::new("folder");
        dir.file("Outfit/skin.png", b"png");

        let connection = library();
        let mut values = Values::new();
        let outcome =
            run(&connection, &mut values, dir.path(), &Rules::new()).expect("scan");

        assert_eq!(outcome.added, 2, "the folder and the file");
    }

    #[test]
    fn the_librarys_own_data_is_not_scanned() {
        // Otherwise the database ends up as an object in the library it
        // describes, and every scan finds it changed.
        let dir = Dir::new("skip");
        dir.file(".yukifile/library.db", b"not a real database")
            .file("a.txt", b"one");

        let connection = library();
        let mut values = Values::new();
        let outcome =
            run(&connection, &mut values, dir.path(), &Rules::new()).expect("scan");

        let recorded = paths::known(&connection).expect("known");
        assert!(
            !recorded.iter().any(|k| k.path.contains(".yukifile")),
            "the library scanned its own data: {recorded:?}"
        );
        assert_eq!(outcome.added, 1);
    }

    #[test]
    fn a_dot_prefixed_entry_is_not_hidden() {
        // 137 of 174 seed paths start with a dot segment. Skipping them by
        // convention would hide most of the library.
        let dir = Dir::new("dotted");
        dir.file(".AASHAREE/CLOTHS/outfit.zip", b"zip");

        let connection = library();
        let mut values = Values::new();
        run(&connection, &mut values, dir.path(), &Rules::new()).expect("scan");

        let recorded = paths::known(&connection).expect("known");
        assert!(
            recorded.iter().any(|k| k.path.starts_with(".AASHAREE")),
            "a dot-prefixed path was skipped"
        );
    }

    #[test]
    fn a_deleted_file_is_forgotten() {
        let dir = Dir::new("deleted");
        dir.file("a.txt", b"one").file("b.txt", b"two");

        let connection = library();
        let mut values = Values::new();
        run(&connection, &mut values, dir.path(), &Rules::new()).expect("first");

        std::fs::remove_file(dir.path().join("b.txt")).expect("remove");
        let second = run(&connection, &mut values, dir.path(), &Rules::new()).expect("second");

        assert_eq!(second.removed, 1);
        assert_eq!(paths::known(&connection).expect("known").len(), 1);
    }

    #[test]
    fn factual_properties_are_mounted() {
        // `file` and `folder` come from the core; anything else comes from a
        // plugin's rules, and with no rules there is nothing else.
        //
        // Mounted rather than written: the property is a fact about the entry,
        // and resolution needs it mounted for anything a plugin later writes
        // under it to be readable.
        let dir = Dir::new("factual");
        dir.file("a.txt", b"one");

        let connection = library();
        let mut values = Values::new();
        run(&connection, &mut values, dir.path(), &Rules::new()).expect("scan");

        let mounted: Vec<String> = crate::store::values::mount_order(&connection)
            .expect("order")
            .into_iter()
            .map(|row| row.namespace)
            .collect();

        assert!(mounted.contains(&"file".to_string()), "file was not mounted: {mounted:?}");
    }

    #[test]
    fn a_scan_writes_no_values_of_its_own() {
        // A scan records where things are, not what they mean. It used to
        // write `file#1/present = true` so the flattener would see the
        // property, which put a row reading "present: true" on every object
        // page -- a sentence that says nothing.
        let dir = Dir::new("novalues");
        dir.file("a.txt", b"one");

        let connection = library();
        let mut values = Values::new();
        run(&connection, &mut values, dir.path(), &Rules::new()).expect("scan");

        let object = paths::known(&connection).expect("known")[0].object;
        let rows = values.rows(&connection, object).expect("rows");

        assert!(rows.is_empty(), "the scan invented values: {rows:?}");
    }

    #[test]
    fn a_plugins_rule_attaches_its_property() {
        // The core holds the matching and none of the extensions. This is a
        // plugin's rule reaching an object without the core knowing the
        // plugin exists.
        let dir = Dir::new("rules");
        dir.file("outfit.zip", b"not really a zip");

        let mut rules = Rules::new();
        rules.add("zip", "archive");

        let connection = library();
        let mut values = Values::new();
        run(&connection, &mut values, dir.path(), &rules).expect("scan");

        let mounted: Vec<String> = crate::store::values::mount_order(&connection)
            .expect("order")
            .into_iter()
            .map(|row| row.namespace)
            .collect();

        assert!(
            mounted.contains(&"archive".to_string()),
            "the rule did not reach the library: {mounted:?}"
        );
    }

    #[test]
    fn an_empty_directory_scans_to_nothing() {
        let dir = Dir::new("empty");

        let connection = library();
        let mut values = Values::new();
        let outcome =
            run(&connection, &mut values, dir.path(), &Rules::new()).expect("scan");

        assert_eq!(outcome, Scanned::default());
    }
}
