//! Making, unmaking and changing objects, as a person does it.
//!
//! The read commands in `commands.rs` answer questions; these change the
//! library on somebody's say-so. They are separate because the two have
//! different obligations: a read is a read, and a write has to be atomic,
//! recorded, and refusable.
//!
//! # Not on the plugin surface
//!
//! These are `APP_ONLY`. A plugin proposing objects goes through
//! `import.propose`, where what it proposes is reviewed and anything that would
//! overwrite a decision waits for a person. Handing a plugin a direct write
//! would route around the review that exists for exactly that reason.
//!
//! # What an object is comes from the person
//!
//! `properties` is a list, not one value: an object is what its properties say
//! it is, and a PDF can be a paper and a VRChat asset at once. The core attaches
//! what it is given and knows none of the names -- `paper` reaches here as a
//! string it never interprets.
//!
//! Locations are a list for the same reason, and may be empty: an object with no
//! location is a grouping, which is a normal thing to make.

use std::collections::BTreeMap;

use crate::bridge::{BridgeError, Library};
use crate::scan::walk::Kind;
use crate::store::edges::{self, Target};
use crate::store::path::{self, ValuePath};
use crate::store::{carried, history, paths, schema, values, vocab};

/// One place an object sits, as the caller names it.
///
/// The path has to exist. `Library::resolve` canonicalises, which is what
/// confines it, and a path that is not there cannot be canonicalised -- so
/// adding one comes back as `NotFound`. That is the right rule here even though
/// the import contract takes the opposite one: an import may describe a library
/// somebody is about to copy in, while a person adding a folder is looking at
/// it.
///
/// `kind` still comes from the caller rather than from looking. The disk browser
/// already walked and knows, and asking twice would let the two answers differ.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct PathAt {
    pub path: String,
    /// `"file"` or `"folder"`.
    pub kind: String,
}

/// What a new object is made of.
///
/// Values arrive nested by property so the core writes the namespaced path
/// itself. A flat map would put the spelling of `paper#1/doi` in the caller's
/// hands, and a form returning a bare `doi` would land in the shared field
/// space -- which is what property namespaces exist to prevent.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Deserialize)]
pub struct NewObject {
    #[serde(default)]
    pub paths: Vec<PathAt>,
    /// Semantic properties the person chose.
    #[serde(default)]
    pub properties: Vec<String>,
    /// Field values, keyed by the property that owns them.
    #[serde(default)]
    pub values: BTreeMap<String, BTreeMap<String, String>>,
    /// Fields belonging to no property: `title`, `note`.
    #[serde(default)]
    pub shared: BTreeMap<String, String>,
}

/// Make an object, or refuse and change nothing.
///
/// One transaction. A half-made object -- properties attached, values missing --
/// is worse than no object, because nothing in the library says which half ran.
///
/// Returns the id as a string. Ids are 62-bit and JavaScript's integers are
/// 53-bit, so an id crossing as a number comes back rounded and the next lookup
/// says "no such object" with nothing pointing at the rounding.
pub fn object_create_in(library: &Library, new: NewObject) -> Result<String, BridgeError> {
    for property in &new.properties {
        if new.properties.iter().filter(|other| *other == property).count() > 1 {
            return Err(BridgeError::BadRequest(format!(
                "{property:?} was chosen twice"
            )));
        }
    }

    library.with_connection_mut(|connection| {
        schema::in_transaction(connection, |transaction| {
            let mut store = values::Values::new();
            let id = store
                .create_object(transaction)
                .map_err(|error| BridgeError::Storage(error.to_string()))?;

            for at in &new.paths {
                // The kind first: a caller who spelled it wrong should hear
                // that, not that the path is missing.
                let kind = kind_of(&at.kind)?;
                // Confined the same way every other path is. A person typing a
                // path is no more trusted than a plugin passing one.
                library.resolve(&at.path)?;
                paths::record(transaction, id, &at.path, kind, None, None, None)
                    .map_err(|error| taken_or_storage(error, &at.path))?;
            }

            for property in &new.properties {
                carried::attach(transaction, id, property, 1)
                    .map_err(|error| BridgeError::BadRequest(error.to_string()))?;
                // Nothing draws a region for a property the library does not
                // mount, so choosing one has to mount it.
                values::mount(transaction, property, 1)
                    .map_err(|error| BridgeError::Storage(error.to_string()))?;

            }

            for (property, fields) in &new.values {
                if !new.properties.contains(property) {
                    return Err(BridgeError::BadRequest(format!(
                        "values for {property:?}, which this object was not given"
                    )));
                }
                for (field, value) in fields {
                    store
                        .set(transaction, id, &format!("{property}#1/{field}"), value)
                        .map_err(|error| BridgeError::BadRequest(error.to_string()))?;
                }
            }

            for (field, value) in &new.shared {
                store
                    .set(transaction, id, field, value)
                    .map_err(|error| BridgeError::BadRequest(error.to_string()))?;
            }

            Ok(id.to_string())
        })
    })
}

/// Remove an object and everything hung on it.
///
/// The counterpart to making one. Without it a mis-click is permanent, and a
/// library where every mistake is permanent is one nobody will risk organising.
///
/// The files on disk are untouched. This library manages what it knows about
/// things, not the things.
pub fn object_forget_in(library: &Library, id: i64) -> Result<(), BridgeError> {
    library.with_connection_mut(|connection| {
        let existed = values::forget_object(connection, id)
            .map_err(|error| BridgeError::Storage(error.to_string()))?;

        if !existed {
            return Err(BridgeError::NoSuchObject(id.to_string()));
        }
        Ok(())
    })
}

// --- changing an object ------------------------------------------------
//
// Creating writes empty fields and records no history, because there is no
// old value to record. Editing is the other case: a person replacing a value
// is a decision, and `architecture.md` says history is written by whoever is
// making one. So `object_value_set_in` is the first writer of history outside
// `changes::apply`, and the only one that does it for a single field.
//
// Properties, edges and locations record no history. History is kept at field
// level, and none of those is a field; the architecture gives a scan the same
// reading for locations.

/// What setting a value did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WrittenView {
    Added,
    Replaced,
    Cleared,
    Unchanged,
}

/// Write one field on an existing object, whatever it held.
///
/// The person is the review here, so this overwrites where an import would
/// have proposed. An empty value clears the field, which is what the store
/// means by empty too.
///
/// A bare path (`title`) writes the bare field, which outranks every source:
/// that is what a person's own value means, and clearing it hands the field
/// back to mount order. A namespaced path (`paper#1/doi`) mounts its property
/// if the library has not, for the reason `object_create_in` gives -- nothing
/// draws a region for an unmounted property, and a value nobody can see is a
/// value lost.
///
/// `@import` is refused: it is the core's bookkeeping, and a person editing an
/// import key would make the next import of the same document create a
/// duplicate. `@pin` is allowed -- a pin is a person's choice by definition.
pub fn object_value_set_in(
    library: &Library,
    id: i64,
    field: &str,
    value: &str,
) -> Result<WrittenView, BridgeError> {
    let parsed = ValuePath::parse(field)
        .map_err(|error| BridgeError::BadRequest(format!("{field:?}: {error}")))?;
    if parsed.namespace == Some(path::IMPORT) {
        return Err(BridgeError::BadRequest(format!(
            "{field:?} is the core's own bookkeeping"
        )));
    }

    library.with_connection_mut(|connection| {
        schema::in_transaction(connection, |transaction| {
            let store = values::Values::new();
            let old = store
                .get(transaction, id, field)
                .map_err(|error| write_error(error, id))?;

            let written = store
                .overwrite(transaction, id, field, value)
                .map_err(|error| write_error(error, id))?;

            use values::Written;
            let view = match written {
                Written::Unchanged => return Ok(WrittenView::Unchanged),
                Written::Added => WrittenView::Added,
                Written::Replaced => WrittenView::Replaced,
                Written::Cleared => WrittenView::Cleared,
            };

            let new = if value.is_empty() { None } else { Some(value) };
            history::record(transaction, id, field, old.as_deref(), new, None)?;

            if let (Some(namespace), Some(instance)) = (parsed.namespace, parsed.instance) {
                values::mount(transaction, namespace, instance)?;
            }

            Ok(view)
        })
    })
}

/// Say an object is something, after it was made.
///
/// Instance 1, as the picker chooses. Mounted for the same reason creation
/// mounts. Attaching what is already attached is not an error.
pub fn object_property_add_in(library: &Library, id: i64, property: &str) -> Result<(), BridgeError> {
    library.with_connection_mut(|connection| {
        schema::in_transaction(connection, |transaction| {
            require_object(transaction, id)?;
            carried::attach(transaction, id, property, 1)
                .map_err(|error| BridgeError::BadRequest(error.to_string()))?;
            values::mount(transaction, property, 1)?;
            Ok(())
        })
    })
}

/// Unsay it.
///
/// Values under the property stay, so undoing a mis-click does not destroy
/// what was typed before it; they read back the moment the property returns.
/// That is `store::carried`'s rule and `2026-09-11` says why.
pub fn object_property_remove_in(library: &Library, id: i64, property: &str) -> Result<(), BridgeError> {
    library.with_connection_mut(|connection| {
        require_object(connection, id)?;
        carried::detach(connection, id, property, 1)?;
        Ok(())
    })
}

/// An edge's target, as a person names it.
///
/// The same tagged shape `views::TargetView` sends out, so a panel that read
/// an edge can hand it back unchanged.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(tag = "target", rename_all = "snake_case")]
pub enum TargetAt {
    Object { id: String },
    Term { vocab: String, term: String },
}

/// Say what an object fits, requires, contains.
///
/// A term target has to exist. The edge table's foreign key would refuse it
/// anyway, as "the database is broken"; saying which term is missing is what
/// lets the person add it instead. An object target has to exist for the
/// same reason.
pub fn object_edge_add_in(
    library: &Library,
    id: i64,
    kind: &str,
    target: TargetAt,
) -> Result<(), BridgeError> {
    if kind.trim().is_empty() || kind.chars().any(char::is_whitespace) {
        return Err(BridgeError::BadRequest(format!("{kind:?} is not an edge kind")));
    }

    library.with_connection_mut(|connection| {
        require_object(connection, id)?;
        let target = resolve_target(connection, &target)?;
        edges::add(connection, id, kind, &target)?;
        Ok(())
    })
}

/// Unsay it. Removing an edge that is not there is not an error.
pub fn object_edge_remove_in(
    library: &Library,
    id: i64,
    kind: &str,
    target: TargetAt,
) -> Result<(), BridgeError> {
    library.with_connection_mut(|connection| {
        require_object(connection, id)?;
        let target = match target {
            TargetAt::Object { id } => Target::Object(crate::bridge::commands::parse_id(&id)?),
            TargetAt::Term { vocab, term } => Target::Term { vocab, id: term },
        };
        edges::remove(connection, id, kind, &target)?;
        Ok(())
    })
}

/// Give an object another place it sits.
///
/// The seed library has 43 products that exist as a folder and the zip it was
/// unpacked from. One thing, two places. The path has to be there and has to
/// be nobody else's, by the same rules creation applies.
pub fn object_path_add_in(library: &Library, id: i64, at: PathAt) -> Result<(), BridgeError> {
    let kind = kind_of(&at.kind)?;
    library.resolve(&at.path)?;

    library.with_connection_mut(|connection| {
        require_object(connection, id)?;
        paths::record(connection, id, &at.path, kind, None, None, None)
            .map_err(|error| taken_or_storage(error, &at.path))?;
        Ok(())
    })
}

/// Take a place away.
///
/// Only from the object that holds it: a path is one object's, and taking it
/// from another would be a silent edit to an object nobody was looking at.
/// An object left with no location is a grouping, which is a normal thing to
/// be.
pub fn object_path_remove_in(library: &Library, id: i64, path: &str) -> Result<(), BridgeError> {
    library.with_connection_mut(|connection| {
        require_object(connection, id)?;
        match paths::object_at(connection, path)? {
            Some(holder) if holder == id => {
                paths::forget(connection, path)?;
                Ok(())
            }
            Some(holder) => Err(BridgeError::BadRequest(format!(
                "{path:?} belongs to object {holder}, not {id}"
            ))),
            None => Err(BridgeError::NotFound(path.to_string())),
        }
    })
}

/// A target that exists, or a refusal naming what does not.
fn resolve_target(connection: &rusqlite::Connection, target: &TargetAt) -> Result<Target, BridgeError> {
    match target {
        TargetAt::Object { id } => {
            let dst = crate::bridge::commands::parse_id(id)?;
            require_object(connection, dst)?;
            Ok(Target::Object(dst))
        }
        TargetAt::Term { vocab, term } => {
            if vocab::term(connection, vocab, term)?.is_none() {
                return Err(BridgeError::BadRequest(format!(
                    "no term {term:?} in the {vocab:?} vocabulary"
                )));
            }
            Ok(Target::Term { vocab: vocab.clone(), id: term.clone() })
        }
    }
}

/// `NoSuchObject` for an id with no row, so every edit says the same thing
/// about a missing object rather than each failing in its own way.
fn require_object(connection: &rusqlite::Connection, id: i64) -> Result<(), BridgeError> {
    let found: Option<i64> = connection
        .query_row("SELECT id FROM objects WHERE id = ?1", [id], |row| row.get(0))
        .ok();
    found.map(|_| ()).ok_or_else(|| BridgeError::NoSuchObject(id.to_string()))
}

/// A write error in the bridge's terms.
fn write_error(error: values::WriteError, id: i64) -> BridgeError {
    match error {
        values::WriteError::NoSuchObject(_) => BridgeError::NoSuchObject(id.to_string()),
        values::WriteError::BadPath(error) => BridgeError::BadRequest(error.to_string()),
        values::WriteError::Conflict { .. } => {
            BridgeError::Storage("overwrite reported a conflict".to_string())
        }
        values::WriteError::Database(error) => BridgeError::Storage(error.to_string()),
    }
}

/// The kind a caller named, or a refusal.
fn kind_of(named: &str) -> Result<Kind, BridgeError> {
    match named {
        "file" => Ok(Kind::File),
        "folder" => Ok(Kind::Folder),
        other => Err(BridgeError::BadRequest(format!(
            "{other:?} is not a kind of location"
        ))),
    }
}

/// Turn a unique-constraint failure into something the caller can act on.
///
/// `object_paths.path` is globally unique, so a path another object holds comes
/// back as `UNIQUE constraint failed`. Passing that through would tell somebody
/// adding a folder that the database is broken.
fn taken_or_storage(error: rusqlite::Error, path: &str) -> BridgeError {
    // The extended code rather than the message. SQLITE_CONSTRAINT_UNIQUE is
    // 2067 and is not going to change; the wording after it is SQLite's to
    // reword, and matching on it would fail silently the day it does -- turning
    // "another object is already there" into "the database is broken".
    //
    // `ConstraintViolation` alone would be too wide: every constraint on the
    // table answers to it, so a CHECK added later would report as a path
    // collision.
    if let rusqlite::Error::SqliteFailure(failure, _) = &error {
        if failure.extended_code == UNIQUE_VIOLATION {
            return BridgeError::PathTaken(path.to_string());
        }
    }
    BridgeError::Storage(error.to_string())
}

/// `SQLITE_CONSTRAINT_UNIQUE`. The only unique constraint this function's
/// caller can trip is `object_paths.path`.
const UNIQUE_VIOLATION: i32 = 2067;

/// Make an object on somebody's say-so.
#[tauri::command]
pub fn object_create(
    library: tauri::State<'_, Library>,
    object: NewObject,
) -> Result<String, BridgeError> {
    object_create_in(&library, object)
}

/// Remove an object and everything hung on it.
#[tauri::command]
pub fn object_forget(
    library: tauri::State<'_, Library>,
    id: String,
) -> Result<(), BridgeError> {
    object_forget_in(&library, crate::bridge::commands::parse_id(&id)?)
}

/// Write one field, whatever it held.
#[tauri::command]
pub fn object_value_set(
    library: tauri::State<'_, Library>,
    id: String,
    field: String,
    value: String,
) -> Result<WrittenView, BridgeError> {
    object_value_set_in(&library, crate::bridge::commands::parse_id(&id)?, &field, &value)
}

/// Say an object is something.
#[tauri::command]
pub fn object_property_add(
    library: tauri::State<'_, Library>,
    id: String,
    property: String,
) -> Result<(), BridgeError> {
    object_property_add_in(&library, crate::bridge::commands::parse_id(&id)?, &property)
}

/// Unsay it.
#[tauri::command]
pub fn object_property_remove(
    library: tauri::State<'_, Library>,
    id: String,
    property: String,
) -> Result<(), BridgeError> {
    object_property_remove_in(&library, crate::bridge::commands::parse_id(&id)?, &property)
}

/// Point an object at something.
#[tauri::command]
pub fn object_edge_add(
    library: tauri::State<'_, Library>,
    id: String,
    kind: String,
    target: TargetAt,
) -> Result<(), BridgeError> {
    object_edge_add_in(&library, crate::bridge::commands::parse_id(&id)?, &kind, target)
}

/// Stop pointing.
#[tauri::command]
pub fn object_edge_remove(
    library: tauri::State<'_, Library>,
    id: String,
    kind: String,
    target: TargetAt,
) -> Result<(), BridgeError> {
    object_edge_remove_in(&library, crate::bridge::commands::parse_id(&id)?, &kind, target)
}

/// Give an object another place.
#[tauri::command]
pub fn object_path_add(
    library: tauri::State<'_, Library>,
    id: String,
    at: PathAt,
) -> Result<(), BridgeError> {
    object_path_add_in(&library, crate::bridge::commands::parse_id(&id)?, at)
}

/// Take a place away.
#[tauri::command]
pub fn object_path_remove(
    library: tauri::State<'_, Library>,
    id: String,
    path: String,
) -> Result<(), BridgeError> {
    object_path_remove_in(&library, crate::bridge::commands::parse_id(&id)?, &path)
}
