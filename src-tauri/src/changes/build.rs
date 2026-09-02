//! Turning a document into writes that happen and proposals that wait.
//!
//! `values::set` already draws the line: it writes into an empty field and
//! reports a conflict rather than overwriting. This module takes that report
//! and turns it into a reviewable entry, so the rule lives in one place and
//! this is wiring rather than a second judgement.

use rusqlite::{Connection, params};

use crate::changes::{ChangeError, ChangeSet};
use crate::contract::Document;
use crate::store::id::{Clock, SystemClock};
use crate::store::values::{Values, WriteError, Written};

/// What importing a document did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Imported {
    /// Fields that were empty and now hold a value.
    pub written: usize,
    /// Fields that already held exactly this value.
    pub unchanged: usize,
    /// Objects created because no path matched.
    pub objects_created: usize,
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

    for record in &document.objects {
        let (object, created) = match_object(connection, values, record)?;
        if created {
            outcome.objects_created += 1;
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

    outcome.pending = set;
    Ok(outcome)
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
    use crate::store::history;
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
    fn an_imported_object_gets_no_location() {
        // A document carries values, not disk state. It does not say whether a
        // path is a file or a folder, and guessing would leave the next scan
        // arguing with a made-up answer.
        let (connection, mut values) = library();
        let doc = document(vec![record("Clothing/not-here-yet", &[("title", "x")])]);

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

    // --- applying ---------------------------------------------------------

    #[test]
    fn applying_writes_only_what_was_accepted() {
        let (connection, mut values) = library();
        import_now(
            &connection,
            &mut values,
            &document(vec![record("a", &[("title", "mine"), ("note", "keep")])]),
            "1",
        );
        let outcome = import_now(
            &connection,
            &mut values,
            &document(vec![record("a", &[("title", "theirs"), ("note", "replaced")])]),
            "2",
        );
        let set = outcome.pending.expect("set");

        let proposals = apply::entries(&connection, set).expect("entries");
        let title = proposals.iter().find(|c| c.field_path == "title").expect("title");
        apply::set_accepted(&connection, title.id, true).expect("accept");

        let applied = apply::apply_at(&connection, &values, set, &Ticks::at(2000)).expect("apply");
        assert_eq!(applied.changed, 1);
        assert_eq!(applied.declined, 1);

        let object = values
            .find_by_value(&connection, "@import/key", "a")
            .expect("find")
            .expect("object");
        assert_eq!(values.get(&connection, object, "title").expect("r"), Some("theirs".into()));
        assert_eq!(values.get(&connection, object, "note").expect("r"), Some("keep".into()));
    }

    #[test]
    fn applying_records_history_in_one_batch() {
        let (connection, mut values) = library();
        import_now(&connection, &mut values, &document(vec![record("a", &[("title", "mine")])]), "1");
        let outcome = import_now(
            &connection,
            &mut values,
            &document(vec![record("a", &[("title", "theirs")])]),
            "2",
        );
        let set = outcome.pending.expect("set");
        apply::accept_all(&connection, set, true).expect("accept");

        let applied = apply::apply_at(&connection, &values, set, &Ticks::at(2000)).expect("apply");
        let batch = applied.batch.expect("batch");

        let recorded = history::of_batch(&connection, batch).expect("history");
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0].old.as_deref(), Some("mine"));
        assert_eq!(recorded[0].new.as_deref(), Some("theirs"));
    }

    #[test]
    fn a_set_cannot_be_applied_twice() {
        // The second pass would write against an old_value two versions stale.
        let (connection, mut values) = library();
        import_now(&connection, &mut values, &document(vec![record("a", &[("title", "mine")])]), "1");
        let outcome = import_now(
            &connection,
            &mut values,
            &document(vec![record("a", &[("title", "theirs")])]),
            "2",
        );
        let set = outcome.pending.expect("set");
        apply::accept_all(&connection, set, true).expect("accept");

        apply::apply_at(&connection, &values, set, &Ticks::at(2000)).expect("first");
        let again = apply::apply_at(&connection, &values, set, &Ticks::at(3000));

        assert!(matches!(again, Err(ChangeError::AlreadyApplied(_))));
    }

    #[test]
    fn a_field_that_moved_since_the_proposal_is_refused() {
        // Someone edited the field between the set being built and applied.
        // Applying anyway would overwrite that without it being seen.
        let (connection, mut values) = library();
        import_now(&connection, &mut values, &document(vec![record("a", &[("title", "mine")])]), "1");
        let outcome = import_now(
            &connection,
            &mut values,
            &document(vec![record("a", &[("title", "theirs")])]),
            "2",
        );
        let set = outcome.pending.expect("set");
        apply::accept_all(&connection, set, true).expect("accept");

        // A person edits the field in the meantime.
        let object = values.find_by_value(&connection, "@import/key", "a").expect("f").expect("o");
        values.overwrite(&connection, object, "title", "something else").expect("edit");

        let result = apply::apply_at(&connection, &values, set, &Ticks::at(2000));
        assert!(matches!(result, Err(ChangeError::Stale { .. })), "got {result:?}");

        assert_eq!(
            values.get(&connection, object, "title").expect("read"),
            Some("something else".to_string()),
            "the intervening edit was overwritten"
        );
    }

    #[test]
    fn a_declined_entry_stays_as_a_record() {
        let (connection, mut values) = library();
        import_now(&connection, &mut values, &document(vec![record("a", &[("title", "mine")])]), "1");
        let outcome = import_now(
            &connection,
            &mut values,
            &document(vec![record("a", &[("title", "theirs")])]),
            "2",
        );
        let set = outcome.pending.expect("set");

        apply::apply_at(&connection, &values, set, &Ticks::at(2000)).expect("apply");

        let proposals = apply::entries(&connection, set).expect("entries");
        assert_eq!(proposals.len(), 1, "a declined entry was deleted");
        assert!(!proposals[0].accepted);
    }

    #[test]
    fn an_applied_set_leaves_the_pending_list() {
        let (connection, mut values) = library();
        import_now(&connection, &mut values, &document(vec![record("a", &[("title", "mine")])]), "1");
        let outcome = import_now(
            &connection,
            &mut values,
            &document(vec![record("a", &[("title", "theirs")])]),
            "2",
        );
        let set = outcome.pending.expect("set");
        assert_eq!(pending(&connection).expect("pending").len(), 1);

        apply::apply_at(&connection, &values, set, &Ticks::at(2000)).expect("apply");
        assert!(pending(&connection).expect("pending").is_empty());
    }

    #[test]
    fn applying_a_set_that_does_not_exist_says_so() {
        let (connection, values) = library();
        assert!(matches!(
            apply::apply_at(&connection, &values, 999, &Ticks::at(1)),
            Err(ChangeError::NoSuchSet(999))
        ));
    }

    // --- review ------------------------------------------------------------

    #[test]
    fn a_summary_counts_what_is_on_offer() {
        let (connection, mut values) = library();
        import_now(&connection, &mut values, &document(vec![record("a", &[("title", "mine")])]), "1");
        let outcome = import_now(
            &connection,
            &mut values,
            &document(vec![record("a", &[("title", "theirs"), ("note", "new")])]),
            "2",
        );
        let set = outcome.pending.expect("set");

        let summary = apply::summary(&connection, set).expect("summary");
        assert_eq!(summary.modifications, 1);
        // `note` was empty, so it was written directly rather than proposed.
        assert_eq!(summary.additions, 0);
    }
}
