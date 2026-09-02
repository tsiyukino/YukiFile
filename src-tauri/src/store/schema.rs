//! The database schema and its migrations.
//!
//! One library is one database file, so the whole library can be copied to
//! another machine. There is no `libraries` table; mount order and everything
//! else here belongs to the library the file is in.
//!
//! Migrations exist from the first version even though there is only one.
//! Building the mechanism at the moment it is first needed means inventing how
//! to change the schema at the same time as changing it, and those are two
//! problems that are much easier apart. Layer 3 adds the change set tables as
//! v2, so this gets exercised rather than sitting unused.

use rusqlite::{Connection, Transaction};

/// A schema version and the statements that bring the database up to it.
struct Migration {
    version: i64,
    sql: &'static str,
}

/// Every migration, in order. Append; never edit one that has shipped.
const MIGRATIONS: &[Migration] = &[Migration { version: 1, sql: V1 }];

/// The version this build expects.
pub fn latest_version() -> i64 {
    MIGRATIONS.last().map_or(0, |migration| migration.version)
}

/// Open a library database and bring it up to the latest schema version.
///
/// Every connection to a library goes through here. `foreign_keys` is a
/// per-connection setting that is not stored in the file, so a connection
/// opened any other way silently has no foreign keys and no cascades: rows
/// pointing at deleted objects would simply stay. Setting it once during
/// migration is not enough, because migration happens on one connection and
/// the application then uses others.
pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let mut connection = Connection::open(path)?;
    prepare(&connection)?;
    migrate(&mut connection)?;
    Ok(connection)
}

/// An in-memory database at the latest version, for tests.
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let mut connection = Connection::open_in_memory()?;
    prepare(&connection)?;
    migrate(&mut connection)?;
    Ok(connection)
}

/// Connection settings that are not stored in the database file.
///
/// SQLite defaults `foreign_keys` to off for backwards compatibility, and
/// some builds default it on. Relying on either is relying on which SQLite
/// happens to be linked.
fn prepare(connection: &Connection) -> rusqlite::Result<()> {
    connection.pragma_update(None, "foreign_keys", "ON")
}

/// Run a group of writes that either all happen or none do.
///
/// A change set is described as a reviewable batch shaped like a pull request,
/// and a pull request either merges or does not. Applying thirty-one field
/// changes and having the seventeenth fail must not leave the first sixteen
/// behind, with a half-written batch in the history that reads no differently
/// from a complete one.
///
/// Every write in the store takes a `&Connection`, and `&Transaction` coerces
/// to one, so the modules need no transaction-aware variants: the caller opens
/// one here and passes it down exactly as it would a connection.
///
/// ```no_run
/// # use yukifile::store::{schema, values::{Values, WriteError}};
/// # fn main() -> Result<(), Box<dyn std::error::Error>> {
/// # let mut connection = schema::open_in_memory()?;
/// # let values = Values::new();
/// # let (object, changes) = (1i64, Vec::<(String, String)>::new());
/// schema::in_transaction(&mut connection, |tx| -> Result<(), WriteError> {
///     for (field, value) in &changes {
///         values.overwrite(tx, object, field, value)?;
///     }
///     Ok(())
/// })?;
/// # Ok(())
/// # }
/// ```
///
/// The closure's error type is the caller's, so a `WriteError` propagates
/// without being flattened into a database error on the way out.
pub fn in_transaction<T, E>(
    connection: &mut Connection,
    work: impl FnOnce(&Transaction<'_>) -> Result<T, E>,
) -> Result<T, E>
where
    E: From<rusqlite::Error>,
{
    let transaction = connection.transaction()?;
    let outcome = work(&transaction)?;
    transaction.commit()?;
    Ok(outcome)
}

/// Bring a database up to the latest schema version.
///
/// Each migration runs in its own transaction, so a failure part-way leaves
/// the database at the last version that fully applied rather than somewhere
/// between two.
///
/// Prefer [`open`], which also applies the per-connection settings. This is
/// public for callers that already hold a connection.
pub fn migrate(connection: &mut Connection) -> rusqlite::Result<()> {
    let current: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;

    for migration in MIGRATIONS.iter().filter(|m| m.version > current) {
        let transaction = connection.transaction()?;
        apply(&transaction, migration)?;
        transaction.commit()?;
    }
    Ok(())
}

fn apply(transaction: &Transaction<'_>, migration: &Migration) -> rusqlite::Result<()> {
    transaction.execute_batch(migration.sql)?;
    // pragma_update takes no parameters, and the version is ours rather than
    // user input.
    transaction.execute_batch(&format!("PRAGMA user_version = {}", migration.version))
}

/// The database a library starts as.
///
/// Deferred to their own migrations rather than added here with no consumer:
/// the change set tables, which layer 3 needs and layer 1 does not.
const V1: &str = r#"
-- An object is a thing in the library: a file, a folder, several of those, or
-- a grouping with no location at all.
--
-- The id is a meaningless 64-bit integer, time-ordered so inserts land at the
-- right of the B-tree rather than scattering it, and random enough in its low
-- bits that two machines merging libraries do not collide. It is derived from
-- nothing: the seed library's own history is 174 objects being moved, and an
-- identity that changes on move loses every value and edge attached to it.
--
-- primary_property names the plugin that draws this object's page. Nothing
-- reads it in v1; layout ownership is deferred, and the column is here because
-- adding it later is a migration while leaving it null costs nothing.
CREATE TABLE objects (
    id                INTEGER PRIMARY KEY,
    primary_property  TEXT
) STRICT;

-- Where an object lives on disk. No rows for a grouping, one for the common
-- case, several for something that genuinely spans folders -- 43 products in
-- the seed library are an extracted folder plus the zip it came from.
--
-- path is globally unique: one file belongs to one object. Object-to-path is
-- one-to-many; path-to-object stays one-to-one, or a scan that finds a file
-- cannot say which object it belongs to and reconcile has several candidate
-- answers where it needs one.
--
-- kind, size, mtime and hash describe a location rather than an object. An
-- object holding a folder and a zip has no single answer to "is it a file",
-- because that question is asked at the wrong level.
--
-- hash is null until computed. Hashing 1518 files must not block the first
-- scan from showing results, so reconcile has to cope with null rather than
-- assume every row has one.
CREATE TABLE object_paths (
    object_id  INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    path       TEXT    NOT NULL UNIQUE,
    kind       TEXT    NOT NULL CHECK (kind IN ('file', 'folder')),
    size       INTEGER,
    mtime      INTEGER,
    hash       TEXT,
    PRIMARY KEY (object_id, path)
) STRICT;

-- Move detection looks up by hash, and most rows have none early on.
CREATE INDEX object_paths_by_hash ON object_paths (hash) WHERE hash IS NOT NULL;

-- Values under namespaced field paths: 'title', 'booth#1/price', '@pin/cover'.
--
-- field_path rather than path. This is where a value hangs on an object;
-- object_paths.path is where the object sits on disk. Two unrelated things
-- both called path, joinable in one query, is how someone writes the wrong
-- one and gets rows back.
--
-- The primary key makes one field with two values unrepresentable rather than
-- something every reader has to cope with. Paths are normalised before insert
-- (booth/title becomes booth#1/title) or the two spellings slip past the key
-- while naming one value.
--
-- value is TEXT and holds everything, because a property's type belongs to its
-- definition rather than to each row. The values that need real types are the
-- core ones, and those are in object_paths.
CREATE TABLE values_ (
    object_id   INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    field_path  TEXT    NOT NULL,
    value       TEXT    NOT NULL,
    PRIMARY KEY (object_id, field_path)
) STRICT;

-- The order this library ranks property instances in, lowest position first.
-- Per library, because a VRChat library and a papers library have no reason to
-- trust the same sources.
--
-- Reordering deletes and reinserts the lot in one transaction. The list is
-- single digits long and reordering is rare, so sparse numbering would buy
-- nothing and cost a rule about when to renumber.
CREATE TABLE mounts (
    position   INTEGER NOT NULL PRIMARY KEY,
    namespace  TEXT    NOT NULL,
    instance   INTEGER NOT NULL,
    UNIQUE (namespace, instance)
) STRICT;

-- A vocabulary term: a name with aliases and no path. The seed library
-- references 73 avatars and owns 21 bases; modelling the other 52 as objects
-- would put pathless shells in every listing and every backup.
CREATE TABLE terms (
    vocab  TEXT NOT NULL,
    id     TEXT NOT NULL,
    label  TEXT NOT NULL,
    PRIMARY KEY (vocab, id)
) STRICT;

-- Surface forms collapsing to one term. Booth lists compatibility in Japanese
-- while filenames are English, so one term needs several.
CREATE TABLE aliases (
    vocab    TEXT NOT NULL,
    surface  TEXT NOT NULL,
    term     TEXT NOT NULL,
    PRIMARY KEY (vocab, surface),
    FOREIGN KEY (vocab, term) REFERENCES terms(vocab, id) ON DELETE CASCADE
) STRICT;

-- Anything pointing at something else. One table, one kind column: plugin
-- dependencies, bundles, version successors and compatibility all reduce to
-- this, which is what makes reverse lookup one indexed query rather than a
-- scan over array fields.
--
-- A target is an object or a term, never both and never neither, and the CHECK
-- makes that a database guarantee rather than application discipline. Putting
-- both in one TEXT column instead would lose the foreign key and the type:
-- under STRICT an INTEGER column refuses a string outright, which is what
-- keeps an object id from being compared as '42' somewhere.
--
-- kind is free text. The core does not enumerate valid edge kinds, so a plugin
-- adding 'cites' or 'remixes' needs no schema change.
CREATE TABLE edges (
    src         INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL,
    dst_object  INTEGER          REFERENCES objects(id) ON DELETE CASCADE,
    dst_vocab   TEXT,
    dst_term    TEXT,
    CHECK (
        (dst_object IS NOT NULL AND dst_vocab IS NULL     AND dst_term IS NULL)
     OR (dst_object IS NULL     AND dst_vocab IS NOT NULL AND dst_term IS NOT NULL)
    ),
    FOREIGN KEY (dst_vocab, dst_term) REFERENCES terms(vocab, id) ON DELETE CASCADE
) STRICT;

-- "What fits Manuka?" is one index hit rather than a scan.
CREATE INDEX edges_by_term
    ON edges (dst_vocab, dst_term, kind) WHERE dst_vocab IS NOT NULL;
CREATE INDEX edges_by_object
    ON edges (dst_object, kind) WHERE dst_object IS NOT NULL;
CREATE INDEX edges_by_source
    ON edges (src, kind);

-- Field-level history: a couple of megabytes for a library this size after
-- years of edits, so it is stored plainly with no delta packing. Thumbnails
-- never enter history; replacing a cover replaces the file.
--
-- old_value is null when the field was empty, new_value when it was cleared.
-- batch groups the edits of one applied change set.
CREATE TABLE history (
    id          INTEGER PRIMARY KEY,
    object_id   INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    field_path  TEXT    NOT NULL,
    old_value   TEXT,
    new_value   TEXT,
    ts          INTEGER NOT NULL,
    batch       INTEGER
) STRICT;

CREATE INDEX history_by_object ON history (object_id, ts);
"#;



#[cfg(test)]
mod tests {
    use super::*;

    /// A migrated in-memory database, opened the way the application opens
    /// one.
    fn db() -> Connection {
        open_in_memory().expect("open")
    }

    fn object(connection: &Connection, id: i64) {
        connection
            .execute("INSERT INTO objects (id) VALUES (?1)", [id])
            .expect("insert object");
    }

    fn term(connection: &Connection, vocab: &str, id: &str) {
        connection
            .execute(
                "INSERT INTO terms (vocab, id, label) VALUES (?1, ?2, ?2)",
                [vocab, id],
            )
            .expect("insert term");
    }

    fn tables(connection: &Connection) -> Vec<String> {
        let mut statement = connection
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .expect("prepare");
        let names = statement
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect");
        names
    }

    // --- migration --------------------------------------------------------

    #[test]
    fn migrating_an_empty_database_creates_the_schema() {
        let connection = db();
        assert_eq!(
            tables(&connection),
            [
                "aliases",
                "edges",
                "history",
                "mounts",
                "object_paths",
                "objects",
                "terms",
                "values_",
            ]
        );
    }

    #[test]
    fn migrating_records_the_version() {
        let connection = db();
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("read version");
        assert_eq!(version, latest_version());
    }

    #[test]
    fn migrating_twice_is_a_no_op() {
        let mut connection = db();
        object(&connection, 1);

        migrate(&mut connection).expect("second migrate");

        let count: i64 = connection
            .query_row("SELECT count(*) FROM objects", [], |row| row.get(0))
            .expect("count");
        assert_eq!(count, 1, "a second migrate must not rebuild the schema");
    }

    #[test]
    fn opening_turns_foreign_keys_on() {
        // Asserting the pragma is on after open() proves nothing on a build
        // whose default is already on, and the bundled one is. Turning it off
        // first is what makes this a test of prepare() rather than of which
        // SQLite happens to be linked.
        let mut connection = Connection::open_in_memory().expect("open");
        connection.pragma_update(None, "foreign_keys", "OFF").expect("disable");
        assert_eq!(read_foreign_keys(&connection), 0, "the probe itself is broken");

        prepare(&connection).expect("prepare");
        migrate(&mut connection).expect("migrate");

        assert_eq!(read_foreign_keys(&connection), 1);
    }

    fn read_foreign_keys(connection: &Connection) -> i64 {
        connection
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .expect("read pragma")
    }

    #[test]
    fn foreign_keys_are_what_stops_a_dangling_edge() {
        // Without the pragma the constraint is inert, and some SQLite builds
        // default it off. Turning it off here proves the tests below are
        // testing the pragma rather than whichever build is linked.
        let connection = db();
        connection
            .pragma_update(None, "foreign_keys", "OFF")
            .expect("disable");
        object(&connection, 1);

        connection
            .execute(
                "INSERT INTO edges (src, kind, dst_vocab, dst_term)
                 VALUES (1, 'supports', 'avatar', 'nobody')",
                [],
            )
            .expect("with foreign keys off, a dangling edge is accepted");
    }

    // --- objects and their locations --------------------------------------

    #[test]
    fn an_object_may_have_no_location() {
        // A grouping: a playlist, a collection, a bare folder of members.
        let connection = db();
        object(&connection, 1);

        let paths: i64 = connection
            .query_row("SELECT count(*) FROM object_paths", [], |row| row.get(0))
            .expect("count");
        assert_eq!(paths, 0);
    }

    #[test]
    fn an_object_may_span_a_folder_and_a_file() {
        // 43 products in the seed library are an extracted folder plus the
        // zip it came from.
        let connection = db();
        object(&connection, 1);

        connection
            .execute(
                "INSERT INTO object_paths (object_id, path, kind)
                 VALUES (1, 'Clothing/AW KLASSIK MAID', 'folder'),
                        (1, 'Clothing/AW KLASSIK MAID.zip', 'file')",
                [],
            )
            .expect("two locations on one object");

        let count: i64 = connection
            .query_row("SELECT count(*) FROM object_paths WHERE object_id=1", [], |row| {
                row.get(0)
            })
            .expect("count");
        assert_eq!(count, 2);
    }

    #[test]
    fn one_path_belongs_to_one_object() {
        // Relaxing this would leave a scan unable to say which object a file
        // it just found belongs to.
        let connection = db();
        object(&connection, 1);
        object(&connection, 2);

        connection
            .execute(
                "INSERT INTO object_paths (object_id, path, kind) VALUES (1, 'shared.png', 'file')",
                [],
            )
            .expect("first claim");

        let second = connection.execute(
            "INSERT INTO object_paths (object_id, path, kind) VALUES (2, 'shared.png', 'file')",
            [],
        );
        assert!(second.is_err(), "a second object claimed the same path");
    }

    #[test]
    fn a_location_kind_is_file_or_folder() {
        let connection = db();
        object(&connection, 1);

        let bad = connection.execute(
            "INSERT INTO object_paths (object_id, path, kind) VALUES (1, 'x', 'group')",
            [],
        );
        assert!(bad.is_err(), "'group' is not a location kind");
    }

    #[test]
    fn a_location_size_must_be_a_number() {
        // STRICT is here so a text size cannot land in the column and make
        // ORDER BY size sort lexicographically.
        let connection = db();
        object(&connection, 1);

        let bad = connection.execute(
            "INSERT INTO object_paths (object_id, path, kind, size)
             VALUES (1, 'x', 'file', 'not a number')",
            [],
        );
        assert!(bad.is_err());
    }

    #[test]
    fn deleting_an_object_takes_its_locations() {
        let connection = db();
        object(&connection, 1);
        connection
            .execute(
                "INSERT INTO object_paths (object_id, path, kind) VALUES (1, 'x', 'file')",
                [],
            )
            .expect("insert path");

        connection.execute("DELETE FROM objects WHERE id=1", []).expect("delete");

        let left: i64 = connection
            .query_row("SELECT count(*) FROM object_paths", [], |row| row.get(0))
            .expect("count");
        assert_eq!(left, 0);
    }

    // --- values -----------------------------------------------------------

    #[test]
    fn one_field_holds_one_value() {
        let connection = db();
        object(&connection, 1);
        connection
            .execute(
                "INSERT INTO values_ (object_id, field_path, value)
                 VALUES (1, 'booth#1/title', 'first')",
                [],
            )
            .expect("insert");

        let second = connection.execute(
            "INSERT INTO values_ (object_id, field_path, value)
             VALUES (1, 'booth#1/title', 'second')",
            [],
        );
        assert!(second.is_err(), "one field path held two values");
    }

    #[test]
    fn the_same_field_on_two_objects_is_fine() {
        let connection = db();
        object(&connection, 1);
        object(&connection, 2);

        connection
            .execute(
                "INSERT INTO values_ (object_id, field_path, value)
                 VALUES (1, 'title', 'a'), (2, 'title', 'b')",
                [],
            )
            .expect("two objects, one field name");
    }

    // --- edges ------------------------------------------------------------

    #[test]
    fn an_edge_points_at_an_object_or_a_term() {
        let connection = db();
        object(&connection, 1);
        object(&connection, 2);
        term(&connection, "avatar", "manuka");

        connection
            .execute(
                "INSERT INTO edges (src, kind, dst_object) VALUES (1, 'contains', 2)",
                [],
            )
            .expect("object target");
        connection
            .execute(
                "INSERT INTO edges (src, kind, dst_vocab, dst_term)
                 VALUES (1, 'supports', 'avatar', 'manuka')",
                [],
            )
            .expect("term target");
    }

    #[test]
    fn an_edge_may_not_point_at_both() {
        let connection = db();
        object(&connection, 1);
        object(&connection, 2);
        term(&connection, "avatar", "manuka");

        let both = connection.execute(
            "INSERT INTO edges (src, kind, dst_object, dst_vocab, dst_term)
             VALUES (1, 'supports', 2, 'avatar', 'manuka')",
            [],
        );
        assert!(both.is_err(), "an edge claimed two targets");
    }

    #[test]
    fn an_edge_may_not_point_at_nothing() {
        let connection = db();
        object(&connection, 1);

        let neither =
            connection.execute("INSERT INTO edges (src, kind) VALUES (1, 'supports')", []);
        assert!(neither.is_err(), "an edge claimed no target");
    }

    #[test]
    fn an_edge_target_must_exist() {
        let connection = db();
        object(&connection, 1);

        let missing = connection.execute(
            "INSERT INTO edges (src, kind, dst_vocab, dst_term)
             VALUES (1, 'supports', 'avatar', 'nobody')",
            [],
        );
        assert!(missing.is_err(), "an edge pointed at a term that does not exist");
    }

    #[test]
    fn an_object_id_may_not_be_a_string() {
        // The reason edges keep object and term targets in separate typed
        // columns rather than one TEXT column.
        let connection = db();
        object(&connection, 1);

        let bad = connection.execute(
            "INSERT INTO edges (src, kind, dst_object) VALUES (1, 'contains', 'two')",
            [],
        );
        assert!(bad.is_err());
    }

    #[test]
    fn edge_kinds_are_not_enumerated() {
        // A plugin adding its own kind needs no schema change.
        let connection = db();
        object(&connection, 1);
        object(&connection, 2);

        for kind in ["contains", "requires", "supersedes", "cites", "remixes"] {
            connection
                .execute(
                    "INSERT INTO edges (src, kind, dst_object) VALUES (1, ?1, 2)",
                    [kind],
                )
                .unwrap_or_else(|e| panic!("{kind} rejected: {e}"));
        }
    }

    #[test]
    fn deleting_a_term_takes_the_edges_pointing_at_it() {
        let connection = db();
        object(&connection, 1);
        term(&connection, "avatar", "manuka");
        connection
            .execute(
                "INSERT INTO edges (src, kind, dst_vocab, dst_term)
                 VALUES (1, 'supports', 'avatar', 'manuka')",
                [],
            )
            .expect("insert edge");

        connection
            .execute("DELETE FROM terms WHERE vocab='avatar' AND id='manuka'", [])
            .expect("delete term");

        let left: i64 = connection
            .query_row("SELECT count(*) FROM edges", [], |row| row.get(0))
            .expect("count");
        assert_eq!(left, 0, "a dangling edge survived its term");
    }

    #[test]
    fn reverse_lookup_uses_an_index() {
        // "What fits Manuka?" has to be one index hit, not a scan over the
        // edge table.
        let connection = db();
        let plan: String = connection
            .query_row(
                "EXPLAIN QUERY PLAN
                 SELECT src FROM edges
                 WHERE dst_vocab='avatar' AND dst_term='manuka' AND kind='supports'",
                [],
                |row| row.get(3),
            )
            .expect("explain");
        assert!(plan.contains("edges_by_term"), "plan was: {plan}");
    }

    // --- vocabularies -----------------------------------------------------

    #[test]
    fn aliases_collapse_to_one_term() {
        let connection = db();
        term(&connection, "avatar", "kikyo");

        connection
            .execute(
                "INSERT INTO aliases (vocab, surface, term) VALUES
                 ('avatar', 'Kikyo', 'kikyo'),
                 ('avatar', 'Kikyou', 'kikyo'),
                 ('avatar', '桔梗', 'kikyo')",
                [],
            )
            .expect("three surface forms");

        let resolved: String = connection
            .query_row(
                "SELECT term FROM aliases WHERE vocab='avatar' AND surface='桔梗'",
                [],
                |row| row.get(0),
            )
            .expect("resolve");
        assert_eq!(resolved, "kikyo");
    }

    #[test]
    fn an_alias_must_name_a_term_that_exists() {
        let connection = db();
        let orphan = connection.execute(
            "INSERT INTO aliases (vocab, surface, term) VALUES ('avatar', 'X', 'nobody')",
            [],
        );
        assert!(orphan.is_err());
    }

    #[test]
    fn two_vocabularies_may_use_the_same_term_id() {
        // Academic authors and shop vendors are separate vocabularies.
        let connection = db();
        term(&connection, "author", "tanaka");
        term(&connection, "vendor", "tanaka");
    }

    // --- mounts -----------------------------------------------------------

    #[test]
    fn a_mount_appears_once_in_the_order() {
        let connection = db();
        connection
            .execute(
                "INSERT INTO mounts (position, namespace, instance) VALUES (0, 'booth', 1)",
                [],
            )
            .expect("first");

        let again = connection.execute(
            "INSERT INTO mounts (position, namespace, instance) VALUES (1, 'booth', 1)",
            [],
        );
        assert!(again.is_err(), "booth#1 was mounted twice");
    }

    #[test]
    fn two_instances_of_one_property_may_both_mount() {
        let connection = db();
        connection
            .execute(
                "INSERT INTO mounts (position, namespace, instance)
                 VALUES (0, 'booth', 1), (1, 'booth', 2)",
                [],
            )
            .expect("two instances");
    }

    // --- transactions -----------------------------------------------------

    #[test]
    fn a_transaction_commits_everything_it_wrote() {
        let mut connection = db();
        let mut values = crate::store::values::Values::new();
        let object = values.create_object(&connection).expect("object");

        in_transaction(&mut connection, |tx| {
            values.set(tx, object, "title", "mine")?;
            values.set(tx, object, "price", "2900")?;
            Ok::<_, crate::store::values::WriteError>(())
        })
        .expect("commit");

        assert_eq!(
            values.get(&connection, object, "title").expect("read"),
            Some("mine".to_string())
        );
        assert_eq!(
            values.get(&connection, object, "price").expect("read"),
            Some("2900".to_string())
        );
    }

    #[test]
    fn a_failure_part_way_leaves_nothing_behind() {
        // A change set is a reviewable batch shaped like a pull request, and a
        // pull request either merges or does not. Applying thirty-one field
        // changes and having the seventeenth fail must not leave the first
        // sixteen in the library.
        use crate::store::values::{Values, WriteError};

        let mut connection = db();
        let mut values = Values::new();
        let object = values.create_object(&connection).expect("object");
        values.set(&connection, object, "title", "old").expect("seed");

        let outcome: Result<(), WriteError> = in_transaction(&mut connection, |tx| {
            values.overwrite(tx, object, "title", "new")?;
            values.set(tx, object, "note", "also written")?;
            // A write against an object that does not exist.
            values.set(tx, 999_999, "price", "100")?;
            Ok(())
        });

        assert!(outcome.is_err(), "the failing write should surface");
        assert_eq!(
            values.get(&connection, object, "title").expect("read"),
            Some("old".to_string()),
            "the overwrite before the failure was not rolled back"
        );
        assert_eq!(
            values.get(&connection, object, "note").expect("read"),
            None,
            "a write before the failure survived"
        );
    }

    #[test]
    fn a_rolled_back_batch_leaves_no_history() {
        // Half a batch in the log reads no differently from a whole one, so a
        // failure must take the history with it.
        use crate::store::values::{Values, WriteError};
        use crate::store::history;

        let mut connection = db();
        let mut values = Values::new();
        let object = values.create_object(&connection).expect("object");
        values.set(&connection, object, "title", "old").expect("seed");

        let batch = history::begin();
        let outcome: Result<(), WriteError> = in_transaction(&mut connection, |tx| {
            values.overwrite(tx, object, "title", "new")?;
            history::record(tx, object, "title", Some("old"), Some("new"), Some(batch))?;
            values.set(tx, 999_999, "price", "100")?;
            Ok(())
        });

        assert!(outcome.is_err());
        assert_eq!(history::len(&connection).expect("count"), 0, "a partial batch survived");
    }

    #[test]
    fn the_caller_error_type_survives_the_round_trip() {
        // A WriteError must not be flattened into a database error on the way
        // out, or the caller cannot tell a conflict from a disk failure.
        use crate::store::values::{Values, WriteError};

        let mut connection = db();
        let mut values = Values::new();
        let object = values.create_object(&connection).expect("object");
        values.set(&connection, object, "title", "mine").expect("seed");

        let outcome: Result<(), WriteError> = in_transaction(&mut connection, |tx| {
            values.set(tx, object, "title", "theirs")?;
            Ok(())
        });

        assert!(
            matches!(outcome, Err(WriteError::Conflict { .. })),
            "expected a conflict, got {outcome:?}"
        );
    }

    #[test]
    fn edges_and_values_roll_back_together() {
        // The layer's writes go through different modules; one transaction has
        // to cover all of them.
        use crate::store::edges::{self, Target};
        use crate::store::values::{Values, WriteError};

        let mut connection = db();
        let mut values = Values::new();
        let object = values.create_object(&connection).expect("object");
        connection
            .execute("INSERT INTO terms (vocab, id, label) VALUES ('avatar', 'manuka', 'Manuka')", [])
            .expect("term");

        let outcome: Result<(), WriteError> = in_transaction(&mut connection, |tx| {
            values.set(tx, object, "title", "outfit")?;
            edges::add(tx, object, "supports", &Target::Term {
                vocab: "avatar".into(),
                id: "manuka".into(),
            })?;
            values.set(tx, 999_999, "price", "100")?;
            Ok(())
        });

        assert!(outcome.is_err());
        assert_eq!(values.get(&connection, object, "title").expect("read"), None);
        assert!(edges::from(&connection, object, None).expect("read").is_empty());
    }

    #[test]
    fn a_transaction_that_returns_a_value_passes_it_out() {
        let mut connection = db();
        let mut values = crate::store::values::Values::new();

        let object = in_transaction(&mut connection, |tx| {
            let id = values.create_object(tx)?;
            values.set(tx, id, "title", "mine")?;
            Ok::<_, crate::store::values::WriteError>(id)
        })
        .expect("commit");

        assert_eq!(
            values.get(&connection, object, "title").expect("read"),
            Some("mine".to_string())
        );
    }

}
