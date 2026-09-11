//! Making and unmaking objects, as a person does it.
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
use crate::store::{carried, paths, schema, values};

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
