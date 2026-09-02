//! The commands, run.
//!
//! `boundary.rs` reads source and asks whether the command surface is shaped
//! right. `confinement.rs` asks whether a path is refused. Neither runs a
//! command, so until this file existed nine functions were listed,
//! implemented, registered, documented — and never executed.
//!
//! These call the `_in` forms, which take `&Library` rather than Tauri's
//! `State`. That split is why the commands are testable at all: a `State`
//! cannot be built outside a running app, and the annotated wrappers do
//! nothing but unwrap one.

use std::fs;
use std::io::Write;

use rusqlite::Connection;
use yukifile::bridge::commands::*;
use yukifile::bridge::error::BridgeError;
use yukifile::bridge::Library;
use yukifile::store::id::SystemClock;
use yukifile::store::schema;
use yukifile::store::values::Values;

/// A library with a real schema, rooted in a temporary directory.
fn library() -> (Library, Dir) {
    let dir = Dir::new();
    let mut connection = Connection::open_in_memory().expect("open");
    schema::migrate(&mut connection).expect("migrate");
    connection
        .pragma_update(None, "foreign_keys", true)
        .expect("foreign keys");

    (Library::new(dir.path(), connection).expect("library"), dir)
}

/// An object carrying the given values, returning its id.
fn object_with(library: &Library, values: &[(&str, &str)]) -> i64 {
    library
        .with_connection(|connection| {
            let mut store = Values::new();
            let id = store.create_object(connection).expect("create");
            for (path, value) in values {
                store.set(connection, id, path, value).expect("set");
            }
            Ok(id)
        })
        .expect("build object")
}

#[test]
fn an_objects_values_come_back_under_their_stored_paths() {
    // Not flattened. A panel rendering its own property's region wants
    // `booth#1/title`, not whichever title won.
    let (library, _dir) = library();
    let id = object_with(&library, &[("title", "BE NATURAL"), ("booth#1/title", "shop name")]);

    let view = object_get_in(&library, id).expect("get");

    let mut paths: Vec<&str> = view.values.iter().map(|v| v.path.as_str()).collect();
    paths.sort();
    assert_eq!(paths, ["booth#1/title", "title"]);
}

#[test]
fn an_object_with_no_values_is_not_the_same_as_no_object() {
    // A panel has to tell "nothing here yet" from "this id is wrong", and
    // both would be an empty list if the command did not check.
    let (library, _dir) = library();
    let empty = object_with(&library, &[]);

    assert_eq!(object_get_in(&library, empty).expect("get").values.len(), 0);
    assert!(matches!(
        object_get_in(&library, 99_999),
        Err(BridgeError::NoSuchObject(_))
    ));
}

#[test]
fn listing_leaves_out_ids_it_cannot_find() {
    // A grid asking for forty objects while one is being deleted should draw
    // thirty-nine, not fail.
    let (library, _dir) = library();
    let first = object_with(&library, &[("title", "one")]);
    let second = object_with(&library, &[("title", "two")]);

    let found = object_list_in(&library, vec![first, 99_999, second]).expect("list");

    assert_eq!(found.len(), 2);
    assert_eq!(found.iter().map(|o| o.id).collect::<Vec<_>>(), [first, second]);
}

#[test]
fn listing_nothing_is_not_an_error() {
    let (library, _dir) = library();

    assert!(object_list_in(&library, vec![]).expect("list").is_empty());
}

#[test]
fn an_edge_to_a_term_comes_back_tagged() {
    // A plugin switches on the tag in TypeScript. A term edge and an object
    // edge have to be distinguishable without guessing from which field is
    // present.
    use yukifile::store::edges::{self, Target};
    use yukifile::store::vocab;

    let (library, _dir) = library();
    let outfit = object_with(&library, &[("title", "Cross Maid")]);

    library
        .with_connection(|connection| {
            vocab::put_term(connection, "avatar", "manuka", "マヌカ").expect("term");
            edges::add(
                connection,
                outfit,
                "supports",
                &Target::Term { vocab: "avatar".into(), id: "manuka".into() },
            )
            .expect("edge");
            Ok(())
        })
        .expect("setup");

    let found = object_edges_in(&library, outfit).expect("edges");

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].kind, "supports");
    let json = serde_json::to_value(&found[0]).expect("serialise");
    assert_eq!(json["target"], "term");
    assert_eq!(json["vocab"], "avatar");
    assert_eq!(json["term"], "manuka");
}

#[test]
fn an_alias_resolves_to_its_term() {
    // 桔梗 / Kikyo / Kikyou are one avatar. A plugin reading filenames has to
    // get the same answer the rest of the library uses.
    use yukifile::store::vocab;

    let (library, _dir) = library();
    library
        .with_connection(|connection| {
            vocab::put_term(connection, "avatar", "kikyo", "桔梗").expect("term");
            vocab::put_alias(connection, "avatar", "Kikyou", "kikyo").expect("alias");
            Ok(())
        })
        .expect("setup");

    assert_eq!(
        term_resolve_in(&library, "avatar".into(), "Kikyou".into()).expect("resolve"),
        Some("kikyo".to_string())
    );
    assert_eq!(
        term_resolve_in(&library, "avatar".into(), "nobody".into()).expect("resolve"),
        None
    );
}

#[test]
fn a_vocabulary_lists_what_it_holds() {
    use yukifile::store::vocab;

    let (library, _dir) = library();
    library
        .with_connection(|connection| {
            vocab::put_term(connection, "avatar", "kikyo", "桔梗").expect("a");
            vocab::put_term(connection, "avatar", "selestia", "セレスティア").expect("b");
            vocab::put_term(connection, "author", "someone", "Someone").expect("c");
            Ok(())
        })
        .expect("setup");

    let terms = term_list_in(&library, "avatar".into()).expect("list");

    assert_eq!(terms.len(), 2, "another vocabulary leaked in");
    assert!(terms.iter().all(|t| t.vocab == "avatar"));
}

#[test]
fn an_archive_is_listed_without_being_unpacked() {
    let (library, dir) = library();
    dir.zip("outfit.zip", &[("readme.txt", b"hello"), ("skin.png", b"not really a png")]);

    let members = archive_list_in(&library, "outfit.zip".into()).expect("list");

    assert_eq!(members.len(), 2);
    assert!(members.iter().any(|m| m.path == "skin.png"));
    assert!(members.iter().all(|m| !m.escapes_root));
}

#[test]
fn a_file_that_is_not_an_archive_says_so() {
    // The seed library has a RAR that cannot be opened at all. That is a fact
    // about the object, not a crash.
    let (library, dir) = library();
    dir.file("notes.txt", b"just text");

    assert!(matches!(
        archive_list_in(&library, "notes.txt".into()),
        Err(BridgeError::NotAnArchive(_))
    ));
}

#[test]
fn an_archive_outside_the_library_is_refused_by_the_command() {
    // confinement.rs proves Library::resolve refuses an escape. This proves
    // the command actually goes through resolve rather than opening the path
    // itself.
    //
    // The target has to exist, and be a real archive: a path that is merely
    // missing is refused for the wrong reason, and this test would then pass
    // against a command that never consulted the library at all.
    let (library, dir) = library();
    let outside = dir.path().parent().expect("parent").join("yukifile-outside.zip");
    {
        let file = fs::File::create(&outside).expect("create");
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("secret.txt", zip::write::SimpleFileOptions::default())
            .expect("entry");
        writer.write_all(b"not yours").expect("bytes");
        writer.finish().expect("finish");
    }

    let attempt = archive_list_in(&library, "../yukifile-outside.zip".into());
    let _ = fs::remove_file(&outside);

    assert!(
        matches!(attempt, Err(BridgeError::OutsideLibrary(_))),
        "a readable archive outside the library was listed: {attempt:?}"
    );
}

#[test]
fn hashing_agrees_with_the_core() {
    // A plugin finding duplicates has to agree with the scanner about what a
    // duplicate is, which it cannot do by hashing its own way.
    let (library, dir) = library();
    dir.file("a.bin", b"the same bytes");

    let through_command = hash_of_in(&library, "a.bin".into()).expect("hash");
    let directly = yukifile::commands::hash::of_path(&dir.path().join("a.bin")).expect("hash");

    assert_eq!(through_command, directly);
}

#[test]
fn hashing_outside_the_library_is_refused() {
    let (library, _dir) = library();

    assert!(matches!(
        hash_of_in(&library, "../../secrets".into()),
        Err(BridgeError::OutsideLibrary(_)) | Err(BridgeError::NotFound(_))
    ));
}

#[test]
fn history_comes_back_for_an_object() {
    use yukifile::store::history;

    let (library, _dir) = library();
    let id = object_with(&library, &[("title", "first")]);

    library
        .with_connection(|connection| {
            history::record_at(
                connection,
                &SystemClock,
                id,
                "title",
                Some("first"),
                Some("second"),
                None,
            )
            .expect("record");
            Ok(())
        })
        .expect("setup");

    let entries = history_of_in(&library, id).expect("history");

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].field, "title");
    assert_eq!(entries[0].old.as_deref(), Some("first"));
    assert_eq!(entries[0].new.as_deref(), Some("second"));
}

#[test]
fn importing_writes_what_fits() {
    // The only command that changes anything, and until this test nothing had
    // ever run it.
    let (library, _dir) = library();

    let document = r#"{
        "version": 1,
        "objects": [
            { "paths": ["Clothing/outfit.zip"], "values": { "title": "Cross Maid" } }
        ]
    }"#;

    let outcome =
        import_propose_in(&library, "test".into(), document.into()).expect("import");

    assert_eq!(outcome.objects_created, 1);
    assert!(outcome.written > 0);
    assert_eq!(outcome.pending, None, "nothing should need review yet");
}

#[test]
fn importing_the_same_document_twice_changes_nothing_the_second_time() {
    // Idempotence is what makes an import safe to retry after a failure.
    let (library, _dir) = library();
    let document = r#"{
        "version": 1,
        "objects": [
            { "paths": ["Clothing/outfit.zip"], "values": { "title": "Cross Maid" } }
        ]
    }"#;

    let first = import_propose_in(&library, "test".into(), document.into()).expect("first");
    let second = import_propose_in(&library, "test".into(), document.into()).expect("second");

    assert_eq!(second.objects_created, 0, "a second object was invented");
    assert_eq!(second.written, 0);
    assert_eq!(second.unchanged, first.written);
}

#[test]
fn importing_over_an_existing_value_proposes_rather_than_overwrites() {
    // The failure change sets exist to prevent: a plugin quietly replacing a
    // decision a person made.
    let (library, _dir) = library();
    let first = r#"{"version":1,"objects":[{"paths":["a.zip"],"values":{"title":"mine"}}]}"#;
    let second = r#"{"version":1,"objects":[{"paths":["a.zip"],"values":{"title":"theirs"}}]}"#;

    import_propose_in(&library, "first".into(), first.into()).expect("first");
    let outcome = import_propose_in(&library, "second".into(), second.into()).expect("second");

    assert!(outcome.pending.is_some(), "an overwrite was applied without review");

    // And the value on disk is still the one the person had.
    let id = library
        .with_connection(|connection| {
            let store = Values::new();
            Ok(store
                .find_by_value(connection, "@import/key", "a.zip")
                .expect("find"))
        })
        .expect("lookup");
    if let Some(id) = id {
        let view = object_get_in(&library, id).expect("get");
        let title = view.values.iter().find(|v| v.path == "title").expect("title");
        assert_eq!(title.value, "mine", "the plugin's value was written anyway");
    }
}

#[test]
fn a_document_that_is_not_json_is_a_bad_request() {
    let (library, _dir) = library();

    assert!(matches!(
        import_propose_in(&library, "x".into(), "{ not json".into()),
        Err(BridgeError::BadRequest(_))
    ));
}

#[test]
fn a_failed_import_leaves_nothing_behind() {
    // Every write runs in one transaction. Half an import is a library
    // describing something that never existed.
    let (library, _dir) = library();

    let before = library
        .with_connection(|connection| {
            Ok(connection
                .query_row("SELECT count(*) FROM objects", [], |row| row.get::<_, i64>(0))?)
        })
        .expect("count");

    let _ = import_propose_in(&library, "x".into(), "{ not json".into());

    let after = library
        .with_connection(|connection| {
            Ok(connection
                .query_row("SELECT count(*) FROM objects", [], |row| row.get::<_, i64>(0))?)
        })
        .expect("count");

    assert_eq!(before, after);
}

/// A temporary directory that cleans up when dropped.
struct Dir(std::path::PathBuf);

impl Dir {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir()
            .join(format!("yukifile-commands-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create");
        Self(path)
    }

    fn path(&self) -> &std::path::Path {
        &self.0
    }

    fn file(&self, name: &str, bytes: &[u8]) {
        fs::write(self.0.join(name), bytes).expect("write");
    }

    /// A real zip, so the archive command reads something the zip crate wrote
    /// rather than a fixture that only resembles one.
    fn zip(&self, name: &str, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(self.0.join(name)).expect("create zip");
        let mut writer = zip::ZipWriter::new(file);
        for (path, bytes) in entries {
            writer
                .start_file(*path, zip::write::SimpleFileOptions::default())
                .expect("entry");
            writer.write_all(bytes).expect("bytes");
        }
        writer.finish().expect("finish");
    }
}

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
