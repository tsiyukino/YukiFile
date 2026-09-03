//! Turning a document into writes that happen and proposals that wait.
//!
//! `values::set` already draws the line: it writes into an empty field and
//! reports a conflict rather than overwriting. This module takes that report
//! and turns it into a reviewable entry, so the rule lives in one place and
//! this is wiring rather than a second judgement.
//!
//! # A document is imported whole
//!
//! Values, edges and vocabulary terms. An earlier version read only the
//! values and reported success, so a document carrying 174 products and 73
//! avatars imported the products and silently lost every avatar — the
//! interface said it had done something it had not.
//!
//! Objects come first, then edges, because an edge names its target by path
//! and that path may belong to a record further down the document. One pass
//! would resolve it against a library that does not hold it yet.

use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension, params};

use crate::changes::{ChangeError, ChangeSet};
use crate::contract::{Document, EdgeRecord};
use crate::store::id::{Clock, SystemClock};
use crate::store::values::{Values, WriteError, Written};
use crate::store::{edges, vocab};

/// What importing a document did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Imported {
    /// Fields that were empty and now hold a value.
    pub written: usize,
    /// Fields that already held exactly this value.
    pub unchanged: usize,
    /// Objects created because no path matched.
    pub objects_created: usize,
    /// Vocabulary terms added or relabelled.
    pub terms: usize,
    /// Edges recorded. An edge whose target this library does not hold is not
    /// counted, because it was not recorded.
    pub edges: usize,
    /// The set holding what could not be written directly, if anything could
    /// not.
    pub pending: Option<i64>,
}

impl Imported {
    /// True when nothing needs a person's attention.
    pub fn is_settled(&self) -> bool {
        self.pending.is_none()
    }
}

/// Import a document, writing what fits and proposing what does not.
///
/// Idempotent: importing one document twice writes on the first pass and
/// reports everything as unchanged on the second. That is what makes an import
/// safe to retry after a failure.
///
/// Belongs inside `schema::in_transaction` — half an import is a library
/// describing something that never existed.
pub fn import(
    connection: &Connection,
    values: &mut Values,
    document: &Document,
    label: &str,
) -> Result<Imported, ChangeError> {
    import_at(connection, values, document, label, &SystemClock)
}

/// Import at a given time, so a test does not depend on the clock.
pub fn import_at(
    connection: &Connection,
    values: &mut Values,
    document: &Document,
    label: &str,
    clock: &impl Clock,
) -> Result<Imported, ChangeError> {
    let mut outcome = Imported::default();
    let mut set: Option<i64> = None;

    // Terms first: an edge may point at one, and a term that does not exist
    // yet would fail the foreign key.
    for term in &document.terms {
        vocab::put_term(connection, &term.vocab, &term.id, &term.label)?;
        for alias in &term.aliases {
            vocab::put_alias(connection, &term.vocab, alias, &term.id)?;
        }
        outcome.terms += 1;
    }

    // Objects, remembering which path led to which, so the edge pass can
    // resolve a target named by a path this document itself introduced.
    let mut by_path: HashMap<&str, i64> = HashMap::new();

    for record in &document.objects {
        let (object, created) = match_object(connection, values, record)?;
        if created {
            outcome.objects_created += 1;
        }

        for path in &record.paths {
            by_path.insert(path.as_str(), object);

            // Record where it sits, not just remember it for edge resolution.
            // Until scanning moved into a plugin, paths reached the store
            // through the scanner and an import only ever matched on them --
            // so an imported object came back with no location at all, which
            // is a library that cannot say where anything is.
            //
            // The document says which paths are folders. The core cannot look
            // and find out -- an import may name a path that is not on disk
            // yet -- and whoever wrote the document does know.
            if !path.is_empty() {
                let kind = if record.folders.contains(path) {
                    crate::scan::walk::Kind::Folder
                } else {
                    crate::scan::walk::Kind::File
                };
                crate::store::paths::record(
                    connection, object, path, kind, None, None, None,
                )?;
            }
        }

        for (field_path, value) in &record.values {
            match values.set(connection, object, field_path, value) {
                Ok(Written::Added) => outcome.written += 1,
                Ok(Written::Unchanged | Written::Cleared) => outcome.unchanged += 1,
                Ok(Written::Replaced) => {
                    unreachable!("set never replaces; that is what overwrite is for")
                }
                Err(WriteError::Conflict { existing, incoming }) => {
                    // The one case that needs a person. Open a set lazily, so
                    // an import with no conflicts leaves nothing to review.
                    let id = match set {
                        Some(id) => id,
                        None => {
                            let id = open_set(connection, label, clock)?;
                            set = Some(id);
                            id
                        }
                    };
                    propose(
                        connection,
                        id,
                        object,
                        field_path,
                        Some(&existing),
                        Some(&incoming),
                        record.reason.as_deref(),
                    )?;
                }
                Err(error) => return Err(error.into()),
            }
        }
    }

    // Edges last, now that every object the document mentions exists.
    for record in &document.objects {
        let Some(&source) = record.paths.first().and_then(|p| by_path.get(p.as_str())) else {
            continue;
        };
        for edge in &record.edges {
            outcome.edges += usize::from(add_edge(connection, source, edge, &by_path)?);
        }
    }

    outcome.pending = set;
    Ok(outcome)
}

/// Record one edge, if its target can be resolved.
///
/// A malformed record — naming both targets or neither — is skipped rather
/// than guessed at, matching what the edge table itself refuses. A target
/// naming a path this library does not have is also skipped: the document
/// referred to something that is not here, and inventing an object for it
/// would put a pathless shell in every listing, which is what the vocabulary
/// decision exists to avoid.
fn add_edge(
    connection: &Connection,
    source: i64,
    edge: &EdgeRecord,
    by_path: &HashMap<&str, i64>,
) -> Result<bool, ChangeError> {
    if !edge.is_well_formed() {
        return Ok(false);
    }

    let target = if let Some((vocab, term)) = edge.term_parts() {
        edges::Target::Term { vocab: vocab.to_string(), id: term.to_string() }
    } else if let Some(path) = &edge.object {
        match resolve_object(connection, path, by_path)? {
            Some(object) => edges::Target::Object(object),
            None => return Ok(false),
        }
    } else {
        return Ok(false);
    };

    edges::add(connection, source, &edge.kind, &target)?;
    Ok(true)
}

/// The object at a path — from this document, or already in the library.
fn resolve_object(
    connection: &Connection,
    path: &str,
    by_path: &HashMap<&str, i64>,
) -> Result<Option<i64>, ChangeError> {
    if let Some(&object) = by_path.get(path) {
        return Ok(Some(object));
    }
    let existing: Option<i64> = connection
        .query_row(
            "SELECT object_id FROM object_paths WHERE path = ?1",
            params![path],
            |row| row.get(0),
        )
        .optional()?;
    Ok(existing)
}

/// Find the object a record describes, or make one.
///
/// Matched on path, which is what makes an import idempotent. A record with
/// several paths matches if any of them is known — a product that was one
/// folder and is now a folder plus its zip is still that product.
///
/// A new object gets **no location rows**. A document carries values and
/// relationships, not disk state: it does not say whether a path is a file or
/// a folder, and guessing would record a zip as a folder for the next scan to
/// argue with. Locations come from scanning, which is the only thing that
/// actually looked.
///
/// That leaves a new object matchable by nothing on a second import, so its
/// identifier is stored as a value under the reserved `@import` namespace.
/// Without it, importing one document twice creates two objects, and the
/// contract's idempotence would hold only for objects that already existed.
fn match_object(
    connection: &Connection,
    values: &mut Values,
    record: &crate::contract::ObjectRecord,
) -> Result<(i64, bool), ChangeError> {
    for path in &record.paths {
        let existing: Option<i64> = connection
            .query_row(
                "SELECT object_id FROM object_paths WHERE path = ?1",
                params![path],
                |row| row.get(0),
            )
            .ok();
        if let Some(object) = existing {
            return Ok((object, false));
        }
    }

    let identifier = import_key(record);
    if let Some(key) = &identifier {
        if let Some(object) = values.find_by_value(connection, IMPORT_KEY_FIELD, key)? {
            return Ok((object, false));
        }
    }

    let object = values.create_object(connection)?;
    if let Some(key) = identifier {
        values.set(connection, object, IMPORT_KEY_FIELD, &key)?;
    }
    Ok((object, true))
}

/// Where an imported object's identifier is kept.
///
/// Reserved like `@pin`: no plugin contributes it, and it is not a field a
/// person edits.
///
/// Either spelling works: `Values` normalises on the way in and on the way
/// out. Writing the query by hand against the unnormalised form is what broke
/// the first version of this, so the lookup lives in `Values` now.
const IMPORT_KEY_FIELD: &str = "@import/key";

/// The identifier to match a record by when no path is known.
///
/// An explicit `id` if the document gave one; otherwise the first path, which
/// names the object the document meant even when nothing is there yet.
fn import_key(record: &crate::contract::ObjectRecord) -> Option<String> {
    record.id.clone().or_else(|| record.paths.first().cloned())
}

fn open_set(
    connection: &Connection,
    label: &str,
    clock: &impl Clock,
) -> Result<i64, ChangeError> {
    connection.execute(
        "INSERT INTO changesets (label, created) VALUES (?1, ?2)",
        params![label, clock.now_millis() as i64],
    )?;
    Ok(connection.last_insert_rowid())
}

/// Record one proposal.
///
/// An addition starts accepted because filling a blank loses nothing. A
/// modification starts unaccepted because it overwrites something a person
/// chose.
fn propose(
    connection: &Connection,
    set: i64,
    object: i64,
    field_path: &str,
    old: Option<&str>,
    new: Option<&str>,
    reason: Option<&str>,
) -> Result<(), ChangeError> {
    let accepted = i64::from(old.is_none());

    connection.execute(
        "INSERT INTO changes
            (changeset, object_id, field_path, old_value, new_value, reason, accepted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (changeset, object_id, field_path) DO UPDATE SET
            new_value = excluded.new_value,
            reason    = excluded.reason",
        params![set, object, field_path, old, new, reason, accepted],
    )?;
    Ok(())
}

/// Every set awaiting review, oldest first.
pub fn pending(connection: &Connection) -> Result<Vec<ChangeSet>, ChangeError> {
    let mut statement = connection.prepare(
        "SELECT id, label, created, applied FROM changesets
         WHERE applied IS NULL ORDER BY created, id",
    )?;
    let sets = statement
        .query_map([], |row| {
            Ok(ChangeSet {
                id: row.get(0)?,
                label: row.get(1)?,
                created: row.get(2)?,
                applied: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(sets)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::changes::apply;
    use crate::contract::{Document, ObjectRecord};
    use crate::store::schema;

    struct Ticks(std::cell::Cell<u64>);

    impl Ticks {
        fn at(millis: u64) -> Self {
            Self(std::cell::Cell::new(millis))
        }
    }

    impl Clock for Ticks {
        fn now_millis(&self) -> u64 {
            self.0.get()
        }
    }

    fn library() -> (Connection, Values) {
        (schema::open_in_memory().expect("open"), Values::new())
    }

    fn record(path: &str, values: &[(&str, &str)]) -> ObjectRecord {
        ObjectRecord {
            paths: vec![path.to_string()],
            values: values
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            ..ObjectRecord::default()
        }
    }

    fn document(records: Vec<ObjectRecord>) -> Document {
        Document { objects: records, ..Document::new() }
    }

    fn import_now(
        connection: &Connection,
        values: &mut Values,
        doc: &Document,
        label: &str,
    ) -> Imported {
        import_at(connection, values, doc, label, &Ticks::at(1000)).expect("import")
    }

    // --- writing what fits ------------------------------------------------

    #[test]
    fn an_empty_field_is_written_without_review() {
        // Writing a value into an empty field just happens.
        let (connection, mut values) = library();
        let doc = document(vec![record("Clothing/thing", &[("title", "BE NATURAL")])]);

        let outcome = import_now(&connection, &mut values, &doc, "import");

        assert_eq!(outcome.written, 1);
        assert!(outcome.is_settled(), "nothing should need reviewing");
        assert!(pending(&connection).expect("pending").is_empty());
    }

    #[test]
    fn importing_the_same_document_twice_changes_nothing() {
        // What makes an import safe to retry after a failure.
        let (connection, mut values) = library();
        let doc = document(vec![record("Clothing/thing", &[("title", "x")])]);

        let first = import_now(&connection, &mut values, &doc, "import");
        let second = import_now(&connection, &mut values, &doc, "import");

        assert_eq!(first.written, 1);
        assert_eq!(second.written, 0);
        assert_eq!(second.unchanged, 1);
        assert_eq!(second.objects_created, 0, "a second import made another object");

        let objects: i64 = connection
            .query_row("SELECT count(*) FROM objects", [], |row| row.get(0))
            .expect("count");
        assert_eq!(objects, 1);
    }

    #[test]
    fn an_import_matches_an_object_by_a_path_it_already_has() {
        let (connection, mut values) = library();
        let object = values.create_object(&connection).expect("object");
        connection
            .execute(
                "INSERT INTO object_paths (object_id, path, kind)
                 VALUES (?1, 'Clothing/thing', 'folder')",
                rusqlite::params![object],
            )
            .expect("path");

        let doc = document(vec![record("Clothing/thing", &[("title", "x")])]);
        let outcome = import_now(&connection, &mut values, &doc, "import");

        assert_eq!(outcome.objects_created, 0);
        assert_eq!(
            values.get(&connection, object, "title").expect("read"),
            Some("x".to_string())
        );
    }

    #[test]
    fn an_imported_object_is_recorded_where_it_sits() {
        // This asserted the opposite until scanning moved into a plugin. The
        // reasoning was that a document does not say whether a path is a file
        // or a folder -- true at the time, and it made an import the one way
        // into the library that could not say where anything is.
        let (connection, mut values) = library();
        let doc = document(vec![record("Clothing/outfit.zip", &[("title", "x")])]);

        import_now(&connection, &mut values, &doc, "import");

        let recorded: String = connection
            .query_row("SELECT path FROM object_paths", [], |row| row.get(0))
            .expect("one location");
        assert_eq!(recorded, "Clothing/outfit.zip");
    }

    #[test]
    fn a_document_says_which_of_its_paths_are_folders() {
        // The core cannot look: an import may name a path that is not on disk
        // yet. Whoever wrote the document knows, so the document carries it.
        let (connection, mut values) = library();
        let mut folder = record("Clothing", &[("title", "clothes")]);
        folder.folders.push("Clothing".to_string());
        let doc = document(vec![folder]);

        import_now(&connection, &mut values, &doc, "import");

        let kind: String = connection
            .query_row("SELECT kind FROM object_paths", [], |row| row.get(0))
            .expect("one location");
        assert_eq!(kind, "folder");
    }

    #[test]
    fn a_grouping_still_gets_no_location() {
        // An object with no paths is a grouping, which is a legitimate thing
        // to be. Inventing a location for it would put it in every listing of
        // things on disk.
        let (connection, mut values) = library();
        let mut grouping = record("", &[("title", "my collection")]);
        grouping.paths.clear();
        grouping.id = Some("collection".into());
        let doc = document(vec![grouping]);

        import_now(&connection, &mut values, &doc, "import");

        let locations: i64 = connection
            .query_row("SELECT count(*) FROM object_paths", [], |row| row.get(0))
            .expect("count");
        assert_eq!(locations, 0);
    }

    // --- proposing what does not fit --------------------------------------

    #[test]
    fn overwriting_a_different_value_becomes_a_proposal() {
        // Overwriting a field that already holds something produces a set.
        let (connection, mut values) = library();
        let doc = document(vec![record("Clothing/thing", &[("title", "mine")])]);
        import_now(&connection, &mut values, &doc, "first");

        let other = document(vec![record("Clothing/thing", &[("title", "theirs")])]);
        let outcome = import_now(&connection, &mut values, &other, "second");

        assert!(!outcome.is_settled(), "a conflict should need review");
        let set = outcome.pending.expect("a set");

        let proposals = apply::entries(&connection, set).expect("entries");
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].old.as_deref(), Some("mine"));
        assert_eq!(proposals[0].new.as_deref(), Some("theirs"));
    }

    #[test]
    fn a_proposal_does_not_touch_the_value_until_applied() {
        let (connection, mut values) = library();
        let doc = document(vec![record("Clothing/thing", &[("title", "mine")])]);
        import_now(&connection, &mut values, &doc, "first");

        let other = document(vec![record("Clothing/thing", &[("title", "theirs")])]);
        import_now(&connection, &mut values, &other, "second");

        let object = values
            .find_by_value(&connection, "@import/key", "Clothing/thing")
            .expect("find")
            .expect("object");
        assert_eq!(
            values.get(&connection, object, "title").expect("read"),
            Some("mine".to_string()),
            "a proposal wrote through without review"
        );
    }

    #[test]
    fn an_import_with_no_conflicts_opens_no_set() {
        // A set with nothing in it is a review screen with nothing to review.
        let (connection, mut values) = library();
        let doc = document(vec![record("a", &[("title", "x")])]);

        import_now(&connection, &mut values, &doc, "import");

        let sets: i64 = connection
            .query_row("SELECT count(*) FROM changesets", [], |row| row.get(0))
            .expect("count");
        assert_eq!(sets, 0);
    }

    #[test]
    fn a_proposal_carries_its_reason() {
        // A classifier filed outfits as editor tools because they bundled
        // lilToon; the mistake was only obvious once the reasoning showed.
        let (connection, mut values) = library();
        import_now(
            &connection,
            &mut values,
            &document(vec![record("Santa.zip", &[("vrchat#1/category", "clothing")])]),
            "first",
        );

        let mut suggestion = record("Santa.zip", &[("vrchat#1/category", "tool")]);
        suggestion.reason = Some("contains Assets/**/Editor/*.cs".into());
        let outcome = import_now(&connection, &mut values, &document(vec![suggestion]), "ai");

        let set = outcome.pending.expect("a set");
        let proposals = apply::entries(&connection, set).expect("entries");
        assert_eq!(
            proposals[0].reason.as_deref(),
            Some("contains Assets/**/Editor/*.cs")
        );
    }

    // --- defaults ---------------------------------------------------------

    #[test]
    fn a_modification_starts_unaccepted() {
        // It overwrites something a person chose.
        let (connection, mut values) = library();
        import_now(&connection, &mut values, &document(vec![record("a", &[("title", "mine")])]), "1");
        let outcome = import_now(
            &connection,
            &mut values,
            &document(vec![record("a", &[("title", "theirs")])]),
            "2",
        );

        let set = outcome.pending.expect("set");
        let proposals = apply::entries(&connection, set).expect("entries");
        assert!(!proposals[0].accepted);
        assert_eq!(proposals[0].kind(), crate::changes::Kind::Modification);
    }

    #[test]
    fn accepting_additions_leaves_modifications_alone() {
        // The most useful bulk action: fill in blanks without touching a
        // single decision already made.
        let (connection, mut values) = library();
        import_now(&connection, &mut values, &document(vec![record("a", &[("title", "mine")])]), "1");

        let outcome = import_now(
            &connection,
            &mut values,
            &document(vec![record("a", &[("title", "theirs")])]),
            "2",
        );
        let set = outcome.pending.expect("set");

        apply::accept_all(&connection, set, false).expect("decline all");
        apply::accept_additions(&connection, set).expect("accept additions");

        let proposals = apply::entries(&connection, set).expect("entries");
        assert!(!proposals[0].accepted, "a modification was swept up");
    }

    // --- edges and terms --------------------------------------------------

    #[test]
    fn a_document_brings_its_vocabulary_with_it() {
        // 73 avatars are referenced by the seed library's assets. An import
        // that dropped them would leave every compatibility edge pointing at
        // nothing.
        use crate::contract::TermRecord;
        use crate::store::vocab;

        let (connection, mut values) = library();
        let mut doc = document(vec![]);
        doc.terms.push(TermRecord {
            vocab: "avatar".into(),
            id: "kikyo".into(),
            label: "桔梗".into(),
            aliases: ["Kikyo", "Kikyou", "桔梗"].map(String::from).to_vec(),
        });

        let outcome = import_at(&connection, &mut values, &doc, "seed", &Ticks::at(1))
            .expect("import");

        assert_eq!(outcome.terms, 1);
        assert_eq!(
            vocab::resolve(&connection, "avatar", "Kikyou").expect("resolve"),
            Some("kikyo".to_string())
        );
    }

    #[test]
    fn an_edge_to_a_term_is_recorded() {
        use crate::contract::{EdgeRecord, TermRecord};
        use crate::store::edges;

        let (connection, mut values) = library();
        let mut doc = document(vec![]);
        doc.terms.push(TermRecord {
            vocab: "avatar".into(),
            id: "manuka".into(),
            label: "マヌカ".into(),
            aliases: vec![],
        });
        let mut outfit = record("outfit.zip", &[("title", "outfit")]);
        outfit.edges.push(EdgeRecord::to_term("supports", "avatar", "manuka"));
        doc.objects.push(outfit);

        let outcome =
            import_at(&connection, &mut values, &doc, "seed", &Ticks::at(1)).expect("import");
        assert_eq!(outcome.edges, 1);

        let fits = edges::to_term(&connection, "avatar", "manuka", None).expect("reverse");
        assert_eq!(fits.len(), 1, "the compatibility edge was lost");
    }

    #[test]
    fn an_edge_can_point_at_an_object_further_down_the_document() {
        // Edges are resolved after every object exists. One pass would look
        // the target up in a library that does not hold it yet.
        use crate::contract::EdgeRecord;
        use crate::store::edges;

        let (connection, mut values) = library();
        let mut collection = record("collection", &[("title", "my textures")]);
        collection.edges.push(EdgeRecord::to_object("contains", "Textures/skin.png"));

        // The target is the *second* record.
        let doc = document(vec![collection, record("Textures/skin.png", &[("title", "skin")])]);

        let outcome =
            import_at(&connection, &mut values, &doc, "seed", &Ticks::at(1)).expect("import");
        assert_eq!(outcome.edges, 1, "a forward reference was dropped");

        let source = values
            .find_by_value(&connection, "@import/key", "collection")
            .expect("find")
            .expect("object");
        assert_eq!(edges::from(&connection, source, None).expect("read").len(), 1);
    }

    #[test]
    fn an_edge_to_something_this_library_does_not_have_is_skipped() {
        // Inventing an object for it would put a pathless shell in every
        // listing, which is what the vocabulary decision exists to avoid.
        use crate::contract::EdgeRecord;

        let (connection, mut values) = library();
        let mut orphan = record("a.zip", &[("title", "a")]);
        orphan.edges.push(EdgeRecord::to_object("requires", "not/in/this/library"));

        let outcome = import_at(
            &connection,
            &mut values,
            &document(vec![orphan]),
            "seed",
            &Ticks::at(1),
        )
        .expect("import");

        assert_eq!(outcome.edges, 0, "an unresolvable edge was counted as recorded");

        let objects: i64 = connection
            .query_row("SELECT count(*) FROM objects", [], |row| row.get(0))
            .expect("count");
        assert_eq!(objects, 1, "a shell object was invented for the target");
    }

    #[test]
    fn a_malformed_edge_is_skipped_rather_than_guessed_at() {
        use crate::contract::EdgeRecord;

        let (connection, mut values) = library();
        let mut confused = record("a.zip", &[("title", "a")]);
        confused.edges.push(EdgeRecord {
            kind: "supports".into(),
            object: Some("a.zip".into()),
            term: Some("avatar:manuka".into()),
            reason: None,
        });

        let outcome = import_at(
            &connection,
            &mut values,
            &document(vec![confused]),
            "seed",
            &Ticks::at(1),
        )
        .expect("import");

        assert_eq!(outcome.edges, 0);
    }

    #[test]
    fn importing_a_document_with_edges_twice_does_not_duplicate_them() {
        use crate::contract::{EdgeRecord, TermRecord};
        use crate::store::edges;

        let (connection, mut values) = library();
        let mut doc = document(vec![]);
        doc.terms.push(TermRecord {
            vocab: "avatar".into(),
            id: "manuka".into(),
            label: "Manuka".into(),
            aliases: vec![],
        });
        let mut outfit = record("outfit.zip", &[("title", "outfit")]);
        outfit.edges.push(EdgeRecord::to_term("supports", "avatar", "manuka"));
        doc.objects.push(outfit);

        import_at(&connection, &mut values, &doc, "seed", &Ticks::at(1)).expect("first");
        import_at(&connection, &mut values, &doc, "seed", &Ticks::at(2)).expect("second");

        assert_eq!(
            edges::to_term(&connection, "avatar", "manuka", None).expect("reverse").len(),
            1,
            "the second import duplicated the edge"
        );
    }

    #[test]
    fn the_seed_librarys_avatar_vocabulary_imports() {
        // The shape the vocabulary decision was written around: a term with
        // three spellings, referenced by an asset, with no base owned.
        use crate::contract::{EdgeRecord, TermRecord};
        use crate::store::{edges, vocab};

        let (connection, mut values) = library();
        let mut doc = document(vec![]);

        for (id, label, aliases) in [
            ("kikyo", "桔梗", vec!["Kikyo", "Kikyou", "桔梗"]),
            ("selestia", "セレスティア", vec!["Selestia"]),
        ] {
            doc.terms.push(TermRecord {
                vocab: "avatar".into(),
                id: id.into(),
                label: label.into(),
                aliases: aliases.into_iter().map(String::from).collect(),
            });
        }

        let mut outfit = record(".AASHAREE/CLOTHS/Cross_Maid_Fullset", &[("title", "Cross Maid")]);
        outfit.edges.push(EdgeRecord::to_term("supports", "avatar", "kikyo"));
        outfit.edges.push(EdgeRecord::to_term("supports", "avatar", "selestia"));
        doc.objects.push(outfit);

        let outcome =
            import_at(&connection, &mut values, &doc, "seed", &Ticks::at(1)).expect("import");

        assert_eq!(outcome.terms, 2);
        assert_eq!(outcome.edges, 2);

        // Selestia: referenced, base not owned. Information, not an error.
        assert_eq!(edges::count_to_term(&connection, "avatar", "selestia").expect("c"), 1);
        assert_eq!(
            vocab::resolve(&connection, "avatar", "桔梗").expect("resolve"),
            Some("kikyo".to_string())
        );
    }

}
