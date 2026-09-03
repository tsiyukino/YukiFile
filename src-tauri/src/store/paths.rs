//! Where objects sit on disk.
//!
//! An object has zero, one or several locations. A path belongs to exactly one
//! object — object-to-path is one-to-many, path-to-object stays one-to-one,
//! because a scan that finds a file has to know which object it belongs to and
//! move detection needs one answer rather than several.
//!
//! # This is the scanner's half of the store
//!
//! `values.rs` holds what an object *is*; this holds where it *lives*. They are
//! separate because the scanner rewrites locations on every pass and never
//! touches values, while an import rewrites values and never touches
//! locations. Two concerns that change on different schedules.
//!
//! Locations live in a typed table rather than under `fs#1/path` in `values_`
//! because they need a real unique constraint on the path and real integers for
//! sizes — which is the test `2026-09-02_core-properties.md` sets for a core
//! property, and `fs` is the only one that passes it today.

use rusqlite::{params, Connection};

use crate::scan::reconcile::Known;
use crate::scan::walk::Kind;

/// Record a location for an object.
///
/// Replaces the row if that path is already recorded for this object, so a
/// rescan that finds the same file with a new size updates it rather than
/// failing. A path claimed by a *different* object is an error, not an
/// overwrite: two objects claiming one file is the state the one-path-one-object
/// rule exists to prevent, and quietly reassigning it would hide a real
/// problem.
pub fn record(
    connection: &Connection,
    object: i64,
    path: &str,
    kind: Kind,
    size: Option<u64>,
    mtime: Option<i64>,
    hash: Option<&str>,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO object_paths (object_id, path, kind, size, mtime, hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (object_id, path) DO UPDATE SET
             kind = excluded.kind,
             size = excluded.size,
             mtime = excluded.mtime,
             hash = excluded.hash",
        params![object, path, kind_name(kind), size.map(|s| s as i64), mtime, hash],
    )?;
    Ok(())
}

/// Move a path from wherever it was to a new spelling.
///
/// The object keeps its identity, which is the whole point of detecting a move
/// rather than reporting a delete and an add: everything hung on that object —
/// values, edges, history — stays hung on it.
pub fn move_path(connection: &Connection, from: &str, to: &str) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE object_paths SET path = ?2 WHERE path = ?1",
        params![from, to],
    )?;
    Ok(())
}

/// Refresh what is known about a location without changing which object owns it.
///
/// The hash is cleared rather than kept: size or mtime changing means the bytes
/// may have changed too, and a stale hash is worse than none because move
/// detection would trust it.
pub fn touch(
    connection: &Connection,
    path: &str,
    size: Option<u64>,
    mtime: Option<i64>,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE object_paths SET size = ?2, mtime = ?3, hash = NULL WHERE path = ?1",
        params![path, size.map(|s| s as i64), mtime],
    )?;
    Ok(())
}

/// Forget a location.
///
/// The object survives with one fewer location, possibly none. An object with
/// no location is a grouping, which is a legitimate thing to be — so this does
/// not delete the object, and nothing here decides that an object with nothing
/// left is worth removing.
pub fn forget(connection: &Connection, path: &str) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM object_paths WHERE path = ?1", params![path])?;
    Ok(())
}

/// Every location the library knows, as reconcile wants them.
pub fn known(connection: &Connection) -> rusqlite::Result<Vec<Known>> {
    let mut statement = connection.prepare(
        "SELECT object_id, path, kind, size, mtime, hash FROM object_paths ORDER BY path",
    )?;

    let rows = statement.query_map([], |row| {
        let kind: String = row.get(2)?;
        Ok(Known {
            object: row.get(0)?,
            path: row.get(1)?,
            kind: if kind == "folder" { Kind::Folder } else { Kind::File },
            size: row.get::<_, Option<i64>>(3)?.map(|s| s as u64),
            mtime: row.get(4)?,
            hash: row.get(5)?,
        })
    })?;

    rows.collect()
}

/// Which object holds a path, if any.
pub fn object_at(connection: &Connection, path: &str) -> rusqlite::Result<Option<i64>> {
    connection
        .query_row(
            "SELECT object_id FROM object_paths WHERE path = ?1",
            params![path],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })
}

/// Every path one object sits at.
pub fn of_object(connection: &Connection, object: i64) -> rusqlite::Result<Vec<String>> {
    let mut statement = connection
        .prepare("SELECT path FROM object_paths WHERE object_id = ?1 ORDER BY path")?;
    let rows = statement.query_map(params![object], |row| row.get(0))?;
    rows.collect()
}

/// How the schema spells a kind.
fn kind_name(kind: Kind) -> &'static str {
    match kind {
        Kind::Folder => "folder",
        Kind::File => "file",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::schema;
    use crate::store::values::Values;

    fn library() -> (Connection, i64) {
        let mut connection = Connection::open_in_memory().expect("open");
        schema::migrate(&mut connection).expect("migrate");
        connection.pragma_update(None, "foreign_keys", true).expect("fk");
        let mut values = Values::new();
        let object = values.create_object(&connection).expect("object");
        (connection, object)
    }

    #[test]
    fn a_location_is_recorded_and_read_back() {
        let (connection, object) = library();

        record(&connection, object, "a.zip", Kind::File, Some(42), Some(7), None)
            .expect("record");

        let all = known(&connection).expect("known");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].path, "a.zip");
        assert_eq!(all[0].size, Some(42));
        assert_eq!(all[0].object, object);
    }

    #[test]
    fn one_object_may_sit_at_several_paths() {
        // 43 products in the seed library are an extracted folder plus the zip
        // it came from. The old scan smuggled the second one into an
        // `archives` array because the model had no room for it.
        let (connection, object) = library();

        record(&connection, object, "Outfit", Kind::Folder, None, None, None).expect("a");
        record(&connection, object, "Outfit.zip", Kind::File, Some(9), None, None)
            .expect("b");

        assert_eq!(of_object(&connection, object).expect("paths").len(), 2);
    }

    #[test]
    fn a_path_belongs_to_one_object() {
        // Two objects claiming one file is the state the rule exists to
        // prevent. Reassigning quietly would hide it.
        let (connection, first) = library();
        let mut values = Values::new();
        let second = values.create_object(&connection).expect("second");

        record(&connection, first, "a.zip", Kind::File, None, None, None).expect("first");
        let clash = record(&connection, second, "a.zip", Kind::File, None, None, None);

        assert!(clash.is_err(), "a second object claimed a path already held");
    }

    #[test]
    fn recording_the_same_path_again_updates_it() {
        // A rescan finds the same file with a new size. That is an update, not
        // a conflict -- otherwise every second scan would fail.
        let (connection, object) = library();

        record(&connection, object, "a.zip", Kind::File, Some(1), None, None).expect("a");
        record(&connection, object, "a.zip", Kind::File, Some(2), None, None).expect("b");

        let all = known(&connection).expect("known");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].size, Some(2));
    }

    #[test]
    fn a_move_keeps_the_object() {
        // The whole reason move detection exists: values, edges and history
        // stay hung on the object rather than being lost to a delete and an
        // add.
        let (connection, object) = library();
        record(&connection, object, "old/a.zip", Kind::File, None, None, None).expect("r");

        move_path(&connection, "old/a.zip", "new/a.zip").expect("move");

        assert_eq!(object_at(&connection, "new/a.zip").expect("at"), Some(object));
        assert_eq!(object_at(&connection, "old/a.zip").expect("at"), None);
    }

    #[test]
    fn touching_clears_the_hash() {
        // Size changed, so the bytes may have too. A stale hash is worse than
        // none: move detection would trust it.
        let (connection, object) = library();
        record(&connection, object, "a.zip", Kind::File, Some(1), Some(1), Some("abc"))
            .expect("record");

        touch(&connection, "a.zip", Some(2), Some(2)).expect("touch");

        assert_eq!(known(&connection).expect("known")[0].hash, None);
    }

    #[test]
    fn forgetting_a_path_leaves_the_object() {
        // An object with no location is a grouping, which is a legitimate
        // thing to be. Deleting it here would be this module deciding
        // something that is not its decision.
        let (connection, object) = library();
        record(&connection, object, "a.zip", Kind::File, None, None, None).expect("r");

        forget(&connection, "a.zip").expect("forget");

        assert!(known(&connection).expect("known").is_empty());
        let still_there: i64 = connection
            .query_row("SELECT count(*) FROM objects WHERE id = ?1", params![object], |r| {
                r.get(0)
            })
            .expect("count");
        assert_eq!(still_there, 1, "the object was deleted with its last path");
    }

    #[test]
    fn deleting_an_object_takes_its_paths() {
        // The other direction, which the schema handles with a cascade. Rows
        // pointing at an object that is gone would break every later scan.
        let (connection, object) = library();
        record(&connection, object, "a.zip", Kind::File, None, None, None).expect("r");

        connection
            .execute("DELETE FROM objects WHERE id = ?1", params![object])
            .expect("delete");

        assert!(known(&connection).expect("known").is_empty());
    }

    #[test]
    fn a_folder_keeps_its_kind() {
        let (connection, object) = library();
        record(&connection, object, "Outfit", Kind::Folder, None, None, None).expect("r");

        assert_eq!(known(&connection).expect("known")[0].kind, Kind::Folder);
    }

    #[test]
    fn nothing_recorded_is_an_empty_answer() {
        let (connection, _) = library();

        assert!(known(&connection).expect("known").is_empty());
        assert_eq!(object_at(&connection, "nowhere").expect("at"), None);
    }
}
