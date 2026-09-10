//! Which properties an object carries by decision.
//!
//! "This is a paper" and "this paper has a DOI" are two statements, and only
//! the second used to be storable. An object's properties were derived from
//! the values written under them, so a person who chose a type and filled
//! nothing in got an object carrying nothing — no panel, no viewer, no region.
//! The decision they made evaporated along with the empty form.
//!
//! # Why not a field under `values_`
//!
//! Writing `paper#1/present = true` would make flattening see the property,
//! and that was tried: migration V3 exists to delete those rows. A marker
//! field has to be understood by flattening, filtered out of every read, and
//! cleaned up when it is abandoned. Keeping it out means flattening stays
//! about values, which is all it was ever for.
//!
//! # This is the picker's half of the store
//!
//! `paths.rs` records where an object lives, `values.rs` what it holds, and
//! this what it *is*. The three change on different schedules: a rescan
//! rewrites locations, an import rewrites values, and only a person changes
//! what something is.
//!
//! Carrying a property is not the same as the library mounting it. A mount is
//! library-wide and orders every object's regions; this is one object saying
//! which properties apply to it. An object can carry a property the library
//! does not mount, and its values wait in storage exactly as the architecture
//! describes.

use rusqlite::{params, Connection};

use crate::store::path;

/// A property that cannot be carried.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CarriedError {
    /// A namespace the core keeps for itself.
    Reserved(String),
    /// An empty or whitespace-only namespace.
    NotAName(String),
    Storage(String),
}

impl std::fmt::Display for CarriedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Reserved(name) => write!(f, "{name:?} is reserved by the core"),
            Self::NotAName(name) => write!(f, "{name:?} is not a property name"),
            Self::Storage(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for CarriedError {}

impl From<rusqlite::Error> for CarriedError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(error.to_string())
    }
}

/// Record that an object carries a property.
///
/// Idempotent: choosing a type twice is one decision, not an error. A second
/// call is what a person editing an object's types produces, and failing there
/// would make the caller check first for no gain.
///
/// `OR IGNORE` rather than `OR REPLACE`, which deletes the row before
/// inserting it. Nothing cascades from this table today, so the two behave
/// identically and no test tells them apart — but the day something references
/// it, replace would quietly take that with it.
///
/// # Reserved names are refused here
///
/// `plugin::manifest` already refuses a plugin *declaring* `fs` or `@pin`, and
/// flattening never lets a stored field compete with a core one. Neither guard
/// covers this table: its writes never reach `values_`, and nothing about being
/// carried goes through a manifest. Attaching `fs` would put `fs#1` into the
/// list that drives slot arbitration, through a door the other two do not
/// watch.
///
/// The list comes from `store::path` rather than being repeated here, because a
/// second copy of the core's schema is one that disagrees with the first.
pub fn attach(
    connection: &Connection,
    object: i64,
    namespace: &str,
    instance: u32,
) -> Result<(), CarriedError> {
    if namespace.trim().is_empty() {
        return Err(CarriedError::NotAName(namespace.to_string()));
    }
    if path::is_reserved(namespace) {
        return Err(CarriedError::Reserved(namespace.to_string()));
    }

    connection.execute(
        "INSERT OR IGNORE INTO object_properties (object_id, namespace, instance)
         VALUES (?1, ?2, ?3)",
        params![object, namespace, instance],
    )?;
    Ok(())
}

/// Forget that an object carries a property.
///
/// The values written under it stay. Removing them here would make undoing a
/// mis-click destroy what was typed before it, and the values are still
/// readable the moment the property is attached again.
pub fn detach(
    connection: &Connection,
    object: i64,
    namespace: &str,
    instance: u32,
) -> rusqlite::Result<()> {
    connection.execute(
        "DELETE FROM object_properties
         WHERE object_id = ?1 AND namespace = ?2 AND instance = ?3",
        params![object, namespace, instance],
    )?;
    Ok(())
}

/// What an object carries by decision, in a stable order.
///
/// Sorted so two reads of one object agree. Placement order is mount order and
/// belongs to the caller; this only says which properties are in play.
pub fn of_object(connection: &Connection, object: i64) -> rusqlite::Result<Vec<(String, u32)>> {
    let mut statement = connection.prepare(
        "SELECT namespace, instance FROM object_properties
         WHERE object_id = ?1
         ORDER BY namespace, instance",
    )?;

    let rows = statement.query_map(params![object], |row| Ok((row.get(0)?, row.get(1)?)))?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{schema, values::Values};

    /// A database with one object in it.
    fn library() -> (Connection, i64) {
        let mut connection = Connection::open_in_memory().expect("open");
        schema::migrate(&mut connection).expect("migrate");
        let id = Values::new().create_object(&connection).expect("object");
        (connection, id)
    }

    #[test]
    fn what_was_attached_reads_back() {
        let (connection, id) = library();
        attach(&connection, id, "paper", 1).expect("attach");

        assert_eq!(of_object(&connection, id).unwrap(), [("paper".to_string(), 1)]);
    }

    #[test]
    fn an_object_carries_several_properties_at_once() {
        // The whole reason this table exists. A PDF can be a paper and a
        // VRChat asset, and neither displaces the other.
        let (connection, id) = library();
        for namespace in ["vrchat", "paper"] {
            attach(&connection, id, namespace, 1).expect("attach");
        }

        assert_eq!(
            of_object(&connection, id).unwrap(),
            [("paper".to_string(), 1), ("vrchat".to_string(), 1)]
        );
    }

    #[test]
    fn attaching_twice_is_one_decision() {
        // What a person editing an object's types produces. Failing here would
        // make every caller check first for nothing.
        let (connection, id) = library();
        attach(&connection, id, "paper", 1).expect("first");
        attach(&connection, id, "paper", 1).expect("second");

        assert_eq!(of_object(&connection, id).unwrap().len(), 1);
    }

    #[test]
    fn two_instances_of_one_property_are_two_rows() {
        // An object with two shop pages carries `booth#1` and `booth#2`, and
        // collapsing them would lose one.
        let (connection, id) = library();
        attach(&connection, id, "booth", 1).expect("first");
        attach(&connection, id, "booth", 2).expect("second");

        assert_eq!(of_object(&connection, id).unwrap().len(), 2);
    }

    #[test]
    fn detaching_forgets_only_what_was_named() {
        let (connection, id) = library();
        attach(&connection, id, "paper", 1).expect("attach");
        attach(&connection, id, "vrchat", 1).expect("attach");

        detach(&connection, id, "paper", 1).expect("detach");

        assert_eq!(of_object(&connection, id).unwrap(), [("vrchat".to_string(), 1)]);
    }

    #[test]
    fn detaching_keeps_the_values_written_under_it() {
        // Undoing a mis-click must not destroy what was typed before it. The
        // values are readable again the moment the property comes back.
        let (connection, id) = library();
        let mut store = Values::new();
        store.set(&connection, id, "paper#1/doi", "10.1000/x").expect("set");
        attach(&connection, id, "paper", 1).expect("attach");

        detach(&connection, id, "paper", 1).expect("detach");

        let rows = store.rows(&connection, id).expect("rows");
        assert!(rows.iter().any(|row| row.path == "paper#1/doi"));
    }

    #[test]
    fn detaching_something_never_attached_is_not_an_error() {
        let (connection, id) = library();

        detach(&connection, id, "paper", 1).expect("detach");
    }

    #[test]
    fn a_reserved_namespace_is_refused() {
        // `plugin::manifest` refuses a plugin *declaring* `fs`, and flattening
        // stops a stored field competing with a core one. Neither guard sees
        // this table, so attaching `fs` would put `fs#1` into the list that
        // drives slot arbitration through a door nobody watches.
        let (connection, id) = library();

        for reserved in path::RESERVED {
            assert_eq!(
                attach(&connection, id, reserved, 1),
                Err(CarriedError::Reserved((*reserved).to_string())),
                "{reserved} was accepted"
            );
        }
        assert!(of_object(&connection, id).unwrap().is_empty());
    }

    #[test]
    fn a_namespace_that_is_not_a_name_is_refused() {
        // An empty string reads back as a property with no name, which no
        // plugin can ever be scoped to -- it would sit in `carries` forever
        // with nothing able to draw it.
        let (connection, id) = library();

        for blank in ["", "   "] {
            assert_eq!(
                attach(&connection, id, blank, 1),
                Err(CarriedError::NotAName(blank.to_string()))
            );
        }
    }

    #[test]
    fn an_object_with_no_choices_carries_nothing() {
        let (connection, id) = library();

        assert!(of_object(&connection, id).unwrap().is_empty());
    }

    #[test]
    fn deleting_an_object_takes_its_properties_with_it() {
        // The cascade is declared in the schema; a declaration nobody executes
        // is a hope. Foreign keys are off by default in SQLite.
        let (connection, id) = library();
        attach(&connection, id, "paper", 1).expect("attach");

        connection
            .execute("DELETE FROM objects WHERE id = ?1", params![id])
            .expect("delete");

        let left: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM object_properties WHERE object_id = ?1",
                params![id],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(left, 0, "the cascade did not fire");
    }
}
