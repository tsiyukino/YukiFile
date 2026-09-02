//! Field-level history: what changed, when, and in which batch.
//!
//! A record is one field's before and after. It is small — a couple of
//! megabytes for a library this size after years of edits — so it is stored
//! plainly, with no delta packing and no compression. Thumbnails never enter
//! history; replacing a cover replaces the file.
//!
//! **Recording is the caller's to do.** `values` does not write history on
//! every set, because a scan importing 1518 objects would then produce 1518
//! entries saying a field came into existence — which is not an edit, it is
//! those fields existing for the first time. History is for decisions: an
//! accepted change set, a rename, a value cleared. The caller knows which of
//! those it is doing and this module does not try to guess.
//!
//! A [`Batch`] groups the entries of one such decision, so review can show
//! "this import changed 31 fields across 12 objects" and undo can put them
//! back together.

use rusqlite::{Connection, OptionalExtension, params};

use crate::store::id::{Clock, SystemClock};

/// One field's change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Record {
    pub id: i64,
    pub object: i64,
    pub field_path: String,
    /// `None` when the field was empty before.
    pub old: Option<String>,
    /// `None` when the field was cleared.
    pub new: Option<String>,
    /// Milliseconds since the Unix epoch.
    pub at: i64,
    /// The batch this belonged to, if it was part of one.
    pub batch: Option<i64>,
}

/// A group of changes applied together.
///
/// Ids come from the clock, so a batch sorts by when it happened. They need no
/// randomness: batches are made one at a time by one process, unlike object
/// ids, which two machines have to be able to mint without colliding.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Batch(pub i64);

/// Start a batch.
pub fn begin() -> Batch {
    begin_at(&SystemClock)
}

/// Start a batch at a given time.
pub fn begin_at(clock: &impl Clock) -> Batch {
    Batch(clock.now_millis() as i64)
}

/// Record one change.
///
/// `old` and `new` are what the field held before and after. Both `None` is
/// not a change and is refused: a record that says nothing happened would sit
/// in the log forever making every reader ask what it meant.
pub fn record(
    connection: &Connection,
    object: i64,
    field_path: &str,
    old: Option<&str>,
    new: Option<&str>,
    batch: Option<Batch>,
) -> rusqlite::Result<()> {
    record_at(connection, &SystemClock, object, field_path, old, new, batch)
}

/// Record one change at a given time. Separated so tests do not have to wait
/// for the clock to move.
pub fn record_at(
    connection: &Connection,
    clock: &impl Clock,
    object: i64,
    field_path: &str,
    old: Option<&str>,
    new: Option<&str>,
    batch: Option<Batch>,
) -> rusqlite::Result<()> {
    if old.is_none() && new.is_none() {
        return Ok(());
    }
    if old == new {
        return Ok(());
    }

    connection.execute(
        "INSERT INTO history (object_id, field_path, old_value, new_value, ts, batch)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            object,
            field_path,
            old,
            new,
            clock.now_millis() as i64,
            batch.map(|Batch(id)| id)
        ],
    )?;
    Ok(())
}

/// Everything that happened to one object, newest first.
pub fn of_object(connection: &Connection, object: i64) -> rusqlite::Result<Vec<Record>> {
    let mut statement = connection.prepare(
        "SELECT id, object_id, field_path, old_value, new_value, ts, batch
         FROM history WHERE object_id = ?1 ORDER BY ts DESC, id DESC",
    )?;
    let records = statement.query_map(params![object], read_record)?.collect();
    records
}

/// Everything that happened to one field, newest first.
///
/// This is what makes a diff naturally scoped: the history of `booth#1/price`
/// is separate from the history of the local `price`, because they are
/// separate facts.
pub fn of_field(
    connection: &Connection,
    object: i64,
    field_path: &str,
) -> rusqlite::Result<Vec<Record>> {
    let mut statement = connection.prepare(
        "SELECT id, object_id, field_path, old_value, new_value, ts, batch
         FROM history WHERE object_id = ?1 AND field_path = ?2
         ORDER BY ts DESC, id DESC",
    )?;
    let records = statement.query_map(params![object, field_path], read_record)?.collect();
    records
}

/// Everything in one batch, oldest first.
///
/// Oldest first because a batch reads as a list of what was applied, and
/// undoing one means walking it backwards.
pub fn of_batch(connection: &Connection, batch: Batch) -> rusqlite::Result<Vec<Record>> {
    let mut statement = connection.prepare(
        "SELECT id, object_id, field_path, old_value, new_value, ts, batch
         FROM history WHERE batch = ?1 ORDER BY id",
    )?;
    let records = statement.query_map(params![batch.0], read_record)?.collect();
    records
}

/// What a field held before its most recent change.
///
/// The two layers mean different things and both matter to a caller offering
/// an undo: the outer is whether this field was ever changed at all, the inner
/// is whether it held anything before that change.
pub type PreviousValue = Option<Option<String>>;

/// See [`PreviousValue`].
pub fn previous_value(
    connection: &Connection,
    object: i64,
    field_path: &str,
) -> rusqlite::Result<PreviousValue> {
    connection
        .query_row(
            "SELECT old_value FROM history
             WHERE object_id = ?1 AND field_path = ?2
             ORDER BY ts DESC, id DESC LIMIT 1",
            params![object, field_path],
            |row| row.get(0),
        )
        .optional()
}

/// How many entries the log holds.
pub fn len(connection: &Connection) -> rusqlite::Result<i64> {
    connection.query_row("SELECT count(*) FROM history", [], |row| row.get(0))
}

fn read_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<Record> {
    Ok(Record {
        id: row.get(0)?,
        object: row.get(1)?,
        field_path: row.get(2)?,
        old: row.get(3)?,
        new: row.get(4)?,
        at: row.get(5)?,
        batch: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::schema;
    use crate::store::values::Values;

    /// A clock the test moves by hand, so ordering is not a race.
    struct Ticks(std::cell::Cell<u64>);

    impl Ticks {
        fn at(millis: u64) -> Self {
            Self(std::cell::Cell::new(millis))
        }
        fn tick(&self) -> &Self {
            self.0.set(self.0.get() + 1);
            self
        }
    }

    impl Clock for Ticks {
        fn now_millis(&self) -> u64 {
            self.0.get()
        }
    }

    fn library() -> (Connection, i64) {
        let connection = schema::open_in_memory().expect("open");
        let mut values = Values::new();
        let object = values.create_object(&connection).expect("create");
        (connection, object)
    }

    // --- what gets recorded ----------------------------------------------

    #[test]
    fn a_change_is_recorded_with_both_sides() {
        let (connection, object) = library();
        record(&connection, object, "title", Some("mine"), Some("theirs"), None)
            .expect("record");

        let log = of_object(&connection, object).expect("read");
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].field_path, "title");
        assert_eq!(log[0].old.as_deref(), Some("mine"));
        assert_eq!(log[0].new.as_deref(), Some("theirs"));
    }

    #[test]
    fn a_field_coming_into_existence_has_no_old_value() {
        let (connection, object) = library();
        record(&connection, object, "title", None, Some("mine"), None).expect("record");

        let log = of_object(&connection, object).expect("read");
        assert_eq!(log[0].old, None);
        assert_eq!(log[0].new.as_deref(), Some("mine"));
    }

    #[test]
    fn clearing_a_field_has_no_new_value() {
        let (connection, object) = library();
        record(&connection, object, "title", Some("mine"), None, None).expect("record");

        let log = of_object(&connection, object).expect("read");
        assert_eq!(log[0].old.as_deref(), Some("mine"));
        assert_eq!(log[0].new, None);
    }

    #[test]
    fn a_change_from_nothing_to_nothing_is_not_recorded() {
        // An entry saying nothing happened would sit in the log forever
        // making every reader ask what it meant.
        let (connection, object) = library();
        record(&connection, object, "title", None, None, None).expect("no-op");
        assert_eq!(len(&connection).expect("count"), 0);
    }

    #[test]
    fn writing_the_same_value_is_not_a_change() {
        let (connection, object) = library();
        record(&connection, object, "title", Some("mine"), Some("mine"), None).expect("no-op");
        assert_eq!(len(&connection).expect("count"), 0);
    }

    // --- scope ------------------------------------------------------------

    #[test]
    fn a_local_field_and_a_shop_field_have_separate_histories() {
        // Diffs are naturally scoped: booth#1/price and price are separate
        // facts, so their histories do not mix.
        let (connection, object) = library();
        record(&connection, object, "price", Some("2900"), Some("2500"), None).expect("a");
        record(&connection, object, "booth#1/price", Some("2900"), Some("3100"), None)
            .expect("b");

        let local = of_field(&connection, object, "price").expect("local");
        assert_eq!(local.len(), 1);
        assert_eq!(local[0].new.as_deref(), Some("2500"));

        let shop = of_field(&connection, object, "booth#1/price").expect("shop");
        assert_eq!(shop.len(), 1);
        assert_eq!(shop[0].new.as_deref(), Some("3100"));
    }

    #[test]
    fn one_object_does_not_see_another_history() {
        let connection = schema::open_in_memory().expect("open");
        let mut values = Values::new();
        let first = values.create_object(&connection).expect("a");
        let second = values.create_object(&connection).expect("b");

        record(&connection, first, "title", None, Some("a"), None).expect("a");
        record(&connection, second, "title", None, Some("b"), None).expect("b");

        assert_eq!(of_object(&connection, first).expect("read").len(), 1);
        assert_eq!(of_object(&connection, second).expect("read").len(), 1);
    }

    #[test]
    fn an_object_with_no_history_reads_empty() {
        let (connection, object) = library();
        assert!(of_object(&connection, object).expect("read").is_empty());
        assert!(of_field(&connection, object, "title").expect("read").is_empty());
    }

    // --- ordering ---------------------------------------------------------

    #[test]
    fn an_object_history_is_newest_first() {
        let (connection, object) = library();
        let clock = Ticks::at(100);

        record_at(&connection, &clock, object, "title", None, Some("first"), None).expect("1");
        record_at(&connection, clock.tick(), object, "title", Some("first"), Some("second"), None)
            .expect("2");
        record_at(&connection, clock.tick(), object, "title", Some("second"), Some("third"), None)
            .expect("3");

        let log = of_object(&connection, object).expect("read");
        let values: Vec<&str> = log.iter().filter_map(|r| r.new.as_deref()).collect();
        assert_eq!(values, ["third", "second", "first"]);
    }

    #[test]
    fn entries_in_one_millisecond_come_back_in_insertion_order() {
        // A batch applies dozens of changes inside one millisecond, so ts
        // alone does not order them and the query adds id as a tiebreak.
        //
        // This test cannot prove the tiebreak is load-bearing: SQLite returns
        // these rows by rowid with or without it, and no row count made it do
        // otherwise. It pins the behaviour callers depend on, and the ORDER BY
        // stays because relying on an undocumented default is not the same as
        // asking for what you need.
        let (connection, object) = library();
        let clock = Ticks::at(100);

        for value in ["a", "b", "c"] {
            record_at(&connection, &clock, object, "title", None, Some(value), None)
                .expect("record");
        }

        let log = of_object(&connection, object).expect("read");
        let values: Vec<&str> = log.iter().filter_map(|r| r.new.as_deref()).collect();
        assert_eq!(values, ["c", "b", "a"]);
    }

    // --- batches ----------------------------------------------------------

    #[test]
    fn a_batch_groups_what_was_applied_together() {
        // Review shows "this import changed 3 fields across 2 objects".
        let connection = schema::open_in_memory().expect("open");
        let mut values = Values::new();
        let first = values.create_object(&connection).expect("a");
        let second = values.create_object(&connection).expect("b");

        let batch = begin_at(&Ticks::at(500));
        record(&connection, first, "title", None, Some("x"), Some(batch)).expect("1");
        record(&connection, first, "price", None, Some("100"), Some(batch)).expect("2");
        record(&connection, second, "title", None, Some("y"), Some(batch)).expect("3");

        let applied = of_batch(&connection, batch).expect("read");
        assert_eq!(applied.len(), 3);

        let objects: std::collections::HashSet<i64> =
            applied.iter().map(|r| r.object).collect();
        assert_eq!(objects.len(), 2);
    }

    #[test]
    fn a_batch_reads_oldest_first() {
        // Undoing one means walking it backwards, so it reads forwards.
        let (connection, object) = library();
        let batch = begin_at(&Ticks::at(500));

        for value in ["first", "second", "third"] {
            record(&connection, object, "title", None, Some(value), Some(batch)).expect("r");
        }

        let applied = of_batch(&connection, batch).expect("read");
        let values: Vec<&str> = applied.iter().filter_map(|r| r.new.as_deref()).collect();
        assert_eq!(values, ["first", "second", "third"]);
    }

    #[test]
    fn changes_outside_a_batch_have_none() {
        let (connection, object) = library();
        record(&connection, object, "title", None, Some("x"), None).expect("record");

        assert_eq!(of_object(&connection, object).expect("read")[0].batch, None);
    }

    #[test]
    fn two_batches_do_not_mix() {
        let (connection, object) = library();
        let clock = Ticks::at(500);
        let first = begin_at(&clock);
        let second = begin_at(clock.tick());
        assert_ne!(first, second);

        record(&connection, object, "title", None, Some("a"), Some(first)).expect("1");
        record(&connection, object, "price", None, Some("b"), Some(second)).expect("2");

        assert_eq!(of_batch(&connection, first).expect("read").len(), 1);
        assert_eq!(of_batch(&connection, second).expect("read").len(), 1);
    }

    // --- undo support -----------------------------------------------------

    #[test]
    fn the_previous_value_of_a_field_is_recoverable() {
        let (connection, object) = library();
        let clock = Ticks::at(100);
        record_at(&connection, &clock, object, "title", Some("first"), Some("second"), None)
            .expect("1");
        record_at(&connection, clock.tick(), object, "title", Some("second"), Some("third"), None)
            .expect("2");

        assert_eq!(
            previous_value(&connection, object, "title").expect("read"),
            Some(Some("second".to_string()))
        );
    }

    #[test]
    fn a_field_that_was_empty_before_reads_as_such() {
        // The two layers differ: never changed, versus changed from nothing.
        let (connection, object) = library();
        record(&connection, object, "title", None, Some("mine"), None).expect("record");

        assert_eq!(
            previous_value(&connection, object, "title").expect("read"),
            Some(None),
            "changed from empty"
        );
        assert_eq!(
            previous_value(&connection, object, "note").expect("read"),
            None,
            "never changed"
        );
    }

    // --- lifetime ---------------------------------------------------------

    #[test]
    fn deleting_an_object_takes_its_history() {
        let (connection, object) = library();
        record(&connection, object, "title", None, Some("x"), None).expect("record");

        connection
            .execute("DELETE FROM objects WHERE id = ?1", params![object])
            .expect("delete");

        assert_eq!(len(&connection).expect("count"), 0);
    }

    #[test]
    fn history_is_append_only_in_practice() {
        // Nothing here updates or deletes an entry; the only way one leaves is
        // with the object it belongs to.
        let (connection, object) = library();
        record(&connection, object, "title", None, Some("a"), None).expect("1");
        record(&connection, object, "title", Some("a"), Some("b"), None).expect("2");

        assert_eq!(len(&connection).expect("count"), 2);
        let log = of_object(&connection, object).expect("read");
        assert_eq!(log[1].new.as_deref(), Some("a"), "the first entry is untouched");
    }
}
