//! Reading and writing objects and the values hung on them.
//!
//! This is the first module that touches the database. It creates objects,
//! normalises paths on the way in, and hands rows to [`flatten`] on the way
//! out.
//!
//! What it does not do is decide policy. Writing into an empty field just
//! happens; overwriting a field that already holds a different value is
//! reported as a conflict rather than applied, and what to do about that — a
//! reviewable change set — belongs to a layer that knows what a change set is.
//! Keeping that decision out of here is what lets the same write path serve an
//! AI import, another machine's export and a shop fetch without knowing which
//! it is serving.
//!
//! [`flatten`]: crate::store::flatten

use rusqlite::{Connection, OptionalExtension, params};

use crate::store::flatten::{FlatView, Mount, StoredValue, flatten};
use crate::store::id::{Clock, Entropy, IdGenerator, SystemClock, SystemEntropy};
use crate::store::path::ValuePath;

/// How many ids to try before giving up.
///
/// A collision needs two objects created in the same millisecond drawing the
/// same 21-bit tail. Three in a row is not something that happens; if it does,
/// the id generator is broken and looping forever would hide that.
const ID_ATTEMPTS: u32 = 3;

/// Why a write did not happen.
#[derive(Debug)]
pub enum WriteError {
    /// The path is not a valid value path.
    BadPath(crate::store::path::ParseError),
    /// The field already holds a different value. The caller decides whether
    /// to overwrite; this layer will not do it silently.
    Conflict { existing: String, incoming: String },
    /// The object does not exist.
    NoSuchObject(i64),
    Database(rusqlite::Error),
}

impl std::fmt::Display for WriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadPath(error) => write!(f, "bad value path: {error}"),
            Self::Conflict { existing, incoming } => {
                write!(f, "field holds {existing:?}, not overwriting with {incoming:?}")
            }
            Self::NoSuchObject(id) => write!(f, "no object {id}"),
            Self::Database(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for WriteError {}

impl From<rusqlite::Error> for WriteError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error)
    }
}

/// What a write did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Written {
    /// The field was empty and now holds the value.
    Added,
    /// The field already held this exact value; nothing changed.
    Unchanged,
    /// An existing value was replaced. Only [`Values::overwrite`] returns this.
    Replaced,
    /// The value was empty, so the field was removed.
    Cleared,
}

/// Objects and their values.
pub struct Values<C = SystemClock, E = SystemEntropy> {
    ids: IdGenerator<C, E>,
}

impl Default for Values<SystemClock, SystemEntropy> {
    fn default() -> Self {
        Self::new()
    }
}

impl Values<SystemClock, SystemEntropy> {
    pub fn new() -> Self {
        Self { ids: IdGenerator::new() }
    }
}

impl<C: Clock, E: Entropy> Values<C, E> {
    /// With an injected clock and entropy, so a test can force an id
    /// collision.
    pub fn with_ids(ids: IdGenerator<C, E>) -> Self {
        Self { ids }
    }

    /// Create an object and return its id.
    ///
    /// Ids carry a random tail, so two objects created in the same millisecond
    /// can draw the same one. The primary key is what catches that, and this
    /// retries rather than looping: a generator that collides three times
    /// running is broken, and hiding that behind an infinite loop turns a bug
    /// into a hang.
    pub fn create_object(&mut self, connection: &Connection) -> Result<i64, WriteError> {
        let mut last = None;

        for _ in 0..ID_ATTEMPTS {
            let id = self.ids.next();
            match connection.execute("INSERT INTO objects (id) VALUES (?1)", params![id]) {
                Ok(_) => return Ok(id),
                Err(error) if is_unique_violation(&error) => last = Some(error),
                Err(error) => return Err(error.into()),
            }
        }
        Err(WriteError::Database(last.expect("a failed attempt records its error")))
    }

    /// Write a value into a field that is empty.
    ///
    /// Returns [`WriteError::Conflict`] when the field already holds something
    /// different. Overwriting is [`Values::overwrite`], and going through a
    /// change set first is the layer above's business.
    ///
    /// An empty value clears the field. A blank is the absence of a value, so
    /// storing one would leave a row that resolution has to skip anyway.
    pub fn set(
        &self,
        connection: &Connection,
        object: i64,
        field_path: &str,
        value: &str,
    ) -> Result<Written, WriteError> {
        let normalised = normalise(field_path)?;
        self.require_object(connection, object)?;

        let existing = self.read_raw(connection, object, &normalised)?;
        match existing {
            Some(existing) if existing == value => Ok(Written::Unchanged),
            Some(existing) => {
                Err(WriteError::Conflict { existing, incoming: value.to_string() })
            }
            None if value.is_empty() => Ok(Written::Cleared),
            None => {
                self.write_raw(connection, object, &normalised, value)?;
                Ok(Written::Added)
            }
        }
    }

    /// Write a value whether or not the field already holds one.
    ///
    /// This is what applying an accepted change set uses. It does not consult
    /// history; recording the change is the caller's to do, inside the
    /// transaction it opened with [`schema::in_transaction`], so that a
    /// failure part-way takes the value and its history record together.
    ///
    /// [`schema::in_transaction`]: crate::store::schema::in_transaction
    pub fn overwrite(
        &self,
        connection: &Connection,
        object: i64,
        field_path: &str,
        value: &str,
    ) -> Result<Written, WriteError> {
        let normalised = normalise(field_path)?;
        self.require_object(connection, object)?;

        let existing = self.read_raw(connection, object, &normalised)?;

        if value.is_empty() {
            connection.execute(
                "DELETE FROM values_ WHERE object_id = ?1 AND field_path = ?2",
                params![object, normalised],
            )?;
            return Ok(if existing.is_some() { Written::Cleared } else { Written::Unchanged });
        }

        match existing {
            Some(existing) if existing == value => Ok(Written::Unchanged),
            existing => {
                self.write_raw(connection, object, &normalised, value)?;
                Ok(if existing.is_some() { Written::Replaced } else { Written::Added })
            }
        }
    }

    /// One stored value, by its exact path. Reading a field as the UI sees it
    /// is [`Values::view`].
    pub fn get(
        &self,
        connection: &Connection,
        object: i64,
        field_path: &str,
    ) -> Result<Option<String>, WriteError> {
        let normalised = normalise(field_path)?;
        self.read_raw(connection, object, &normalised)
    }

    /// Every stored value of one object, unresolved.
    ///
    /// Resolution needs the whole set at once, and it borrows from these
    /// strings, so the rows outlive the view rather than the other way round.
    pub fn rows(
        &self,
        connection: &Connection,
        object: i64,
    ) -> Result<Vec<StoredValue>, WriteError> {
        let mut statement = connection
            .prepare("SELECT field_path, value FROM values_ WHERE object_id = ?1")?;
        let rows = statement
            .query_map(params![object], |row| {
                Ok(StoredValue { path: row.get(0)?, value: row.get(1)? })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    fn require_object(&self, connection: &Connection, object: i64) -> Result<(), WriteError> {
        let exists: Option<i64> = connection
            .query_row("SELECT id FROM objects WHERE id = ?1", params![object], |row| row.get(0))
            .optional()?;
        exists.map(|_| ()).ok_or(WriteError::NoSuchObject(object))
    }

    fn read_raw(
        &self,
        connection: &Connection,
        object: i64,
        field_path: &str,
    ) -> Result<Option<String>, WriteError> {
        let value = connection
            .query_row(
                "SELECT value FROM values_ WHERE object_id = ?1 AND field_path = ?2",
                params![object, field_path],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value)
    }

    fn write_raw(
        &self,
        connection: &Connection,
        object: i64,
        field_path: &str,
        value: &str,
    ) -> Result<(), WriteError> {
        connection.execute(
            "INSERT INTO values_ (object_id, field_path, value) VALUES (?1, ?2, ?3)
             ON CONFLICT (object_id, field_path) DO UPDATE SET value = excluded.value",
            params![object, field_path, value],
        )?;
        Ok(())
    }
}

/// Resolve one object's values into the view the UI reads.
///
/// Free rather than a method because it needs no generator, and the borrow
/// makes the lifetime plain: the view points into `rows` and `mounts`.
pub fn view<'a>(rows: &'a [StoredValue], mounts: &[Mount<'a>]) -> FlatView<'a> {
    flatten(rows, mounts)
}

/// One mounted property instance as the database holds it.
///
/// Owns its namespace, because a `Mount` borrows and the rows it borrows from
/// have to outlive the view built on them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MountRow {
    pub namespace: String,
    pub instance: u32,
    /// Fields the mounting plugin declares as shared. Empty until the plugin
    /// host fills it in from the manifest; a mount sharing nothing keeps every
    /// field to itself, which is the safe reading of "we do not know yet".
    pub shared: Vec<String>,
}

/// This library's mount order, lowest position first.
///
/// The shared list comes back empty: it is declared in each plugin's manifest,
/// which the plugin host owns and which does not exist until layer 4. Layers 2
/// and 3 read values before then, and they get isolation until a manifest says
/// otherwise.
pub fn mount_order(connection: &Connection) -> rusqlite::Result<Vec<MountRow>> {
    let mut statement = connection
        .prepare("SELECT namespace, instance FROM mounts ORDER BY position")?;
    let mounts = statement
        .query_map([], |row| {
            Ok(MountRow { namespace: row.get(0)?, instance: row.get(1)?, shared: Vec::new() })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(mounts)
}

/// Borrow a slice of [`MountRow`] as the [`Mount`] list resolution takes.
///
/// This exists so the conversion has one home. Without it every caller writes
/// its own, and two of them eventually disagree about what an empty `shared`
/// means — which is the drift `flatten` exists to prevent.
pub fn mounts(rows: &[MountRow]) -> Vec<Mount<'_>> {
    rows.iter()
        .map(|row| Mount {
            namespace: &row.namespace,
            instance: row.instance,
            shared: &row.shared,
        })
        .collect()
}

/// Normalise a path so two spellings cannot both name one value.
///
/// `booth/title` and `booth#1/title` are the same field, and the primary key
/// compares strings.
fn normalise(field_path: &str) -> Result<String, WriteError> {
    ValuePath::parse(field_path)
        .map(|path| path.to_string())
        .map_err(WriteError::BadPath)
}

fn is_unique_violation(error: &rusqlite::Error) -> bool {
    matches!(
        error.sqlite_error_code(),
        Some(rusqlite::ErrorCode::ConstraintViolation)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::flatten::Origin;
    use crate::store::schema;

    fn db() -> Connection {
        schema::open_in_memory().expect("open")
    }

    /// A library with one object in it.
    fn library() -> (Connection, Values, i64) {
        let connection = db();
        let mut values = Values::new();
        let object = values.create_object(&connection).expect("create");
        (connection, values, object)
    }

    /// Shared fields as a `'static` slice, so a `Mount` can borrow them
    /// without the caller holding a `Vec` alive.
    fn shared(names: &[&str]) -> &'static [String] {
        Box::leak(names.iter().map(|n| n.to_string()).collect::<Vec<_>>().into_boxed_slice())
    }

    fn shop(namespace: &str, instance: u32) -> Mount<'_> {
        Mount { namespace, instance, shared: shared(&["title", "price"]) }
    }

    // --- objects ----------------------------------------------------------

    #[test]
    fn creating_an_object_returns_a_usable_id() {
        let (connection, _, object) = library();
        let count: i64 = connection
            .query_row("SELECT count(*) FROM objects WHERE id = ?1", params![object], |row| {
                row.get(0)
            })
            .expect("count");
        assert_eq!(count, 1);
    }

    #[test]
    fn objects_get_distinct_ids() {
        let connection = db();
        let mut values = Values::new();
        let first = values.create_object(&connection).expect("first");
        let second = values.create_object(&connection).expect("second");
        assert_ne!(first, second);
    }

    #[test]
    fn a_colliding_id_is_retried() {
        // Entropy that repeats once, then moves on: the first insert takes the
        // id, the second collides, the third attempt succeeds.
        struct Repeating(Vec<u64>, usize);
        impl Entropy for Repeating {
            fn next_bits(&mut self) -> u64 {
                let value = self.0[self.1.min(self.0.len() - 1)];
                self.1 += 1;
                value
            }
        }
        struct Frozen;
        impl Clock for Frozen {
            fn now_millis(&self) -> u64 {
                7
            }
        }

        let connection = db();
        let mut values =
            Values::with_ids(IdGenerator::with(Frozen, Repeating(vec![1, 1, 2], 0)));

        let first = values.create_object(&connection).expect("first");
        let second = values.create_object(&connection).expect("retried past the collision");
        assert_ne!(first, second);
    }

    #[test]
    fn a_generator_that_always_collides_gives_up() {
        // Looping forever would turn a broken generator into a hang.
        struct Constant;
        impl Entropy for Constant {
            fn next_bits(&mut self) -> u64 {
                42
            }
        }
        struct Frozen;
        impl Clock for Frozen {
            fn now_millis(&self) -> u64 {
                7
            }
        }

        let connection = db();
        let mut values = Values::with_ids(IdGenerator::with(Frozen, Constant));

        values.create_object(&connection).expect("the first one works");
        let second = values.create_object(&connection);
        assert!(second.is_err(), "an always-colliding generator must not hang");
    }

    #[test]
    fn writing_to_an_object_that_does_not_exist_is_refused() {
        let connection = db();
        let values = Values::new();
        let result = values.set(&connection, 999, "title", "x");
        assert!(matches!(result, Err(WriteError::NoSuchObject(999))));
    }

    // --- writing ----------------------------------------------------------

    #[test]
    fn writing_into_an_empty_field_just_happens() {
        let (connection, values, object) = library();
        let written = values.set(&connection, object, "title", "BE NATURAL").expect("set");

        assert_eq!(written, Written::Added);
        assert_eq!(
            values.get(&connection, object, "title").expect("get"),
            Some("BE NATURAL".to_string())
        );
    }

    #[test]
    fn overwriting_a_different_value_is_a_conflict_not_a_write() {
        // The write path never silently replaces a decision the user made.
        let (connection, values, object) = library();
        values.set(&connection, object, "title", "mine").expect("first");

        let second = values.set(&connection, object, "title", "theirs");
        assert!(matches!(second, Err(WriteError::Conflict { .. })));

        assert_eq!(
            values.get(&connection, object, "title").expect("get"),
            Some("mine".to_string()),
            "the conflicting write must not have landed"
        );
    }

    #[test]
    fn a_conflict_reports_both_values() {
        // The layer above builds a change set entry out of these.
        let (connection, values, object) = library();
        values.set(&connection, object, "title", "mine").expect("first");

        match values.set(&connection, object, "title", "theirs") {
            Err(WriteError::Conflict { existing, incoming }) => {
                assert_eq!(existing, "mine");
                assert_eq!(incoming, "theirs");
            }
            other => panic!("expected a conflict, got {other:?}"),
        }
    }

    #[test]
    fn writing_the_same_value_again_is_not_a_conflict() {
        // Re-importing an unchanged export must be quiet.
        let (connection, values, object) = library();
        values.set(&connection, object, "title", "mine").expect("first");

        let again = values.set(&connection, object, "title", "mine").expect("idempotent");
        assert_eq!(again, Written::Unchanged);
    }

    #[test]
    fn overwrite_replaces_without_complaint() {
        // What applying an accepted change set uses.
        let (connection, values, object) = library();
        values.set(&connection, object, "title", "mine").expect("first");

        let written = values.overwrite(&connection, object, "title", "theirs").expect("force");
        assert_eq!(written, Written::Replaced);
        assert_eq!(
            values.get(&connection, object, "title").expect("get"),
            Some("theirs".to_string())
        );
    }

    #[test]
    fn overwrite_of_an_empty_field_is_an_addition() {
        let (connection, values, object) = library();
        let written = values.overwrite(&connection, object, "title", "x").expect("force");
        assert_eq!(written, Written::Added);
    }

    // --- clearing ---------------------------------------------------------

    #[test]
    fn writing_a_blank_into_an_empty_field_stores_nothing() {
        // A blank is the absence of a value; storing one leaves a row that
        // resolution has to skip anyway.
        let (connection, values, object) = library();
        let written = values.set(&connection, object, "title", "").expect("blank");

        assert_eq!(written, Written::Cleared);
        assert_eq!(values.rows(&connection, object).expect("rows").len(), 0);
    }

    #[test]
    fn overwriting_with_a_blank_removes_the_field() {
        let (connection, values, object) = library();
        values.set(&connection, object, "title", "mine").expect("first");

        let written = values.overwrite(&connection, object, "title", "").expect("clear");
        assert_eq!(written, Written::Cleared);
        assert_eq!(values.get(&connection, object, "title").expect("get"), None);
    }

    // --- path normalisation -----------------------------------------------

    #[test]
    fn two_spellings_of_one_path_are_the_same_field() {
        // booth/title and booth#1/title name one value, and the primary key
        // compares strings, so normalisation is what stops both existing.
        let (connection, values, object) = library();
        values.set(&connection, object, "booth/title", "shop").expect("write");

        assert_eq!(
            values.get(&connection, object, "booth#1/title").expect("get"),
            Some("shop".to_string()),
            "the other spelling did not find the value"
        );

        let conflict = values.set(&connection, object, "booth#1/title", "other");
        assert!(matches!(conflict, Err(WriteError::Conflict { .. })));
        assert_eq!(values.rows(&connection, object).expect("rows").len(), 1);
    }

    #[test]
    fn a_path_is_stored_in_its_normal_form() {
        let (connection, values, object) = library();
        values.set(&connection, object, "booth/title", "shop").expect("write");

        let stored = values.rows(&connection, object).expect("rows");
        assert_eq!(stored[0].path, "booth#1/title");
    }

    #[test]
    fn a_malformed_path_is_refused() {
        let (connection, values, object) = library();
        let result = values.set(&connection, object, "a/b/c", "x");
        assert!(matches!(result, Err(WriteError::BadPath(_))));
    }

    // --- reading through resolution ---------------------------------------

    #[test]
    fn values_resolve_the_way_the_ui_reads_them() {
        let (connection, values, object) = library();
        values.set(&connection, object, "title", "BE NATURAL (Lapwing)").expect("local");
        values.set(&connection, object, "booth#1/title", "> BE NATURAL <").expect("shop");
        values.set(&connection, object, "booth#1/price", "2900").expect("price");

        let rows = values.rows(&connection, object).expect("rows");
        let resolved = view(&rows, &[shop("booth", 1)]);

        assert_eq!(resolved.value("title"), Some("BE NATURAL (Lapwing)"));
        assert_eq!(resolved.primary("title").expect("primary").origin, Origin::Bare);
        assert_eq!(resolved.sources("title").len(), 2);
        assert_eq!(resolved.value("price"), Some("2900"));
    }

    #[test]
    fn a_pin_written_here_is_honoured_on_read() {
        // The whole chain: a pin is an ordinary value, and resolution finds it.
        let (connection, values, object) = library();
        values.set(&connection, object, "booth#1/cover", "booth.jpg").expect("booth");
        values.set(&connection, object, "gumroad#1/cover", "gumroad.jpg").expect("gumroad");

        let cover = shared(&["cover"]);
        let mounts = [
            Mount { namespace: "booth", instance: 1, shared: cover },
            Mount { namespace: "gumroad", instance: 1, shared: cover },
        ];

        let rows = values.rows(&connection, object).expect("rows");
        assert_eq!(view(&rows, &mounts).value("cover"), Some("booth.jpg"));

        values.set(&connection, object, "@pin/cover", "gumroad#1").expect("pin");
        let rows = values.rows(&connection, object).expect("rows");
        assert_eq!(view(&rows, &mounts).value("cover"), Some("gumroad.jpg"));
    }

    #[test]
    fn deleting_an_object_takes_its_values() {
        let (connection, values, object) = library();
        values.set(&connection, object, "title", "x").expect("write");

        connection
            .execute("DELETE FROM objects WHERE id = ?1", params![object])
            .expect("delete");

        let left: i64 = connection
            .query_row("SELECT count(*) FROM values_", [], |row| row.get(0))
            .expect("count");
        assert_eq!(left, 0);
    }

    // --- mount order ------------------------------------------------------

    #[test]
    fn mount_order_comes_back_in_position_order() {
        let connection = db();
        connection
            .execute(
                "INSERT INTO mounts (position, namespace, instance) VALUES
                 (1, 'gumroad', 1), (0, 'booth', 1), (2, 'booth', 2)",
                [],
            )
            .expect("insert mounts");

        let order = mount_order(&connection).expect("read order");
        let named: Vec<(&str, u32)> =
            order.iter().map(|row| (row.namespace.as_str(), row.instance)).collect();
        assert_eq!(named, [("booth", 1), ("gumroad", 1), ("booth", 2)]);

        // The shared list is empty until a manifest fills it, and empty means
        // isolation rather than "share everything".
        assert!(order.iter().all(|row| row.shared.is_empty()));
        assert!(mounts(&order).iter().all(|mount| mount.shared.is_empty()));
    }

    #[test]
    fn an_empty_library_has_no_mounts() {
        assert!(mount_order(&db()).expect("read order").is_empty());
    }
}
