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

// --- resolution ---------------------------------------------------------

/// A registry holding one plugin that shares the given fields.
fn registry_sharing(property: &str, shared: &[&str]) -> yukifile::plugin::registry::Registry {
    use yukifile::plugin::manifest::Manifest;
    use yukifile::plugin::registry::Registry;

    let json = format!(
        r#"{{"id":"example.{property}","contributes":{{"properties":["{property}"],
           "shared":[{}]}}}}"#,
        shared.iter().map(|f| format!("\"{f}\"")).collect::<Vec<_>>().join(",")
    );
    Registry::load(vec![Manifest::parse(&json).expect("manifest")]).expect("registry")
}

/// Mount a property instance at the given position.
fn mount(library: &Library, namespace: &str, instance: u32, position: i64) {
    library
        .with_connection(|connection| {
            connection.execute(
                "INSERT INTO mounts (namespace, instance, position) VALUES (?1, ?2, ?3)",
                rusqlite::params![namespace, instance, position],
            )?;
            Ok(())
        })
        .expect("mount");
}

#[test]
fn a_bare_field_resolves_with_no_plugins_at_all() {
    let (library, _dir) = library();
    let id = object_with(&library, &[("title", "BE NATURAL")]);

    let view = object_flat_in(&library, None, id).expect("flat");

    assert_eq!(view.shared["title"][0].value, "BE NATURAL");
    assert_eq!(view.shared["title"][0].from, None, "a bare field has no source");
}

#[test]
fn a_plugin_field_stays_private_until_a_manifest_shares_it() {
    // The safe reading of "no manifest has said otherwise". A field that
    // competed for a bare name by default would change values on objects the
    // user never touched, just by installing a plugin.
    let (library, _dir) = library();
    let id = object_with(&library, &[("booth#1/title", "shop name")]);
    mount(&library, "booth", 1, 0);

    let isolated = object_flat_in(&library, None, id).expect("flat");
    assert!(isolated.shared.is_empty(), "an undeclared field joined a bare name");
    assert_eq!(isolated.regions.len(), 1);
    assert_eq!(isolated.regions[0].fields["title"], "shop name");

    let shared = registry_sharing("booth", &["title"]);
    let joined = object_flat_in(&library, Some(&shared), id).expect("flat");
    assert_eq!(joined.shared["title"][0].value, "shop name");
    assert_eq!(joined.shared["title"][0].from.as_deref(), Some("booth#1"));
}

#[test]
fn a_bare_value_outranks_a_shop() {
    // Renaming a product locally must not be undone by the next fetch.
    let (library, _dir) = library();
    let id = object_with(&library, &[("title", "mine"), ("booth#1/title", "theirs")]);
    mount(&library, "booth", 1, 0);

    let view =
        object_flat_in(&library, Some(&registry_sharing("booth", &["title"])), id).expect("flat");

    let sources: Vec<&str> = view.shared["title"].iter().map(|s| s.value.as_str()).collect();
    assert_eq!(sources, ["mine", "theirs"], "the shop's title won");
}

#[test]
fn every_source_comes_back_attributed() {
    // A product on two shops has three titles and all three are true. The
    // page shows them attributed rather than picking one and discarding the
    // rest.
    use yukifile::plugin::manifest::Manifest;
    use yukifile::plugin::registry::Registry;

    let (library, _dir) = library();
    let id = object_with(
        &library,
        &[("booth#1/title", "from booth"), ("gumroad#1/title", "from gumroad")],
    );
    mount(&library, "booth", 1, 0);
    mount(&library, "gumroad", 1, 1);

    let registry = Registry::load(vec![
        Manifest::parse(
            r#"{"id":"e.booth","contributes":{"properties":["booth"],"shared":["title"]}}"#,
        )
        .expect("a"),
        Manifest::parse(
            r#"{"id":"e.gumroad","contributes":{"properties":["gumroad"],"shared":["title"]}}"#,
        )
        .expect("b"),
    ])
    .expect("registry");

    let view = object_flat_in(&library, Some(&registry), id).expect("flat");

    let from: Vec<Option<&str>> =
        view.shared["title"].iter().map(|s| s.from.as_deref()).collect();
    assert_eq!(from, [Some("booth#1"), Some("gumroad#1")], "mount order was not followed");
}

#[test]
fn a_region_carries_the_fields_its_plugin_keeps_to_itself() {
    // booth#1/item_id is Booth's own. It belongs in Booth's region, not in a
    // bare name nobody declared.
    let (library, _dir) = library();
    let id = object_with(
        &library,
        &[("booth#1/title", "shop name"), ("booth#1/item_id", "8264237")],
    );
    mount(&library, "booth", 1, 0);

    let view =
        object_flat_in(&library, Some(&registry_sharing("booth", &["title"])), id).expect("flat");

    assert_eq!(view.shared["title"][0].value, "shop name");
    assert_eq!(view.regions[0].fields["item_id"], "8264237");
    assert!(!view.regions[0].fields.contains_key("title"), "a shared field stayed private too");
}

#[test]
fn a_value_under_an_unmounted_property_is_not_reported_as_a_problem() {
    // An object may carry values written by a plugin that is not installed;
    // they wait in storage until it is. A permanent warning on a healthy
    // object is a warning nobody reads.
    let (library, _dir) = library();
    let id = object_with(&library, &[("title", "fine"), ("vrchat#1/category", "clothing")]);

    let view = object_flat_in(&library, None, id).expect("flat");

    assert!(view.skipped.is_empty(), "an uninstalled plugin's values were flagged");
    assert_eq!(view.shared["title"][0].value, "fine");
}

#[test]
fn an_object_with_nothing_resolves_to_an_empty_view() {
    let (library, _dir) = library();
    let id = object_with(&library, &[]);

    let view = object_flat_in(&library, None, id).expect("flat");

    assert!(view.shared.is_empty());
    assert!(view.regions.is_empty());
    assert_eq!(view.id, id);
}

#[test]
fn resolving_an_object_that_is_not_there_says_so() {
    let (library, _dir) = library();

    assert!(matches!(
        object_flat_in(&library, None, 99_999),
        Err(BridgeError::NoSuchObject(_))
    ));
}

#[test]
fn regions_come_back_in_a_stable_order() {
    // Two reads of one object have to agree, or a diff of two pages means
    // nothing. A HashMap iteration order would not.
    let (library, _dir) = library();
    let id = object_with(
        &library,
        &[("zeta#1/a", "1"), ("alpha#1/b", "2"), ("mid#1/c", "3")],
    );
    for (i, name) in ["zeta", "alpha", "mid"].iter().enumerate() {
        mount(&library, name, 1, i as i64);
    }

    let first = object_flat_in(&library, None, id).expect("a");
    let second = object_flat_in(&library, None, id).expect("b");

    let names: Vec<&str> = first.regions.iter().map(|r| r.property.as_str()).collect();
    assert_eq!(names, ["alpha", "mid", "zeta"]);
    assert_eq!(first.regions, second.regions);
}

// --- browsing -----------------------------------------------------------

#[test]
fn object_ids_come_back_lowest_first() {
    // Ids carry a timestamp and entropy rather than a counter, so creation
    // order is not id order. Sorting the expectation is the honest test:
    // what the command promises is an ordering, not the order they arrived.
    let (library, _dir) = library();
    let mut ids: Vec<i64> = (0..5).map(|_| object_with(&library, &[])).collect();
    ids.sort();

    let page = object_ids_in(&library, None, 100).expect("ids");

    assert_eq!(page.ids, ids);
    assert_eq!(page.total, 5);
}

#[test]
fn a_page_stops_at_its_limit_and_says_how_many_there_are() {
    // A grid draws forty of 1518. Knowing the total is what lets it say
    // whether there is more without asking for all of it.
    let (library, _dir) = library();
    for _ in 0..10 {
        object_with(&library, &[]);
    }

    let page = object_ids_in(&library, None, 3).expect("ids");

    assert_eq!(page.ids.len(), 3);
    assert_eq!(page.total, 10);
}

#[test]
fn paging_by_cursor_walks_the_whole_library_once() {
    // Every object exactly once, no repeats and nothing skipped. A page
    // number would drift as objects are added; the last id seen does not.
    let (library, _dir) = library();
    let mut all: Vec<i64> = (0..7).map(|_| object_with(&library, &[])).collect();
    all.sort();

    let mut seen = Vec::new();
    let mut after = None;
    loop {
        let page = object_ids_in(&library, after, 2).expect("ids");
        if page.ids.is_empty() {
            break;
        }
        after = page.ids.last().copied();
        seen.extend(page.ids);
    }

    assert_eq!(seen, all);
}

#[test]
fn a_limit_of_zero_still_returns_something() {
    // Clamped rather than honoured: a caller asking for nothing is asking by
    // mistake, and an empty page reads as "the library is empty".
    let (library, _dir) = library();
    object_with(&library, &[]);

    assert_eq!(object_ids_in(&library, None, 0).expect("ids").ids.len(), 1);
}

#[test]
fn an_enormous_limit_is_capped() {
    // The store may read what it likes; a plugin may not ask for the whole
    // library in one call.
    let (library, _dir) = library();
    for _ in 0..3 {
        object_with(&library, &[]);
    }

    let page = object_ids_in(&library, None, u32::MAX).expect("ids");

    assert_eq!(page.ids.len(), 3, "the cap should not lose real rows");
}

#[test]
fn an_empty_library_pages_to_nothing() {
    let (library, _dir) = library();

    let page = object_ids_in(&library, None, 40).expect("ids");

    assert!(page.ids.is_empty());
    assert_eq!(page.total, 0);
}

#[test]
fn the_manifests_cross_the_boundary() {
    // Slot arbitration runs in the frontend and cannot read plugins/ itself.
    let registry = registry_sharing("booth", &["title"]);

    let listed = plugin_list_in(Some(&registry));

    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].contributes.shared, ["title"]);
}

#[test]
fn no_registry_means_no_plugins_rather_than_an_error() {
    assert!(plugin_list_in(None).is_empty());
}

#[test]
fn mount_order_comes_back_in_position_order() {
    // Slot ordering is mount order. If this came back sorted by name instead,
    // panels would be drawn in an order the library never chose.
    let (library, _dir) = library();
    mount(&library, "gumroad", 1, 0);
    mount(&library, "booth", 1, 1);

    let order = mount_order_in(&library).expect("order");

    assert_eq!(
        order.iter().map(|m| m.namespace.as_str()).collect::<Vec<_>>(),
        ["gumroad", "booth"]
    );
}

#[test]
fn a_library_mounting_nothing_has_an_empty_order() {
    let (library, _dir) = library();

    assert!(mount_order_in(&library).expect("order").is_empty());
}

// --- scanning -----------------------------------------------------------

#[test]
fn scanning_finds_what_is_on_disk() {
    // The command that makes the application usable: without it a library
    // has no way to learn about anything.
    let (library, dir) = library();
    dir.file("a.txt", b"one");
    dir.file("b.txt", b"two");

    let scanned = library_scan_in(&library, None).expect("scan");

    assert_eq!(scanned.added, 2);
    assert_eq!(scanned.objects_created, 2);
}

#[test]
fn a_scanned_object_can_be_read_back_through_the_page() {
    // End to end: scan writes it, object.ids finds it, object.flat resolves
    // it. Each of those was tested alone; this is the first time they are
    // asked to agree.
    let (library, dir) = library();
    dir.file("outfit.zip", b"not really a zip");

    library_scan_in(&library, None).expect("scan");

    let page = object_ids_in(&library, None, 40).expect("ids");
    assert_eq!(page.total, 1);

    let view = object_flat_in(&library, None, page.ids[0]).expect("flat");

    // Where it sits is what a scan knows. It records no values -- the
    // property is a fact about the entry, not a field with a value -- so
    // locations is what proves the object came back whole.
    assert_eq!(view.locations.len(), 1);
    assert_eq!(view.locations[0].path, "outfit.zip");
    assert_eq!(view.locations[0].kind, "file");
}

#[test]
fn scanning_twice_does_not_duplicate_anything() {
    // The property that makes the button safe to press twice.
    let (library, dir) = library();
    dir.file("a.txt", b"one");

    library_scan_in(&library, None).expect("first");
    let second = library_scan_in(&library, None).expect("second");

    assert_eq!(second.added, 0);
    assert_eq!(second.objects_created, 0);
    assert_eq!(object_ids_in(&library, None, 40).expect("ids").total, 1);
}

#[test]
fn a_plugins_file_type_reaches_a_scanned_object() {
    // The core holds the matching and none of the extensions. This is a
    // manifest's rule reaching an object without the core knowing the plugin.
    use yukifile::plugin::manifest::Manifest;
    use yukifile::plugin::registry::Registry;

    let (library, dir) = library();
    dir.file("outfit.zip", b"not really a zip");

    let registry = Registry::load(vec![Manifest::parse(
        r#"{"id":"example.archive","contributes":{"properties":["archive"],
           "file_types":{"zip":["archive"]}}}"#,
    )
    .expect("manifest")])
    .expect("registry");

    library_scan_in(&library, Some(&registry)).expect("scan");

    // The rule reaching the library is what mounting shows: the property is
    // now one the library ranks, so anything later written under `archive#1`
    // resolves instead of being dropped.
    let mounted: Vec<String> = library
        .with_connection(|connection| {
            Ok(yukifile::store::values::mount_order(connection)?
                .into_iter()
                .map(|row| row.namespace)
                .collect())
        })
        .expect("order");

    assert!(
        mounted.contains(&"archive".to_string()),
        "the plugin's rule did not reach the library: {mounted:?}"
    );
}

#[test]
fn a_scan_does_not_record_the_librarys_own_data() {
    // .yukifile/library.db sits inside the root by design. Recording it would
    // make the database an object in the library it describes.
    let (library, dir) = library();
    std::fs::create_dir_all(dir.path().join(".yukifile")).expect("mkdir");
    std::fs::write(dir.path().join(".yukifile").join("library.db"), b"x").expect("write");
    dir.file("a.txt", b"one");

    let scanned = library_scan_in(&library, None).expect("scan");

    assert_eq!(scanned.added, 1, "the library scanned its own data");
}

// --- ids across the boundary --------------------------------------------

#[test]
fn an_object_id_survives_json() {
    // Ids are 62 bits and a JavaScript number holds 53. Serialised as a
    // number, 3750587936530965241 arrives as 3750587936530965000 and every
    // lookup with it fails -- which is what "no such object" meant the first
    // time the window opened.
    let (library, dir) = library();
    dir.file("a.txt", b"one");
    library_scan_in(&library, None).expect("scan");

    let page = object_ids_in(&library, None, 1).expect("ids");
    let id = page.ids[0];
    assert!(
        id > (1_i64 << 53),
        "this test proves nothing unless the id is past the safe range: {id}"
    );

    let json = serde_json::to_string(&page).expect("serialise");
    assert!(
        json.contains(&format!("\"{id}\"")),
        "the id was not sent as a string: {json}"
    );

    let view = object_flat_in(&library, None, id).expect("flat");
    let view_json = serde_json::to_value(&view).expect("serialise");
    assert_eq!(view_json["id"], serde_json::Value::String(id.to_string()));
}

#[test]
fn a_string_id_is_read_back_exactly() {
    // The round trip that matters: what crosses out has to come back in
    // naming the same object.
    let (library, dir) = library();
    dir.file("a.txt", b"one");
    library_scan_in(&library, None).expect("scan");

    let id = object_ids_in(&library, None, 1).expect("ids").ids[0];
    let text = id.to_string();

    assert_eq!(text.parse::<i64>().expect("parse"), id);
    assert!(object_flat_in(&library, None, text.parse().expect("parse")).is_ok());
}

// --- listing ------------------------------------------------------------

#[test]
fn a_summary_names_an_object_by_its_filename() {
    // Most objects have no title: a scan records where things are before
    // anybody names them, so the filename is the common case rather than a
    // fallback.
    let (library, dir) = library();
    dir.file("outfit.zip", b"not really a zip");
    library_scan_in(&library, None).expect("scan");

    let ids = object_ids_in(&library, None, 40).expect("ids").ids;
    let summaries = object_summaries_in(&library, ids).expect("summaries");

    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].name.as_deref(), Some("outfit.zip"));
    assert_eq!(summaries[0].path.as_deref(), Some("outfit.zip"));
    assert_eq!(summaries[0].kind.as_deref(), Some("file"));
}

#[test]
fn a_title_wins_over_the_filename() {
    let (library, _dir) = library();
    let id = object_with(&library, &[("title", "Cross Maid")]);

    let summaries = object_summaries_in(&library, vec![id]).expect("summaries");

    assert_eq!(summaries[0].name.as_deref(), Some("Cross Maid"));
}

#[test]
fn a_grouping_has_no_name_and_no_path() {
    // An object with no location and no title genuinely has no name until
    // somebody gives it one. Inventing one would be worse than saying so.
    let (library, _dir) = library();
    let id = object_with(&library, &[]);

    let summaries = object_summaries_in(&library, vec![id]).expect("summaries");

    assert_eq!(summaries[0].name, None);
    assert_eq!(summaries[0].path, None);
}

#[test]
fn summaries_come_back_in_the_order_asked_for() {
    // A list draws rows in the order it asked for them. Returning database
    // order would scramble a page the caller had already sorted.
    let (library, _dir) = library();
    let first = object_with(&library, &[("title", "one")]);
    let second = object_with(&library, &[("title", "two")]);

    let summaries = object_summaries_in(&library, vec![second, first]).expect("summaries");

    assert_eq!(
        summaries.iter().map(|s| s.name.as_deref()).collect::<Vec<_>>(),
        [Some("two"), Some("one")]
    );
}

#[test]
fn an_object_spanning_two_paths_shows_one_in_a_list() {
    // Both belong on its own page; one belongs in a list, where one name per
    // row is the whole point.
    let (library, _dir) = library();
    let id = object_with(&library, &[]);
    library
        .with_connection(|connection| {
            use yukifile::scan::walk::Kind;
            yukifile::store::paths::record(
                connection, id, "Outfit", Kind::Folder, None, None, None,
            )?;
            yukifile::store::paths::record(
                connection, id, "Outfit.zip", Kind::File, Some(9), None, None,
            )?;
            Ok(())
        })
        .expect("record");

    let summaries = object_summaries_in(&library, vec![id]).expect("summaries");

    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].path.as_deref(), Some("Outfit"));
}

#[test]
fn asking_for_nothing_returns_nothing() {
    let (library, _dir) = library();

    assert!(object_summaries_in(&library, vec![]).expect("summaries").is_empty());
}

#[test]
fn a_page_of_summaries_is_one_pass_over_the_paths_table() {
    // The reason this command exists: 441 objects should not be 441 reads.
    // Asking for many and getting them all back is what proves the batch
    // query works rather than silently returning only the first.
    let (library, dir) = library();
    for i in 0..25 {
        dir.file(&format!("f{i}.txt"), b"x");
    }
    library_scan_in(&library, None).expect("scan");

    let ids = object_ids_in(&library, None, 100).expect("ids").ids;
    let summaries = object_summaries_in(&library, ids.clone()).expect("summaries");

    assert_eq!(summaries.len(), 25);
    assert!(
        summaries.iter().all(|s| s.name.is_some()),
        "some rows came back without a name"
    );
}

// --- viewing ------------------------------------------------------------

#[test]
fn an_asset_url_encodes_what_a_filename_may_hold() {
    // Library paths hold spaces, `#` and `?`. A `#` left raw truncates the
    // URL at the fragment, so the viewer asks for a file whose name stops
    // early -- and gets a 404 that reads like a missing file.
    use yukifile::bridge::commands::asset_url;

    let url = asset_url(std::path::Path::new("/lib/Cross Maid #2.pdf"));

    assert!(!url.contains(' '), "a space survived: {url}");
    assert!(!url.contains('#'), "a fragment marker survived: {url}");
    assert!(url.starts_with("asset://localhost/"));
}

#[test]
fn an_asset_url_keeps_its_separators() {
    // Encoding the slashes too would turn a path into one long filename.
    use yukifile::bridge::commands::asset_url;

    let url = asset_url(std::path::Path::new("/lib/Clothing/outfit.pdf"));

    assert!(url.contains("/lib/Clothing/outfit.pdf"), "{url}");
}

#[test]
fn a_non_ascii_filename_is_encoded_rather_than_dropped() {
    // The seed library is bilingual: 桔梗 and マヌカ are ordinary names.
    use yukifile::bridge::commands::asset_url;

    let url = asset_url(std::path::Path::new("/lib/桔梗.pdf"));

    assert!(url.is_ascii(), "the URL is not transmissible: {url}");
    assert!(url.contains("%"), "nothing was encoded: {url}");
}

// --- hierarchy ----------------------------------------------------------

/// Record that one object contains another.
fn contains(library: &Library, parent: i64, child: i64) {
    library
        .with_connection(|connection| {
            yukifile::store::edges::add(
                connection,
                parent,
                "contains",
                &yukifile::store::edges::Target::Object(child),
            )?;
            Ok(())
        })
        .expect("edge");
}

#[test]
fn a_list_shows_only_what_nothing_contains() {
    // The answer to "441 rows, how does anybody organise this". Most of a
    // library is inside something, and the top of the tree is a handful.
    let (library, _dir) = library();
    let folder = object_with(&library, &[("title", "Clothing")]);
    let inside = object_with(&library, &[("title", "outfit.zip")]);
    let loose = object_with(&library, &[("title", "thesis.pdf")]);
    contains(&library, folder, inside);

    let page = object_ids_in(&library, None, 40).expect("ids");

    assert_eq!(page.total, 2, "a contained object was counted as top level");
    assert!(page.ids.contains(&folder));
    assert!(page.ids.contains(&loose));
    assert!(!page.ids.contains(&inside), "a contained object was listed at the top");
}

#[test]
fn opening_a_folder_lists_what_it_holds() {
    let (library, _dir) = library();
    let folder = object_with(&library, &[("title", "Clothing")]);
    let first = object_with(&library, &[("title", "a.zip")]);
    let second = object_with(&library, &[("title", "b.zip")]);
    contains(&library, folder, first);
    contains(&library, folder, second);

    let page = object_ids_scoped(&library, None, 40, Some(folder)).expect("ids");

    assert_eq!(page.ids.len(), 2);
    assert_eq!(page.total, 2);
}

#[test]
fn a_library_with_no_hierarchy_is_all_top_level() {
    // A plugin that builds no contains edges gets a flat library, which is
    // the right answer for one. The filter follows the edges rather than
    // imposing a shape.
    let (library, _dir) = library();
    for _ in 0..3 {
        object_with(&library, &[]);
    }

    assert_eq!(object_ids_in(&library, None, 40).expect("ids").total, 3);
}

#[test]
fn an_empty_folder_holds_nothing_without_failing() {
    let (library, _dir) = library();
    let folder = object_with(&library, &[]);

    let page = object_ids_scoped(&library, None, 40, Some(folder)).expect("ids");

    assert!(page.ids.is_empty());
    assert_eq!(page.total, 0);
}

#[test]
fn nesting_two_deep_still_shows_one_top() {
    // A grandchild is contained by its parent, so it is not top level either.
    let (library, _dir) = library();
    let top = object_with(&library, &[]);
    let middle = object_with(&library, &[]);
    let bottom = object_with(&library, &[]);
    contains(&library, top, middle);
    contains(&library, middle, bottom);

    assert_eq!(object_ids_in(&library, None, 40).expect("ids").total, 1);
}
