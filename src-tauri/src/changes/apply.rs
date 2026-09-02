//! Reviewing a change set and applying what was accepted.
//!
//! Applying is all or nothing and belongs in one transaction: half an applied
//! set leaves the library holding sixteen of thirty-one values with a history
//! batch that reads no differently from a complete one.

use rusqlite::{Connection, OptionalExtension, params};

use crate::changes::{Change, ChangeError, ChangeSet, Kind};
use crate::store::history::{self, Batch};
use crate::store::id::{Clock, SystemClock};
use crate::store::values::Values;

/// What applying a set did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Applied {
    pub changed: usize,
    /// Accepted entries whose value was already what they proposed.
    pub already_matched: usize,
    /// Entries left unaccepted. They stay in the set as a record of what was
    /// offered and declined.
    pub declined: usize,
    pub batch: Option<Batch>,
}

/// One set, if it exists.
pub fn set(connection: &Connection, id: i64) -> Result<Option<ChangeSet>, ChangeError> {
    let found = connection
        .query_row(
            "SELECT id, label, created, applied FROM changesets WHERE id = ?1",
            params![id],
            |row| {
                Ok(ChangeSet {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    created: row.get(2)?,
                    applied: row.get(3)?,
                })
            },
        )
        .optional()?;
    Ok(found)
}

/// Everything a set proposes, in a stable order.
pub fn entries(connection: &Connection, set: i64) -> Result<Vec<Change>, ChangeError> {
    let mut statement = connection.prepare(
        "SELECT id, object_id, field_path, old_value, new_value, reason, accepted
         FROM changes WHERE changeset = ?1
         ORDER BY object_id, field_path",
    )?;
    let changes = statement
        .query_map(params![set], |row| {
            Ok(Change {
                id: row.get(0)?,
                object: row.get(1)?,
                field_path: row.get(2)?,
                old: row.get(3)?,
                new: row.get(4)?,
                reason: row.get(5)?,
                accepted: row.get::<_, i64>(6)? != 0,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(changes)
}

/// Accept or decline one entry.
pub fn set_accepted(
    connection: &Connection,
    change: i64,
    accepted: bool,
) -> Result<(), ChangeError> {
    connection.execute(
        "UPDATE changes SET accepted = ?2 WHERE id = ?1",
        params![change, i64::from(accepted)],
    )?;
    Ok(())
}

/// Accept every addition and leave every modification.
///
/// The most useful bulk action there is: it fills in what is missing without
/// touching a single decision a person already made. Additions are accepted by
/// default, so this mostly undoes a sweep that declined everything.
pub fn accept_additions(connection: &Connection, set: i64) -> Result<usize, ChangeError> {
    let changed = connection.execute(
        "UPDATE changes SET accepted = 1 WHERE changeset = ?1 AND old_value IS NULL",
        params![set],
    )?;
    Ok(changed)
}

/// Accept or decline everything in a set.
pub fn accept_all(
    connection: &Connection,
    set: i64,
    accepted: bool,
) -> Result<usize, ChangeError> {
    let changed = connection.execute(
        "UPDATE changes SET accepted = ?2 WHERE changeset = ?1",
        params![set, i64::from(accepted)],
    )?;
    Ok(changed)
}

/// Apply everything accepted in a set.
///
/// Belongs inside `schema::in_transaction`, with the history it writes.
///
/// Refuses a set whose field has moved since the set was built. A proposal
/// carries the value it was made against; if the field holds something else
/// now, someone changed it in between, and applying anyway would overwrite
/// that without it ever being seen. Rebuilding the set against the current
/// values is the way forward, and that is a decision for whoever is holding
/// the review screen.
pub fn apply(
    connection: &Connection,
    values: &Values,
    set_id: i64,
) -> Result<Applied, ChangeError> {
    apply_at(connection, values, set_id, &SystemClock)
}

/// Apply at a given time, so a test does not depend on the clock.
pub fn apply_at(
    connection: &Connection,
    values: &Values,
    set_id: i64,
    clock: &impl Clock,
) -> Result<Applied, ChangeError> {
    let Some(existing) = set(connection, set_id)? else {
        return Err(ChangeError::NoSuchSet(set_id));
    };
    if !existing.is_pending() {
        return Err(ChangeError::AlreadyApplied(set_id));
    }

    let proposals = entries(connection, set_id)?;
    let batch = history::begin_at(clock);
    let mut outcome = Applied { batch: Some(batch), ..Applied::default() };

    for change in &proposals {
        if !change.accepted {
            outcome.declined += 1;
            continue;
        }

        // What the field holds now, against what the proposal was built on.
        let current = values.get(connection, change.object, &change.field_path)?;
        if current != change.old {
            return Err(ChangeError::Stale {
                object: change.object,
                field_path: change.field_path.clone(),
                expected: change.old.clone(),
                found: current,
            });
        }

        let proposed = change.new.as_deref().unwrap_or("");
        let written = values.overwrite(connection, change.object, &change.field_path, proposed)?;

        use crate::store::values::Written;
        match written {
            Written::Unchanged => outcome.already_matched += 1,
            _ => {
                history::record_at(
                    connection,
                    clock,
                    change.object,
                    &change.field_path,
                    change.old.as_deref(),
                    change.new.as_deref(),
                    Some(batch),
                )?;
                outcome.changed += 1;
            }
        }
    }

    connection.execute(
        "UPDATE changesets SET applied = ?2 WHERE id = ?1",
        params![set_id, clock.now_millis() as i64],
    )?;

    Ok(outcome)
}

/// How many entries of each kind a set holds, for a review screen.
pub fn summary(connection: &Connection, set: i64) -> Result<Summary, ChangeError> {
    let changes = entries(connection, set)?;
    let mut summary = Summary::default();

    for change in &changes {
        match change.kind() {
            Kind::Addition => summary.additions += 1,
            Kind::Modification => summary.modifications += 1,
        }
        if change.accepted {
            summary.accepted += 1;
        }
    }
    Ok(summary)
}

/// What a set holds.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Summary {
    pub additions: usize,
    pub modifications: usize,
    pub accepted: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::changes::build::{import_at, pending};
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
            values: values.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            ..ObjectRecord::default()
        }
    }

    fn document(records: Vec<ObjectRecord>) -> Document {
        Document { objects: records, ..Document::new() }
    }

    /// Import, then hand back the set it opened.
    fn import_now(connection: &Connection, values: &mut Values, doc: &Document, label: &str) {
        import_at(connection, values, doc, label, &Ticks::at(1000)).expect("import");
    }

    /// Import, and hand back the set it opened.
    fn import_for_review(
        connection: &Connection,
        values: &mut Values,
        doc: &Document,
        label: &str,
    ) -> i64 {
        import_at(connection, values, doc, label, &Ticks::at(1000))
            .expect("import")
            .pending
            .expect("this import should have opened a set")
    }

    /// The two imports that leave one modification waiting for review.
    fn conflicting(connection: &Connection, values: &mut Values) -> i64 {
        import_now(connection, values, &document(vec![record("a", &[("title", "mine")])]), "1");
        import_for_review(
            connection,
            values,
            &document(vec![record("a", &[("title", "theirs")])]),
            "2",
        )
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
        let set = import_for_review(
            &connection,
            &mut values,
            &document(vec![record("a", &[("title", "theirs"), ("note", "replaced")])]),
            "2",
        );

        let proposals = entries(&connection, set).expect("entries");
        let title = proposals.iter().find(|c| c.field_path == "title").expect("title");
        set_accepted(&connection, title.id, true).expect("accept");

        let applied = apply_at(&connection, &values, set, &Ticks::at(2000)).expect("apply");
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
        let set = conflicting(&connection, &mut values);
        accept_all(&connection, set, true).expect("accept");

        let applied = apply_at(&connection, &values, set, &Ticks::at(2000)).expect("apply");
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
        let set = conflicting(&connection, &mut values);
        accept_all(&connection, set, true).expect("accept");

        apply_at(&connection, &values, set, &Ticks::at(2000)).expect("first");
        let again = apply_at(&connection, &values, set, &Ticks::at(3000));

        assert!(matches!(again, Err(ChangeError::AlreadyApplied(_))));
    }

    #[test]
    fn a_field_that_moved_since_the_proposal_is_refused() {
        // Someone edited the field between the set being built and applied.
        // Applying anyway would overwrite that without it being seen.
        let (connection, mut values) = library();
        let set = conflicting(&connection, &mut values);
        accept_all(&connection, set, true).expect("accept");

        // A person edits the field in the meantime.
        let object = values.find_by_value(&connection, "@import/key", "a").expect("f").expect("o");
        values.overwrite(&connection, object, "title", "something else").expect("edit");

        let result = apply_at(&connection, &values, set, &Ticks::at(2000));
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
        let set = conflicting(&connection, &mut values);

        apply_at(&connection, &values, set, &Ticks::at(2000)).expect("apply");

        let proposals = entries(&connection, set).expect("entries");
        assert_eq!(proposals.len(), 1, "a declined entry was deleted");
        assert!(!proposals[0].accepted);
    }

    #[test]
    fn an_applied_set_leaves_the_pending_list() {
        let (connection, mut values) = library();
        let set = conflicting(&connection, &mut values);
        assert_eq!(pending(&connection).expect("pending").len(), 1);

        apply_at(&connection, &values, set, &Ticks::at(2000)).expect("apply");
        assert!(pending(&connection).expect("pending").is_empty());
    }

    #[test]
    fn applying_a_set_that_does_not_exist_says_so() {
        let (connection, values) = library();
        assert!(matches!(
            apply_at(&connection, &values, 999, &Ticks::at(1)),
            Err(ChangeError::NoSuchSet(999))
        ));
    }

    // --- review ------------------------------------------------------------

    #[test]
    fn a_summary_counts_what_is_on_offer() {
        let (connection, mut values) = library();
        import_now(&connection, &mut values, &document(vec![record("a", &[("title", "mine")])]), "1");
        let set = import_for_review(
            &connection,
            &mut values,
            &document(vec![record("a", &[("title", "theirs"), ("note", "new")])]),
            "2",
        );

        let summary = summary(&connection, set).expect("summary");
        assert_eq!(summary.modifications, 1);
        // `note` was empty, so it was written directly rather than proposed.
        assert_eq!(summary.additions, 0);
    }
}
