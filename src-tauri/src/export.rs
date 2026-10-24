//! A library, written as a contract document.
//!
//! The other half of `changes::build::import`, and the test of it: a library
//! exported and imported into an empty one should hold the same values, the
//! same edges and the same terms. `contract.rs` says one shape serves export,
//! import and moving between machines, which only holds if the shape really
//! does go both ways. This is the direction that was missing.
//!
//! # What is written, and what is not
//!
//! Every object: its paths with which are folders, its values, its edges,
//! and its terms' spellings. The import key stays as the record's `id` rather
//! than as a value, so an import of the export matches the objects it came
//! from and makes nothing twice. Locations' sizes and hashes are not written;
//! they are what a scan observes, and the receiving library will look for
//! itself.
//!
//! An edge to an object with no path cannot be written: the contract names an
//! object target by path, and a grouping has none. Those are counted and left
//! out rather than written as something the import would skip anyway.

use rusqlite::Connection;

use crate::contract::{Document, EdgeRecord, ObjectRecord, TermRecord};
use crate::scan::walk::Kind;
use crate::store::edges::{self, Target};
use crate::store::path::IMPORT;
use crate::store::{paths, values, vocab};

/// What an export wrote, and what it could not.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Exported {
    pub document: Document,
    /// Edges to objects with no path, which the contract cannot name.
    pub edges_left_out: usize,
}

/// The import key a record carries, under the reserved namespace.
const KEY: &str = "@import#1/key";

/// The whole library as a document.
pub fn document(connection: &Connection) -> rusqlite::Result<Exported> {
    let store = values::Values::new();
    let mut exported = Exported { document: Document::new(), ..Exported::default() };
    exported.document.source = Some("export".to_string());

    // Every object's first path, for naming edge targets.
    let ids = values::object_ids(connection, None, u32::MAX)?;
    let mut first_path = std::collections::HashMap::new();
    for &id in &ids {
        if let Some(path) = paths::of_object(connection, id)?.into_iter().next() {
            first_path.insert(id, path);
        }
    }

    for &id in &ids {
        let located = paths::located(connection, id)?;
        let record_paths: Vec<String> = located.iter().map(|l| l.path.clone()).collect();
        let folders: Vec<String> = located
            .iter()
            .filter(|l| l.kind == Kind::Folder)
            .map(|l| l.path.clone())
            .collect();

        let mut record = ObjectRecord { paths: record_paths, folders, ..ObjectRecord::default() };

        for row in store.rows(connection, id).map_err(|_| rusqlite::Error::InvalidQuery)? {
            if row.path == KEY {
                record.id = Some(row.value);
            } else {
                record.values.insert(row.path, row.value);
            }
        }
        // A record with no path and no key could never be matched again.
        if record.id.is_none() && record.paths.is_empty() {
            record.id = Some(format!("object:{id}"));
        }

        for edge in edges::from(connection, id, None)? {
            match &edge.target {
                Target::Term { vocab, id: term } => {
                    record.edges.push(EdgeRecord::to_term(&edge.kind, vocab, term));
                }
                Target::Object(dst) => match first_path.get(dst) {
                    Some(path) => record.edges.push(EdgeRecord::to_object(&edge.kind, path)),
                    None => exported.edges_left_out += 1,
                },
            }
        }

        exported.document.objects.push(record);
    }

    for vocabulary in vocab::vocabularies(connection)? {
        for term in vocab::terms(connection, &vocabulary)? {
            exported.document.terms.push(TermRecord {
                vocab: term.vocab.clone(),
                id: term.id.clone(),
                label: term.label.clone(),
                aliases: vocab::aliases(connection, &term.vocab, &term.id)?,
            });
        }
    }

    // Values serialise sorted already; objects come in id order, which is
    // creation order, so two exports of one library diff cleanly.
    Ok(exported)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::changes::build::import;
    use crate::store::schema;

    fn library() -> Connection {
        schema::open_in_memory().expect("open")
    }

    #[test]
    fn an_export_imported_into_an_empty_library_holds_the_same_things() {
        // The contract's promise: one shape, both ways.
        let from = library();
        let mut store = values::Values::new();
        let outfit = store.create_object(&from).expect("object");
        paths::record(&from, outfit, "Clothing/outfit", Kind::Folder, None, None, None).expect("path");
        store.set(&from, outfit, "title", "Cross Maid").expect("set");
        store.set(&from, outfit, "booth#1/price", "2900").expect("set");
        vocab::put_term(&from, "avatar", "manuka", "マヌカ").expect("term");
        vocab::put_alias(&from, "avatar", "Manuka", "manuka").expect("alias");
        edges::add(&from, outfit, "supports", &Target::Term { vocab: "avatar".into(), id: "manuka".into() }).expect("edge");
        let category = store.create_object(&from).expect("object");
        paths::record(&from, category, "Clothing", Kind::Folder, None, None, None).expect("path");
        edges::add(&from, category, "contains", &Target::Object(outfit)).expect("edge");

        let exported = document(&from).expect("export");
        assert_eq!(exported.edges_left_out, 0);
        let json = exported.document.to_json().expect("json");

        let to = library();
        let mut receiving = values::Values::new();
        let parsed = Document::parse(&json).expect("parse");
        let outcome = import(&to, &mut receiving, &parsed, "from the export").expect("import");
        assert_eq!(outcome.objects_created, 2);
        assert_eq!(outcome.terms, 1);
        assert_eq!(outcome.edges, 2);
        assert!(outcome.pending.is_none());

        // And an export of the receiving library says the same thing.
        let again = document(&to).expect("export").document;
        let mut a = exported.document.objects.clone();
        let mut b = again.objects.clone();
        for list in [&mut a, &mut b] {
            list.sort_by(|x, y| x.paths.cmp(&y.paths));
            for record in list.iter_mut() {
                record.id = None; // the receiving library assigns its own keys
            }
        }
        assert_eq!(a, b);
        assert_eq!(exported.document.terms, again.terms);
    }

    #[test]
    fn the_import_key_becomes_the_record_id_and_a_grouping_gets_one() {
        let from = library();
        let mut store = values::Values::new();
        let keyed = store.create_object(&from).expect("object");
        store.set(&from, keyed, "@import#1/key", "Clothing/outfit").expect("key");
        let grouping = store.create_object(&from).expect("object");
        store.set(&from, grouping, "title", "Favourites").expect("set");

        let records = document(&from).expect("export").document.objects;

        let keyed_record = records.iter().find(|r| r.id.as_deref() == Some("Clothing/outfit")).expect("keyed");
        assert!(!keyed_record.values.contains_key("@import#1/key"), "the key is the id, not a value");
        let grouping_record = records.iter().find(|r| r.values.get("title").map(String::as_str) == Some("Favourites")).expect("grouping");
        assert!(grouping_record.id.is_some(), "a record with no path and no key could never be matched again");
    }

    #[test]
    fn an_edge_to_a_pathless_object_is_counted_and_left_out() {
        let from = library();
        let mut store = values::Values::new();
        let a = store.create_object(&from).expect("a");
        let grouping = store.create_object(&from).expect("g");
        edges::add(&from, a, "contains", &Target::Object(grouping)).expect("edge");

        let exported = document(&from).expect("export");

        assert_eq!(exported.edges_left_out, 1);
        assert!(exported.document.objects.iter().all(|r| r.edges.is_empty()));
    }
}
