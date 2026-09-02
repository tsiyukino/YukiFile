//! The commands themselves.
//!
//! Every function here is one row of [`crate::plugin::commands::ALLOWED`] made
//! callable. They are thin on purpose: parse what the plugin sent, call the
//! core function that already does the work, convert the result into something
//! serialisable. No logic of its own, because the logic is in `store`,
//! `commands` and `changes` already, and a second copy behind an IPC boundary
//! is a copy that drifts where nobody is testing it.
//!
//! # Naming is mechanical
//!
//! `object.get` on the list is `object_get` here. The mapping is a `replace`,
//! not a table somebody maintains, so a command cannot be on the list under
//! one name and implemented under another.
//!
//! # Every path goes through the library
//!
//! Commands never touch a path a plugin sent. They call
//! [`Library::resolve`], which refuses anything landing outside the library
//! root. Without that, `hash.of` — a read-only command whose stated reason is
//! finding duplicates — would hash any file on the machine.

use tauri::State;

use crate::bridge::error::BridgeError;
use crate::bridge::views::{EdgeView, HistoryView, ObjectView, TermView, ValueView};
use crate::bridge::Library;
use crate::changes;
use crate::commands::{archive, hash};
use crate::store::{edges, history, values, vocab};

/// One object's stored values.
#[tauri::command]
pub fn object_get(library: State<'_, Library>, id: i64) -> Result<ObjectView, BridgeError> {
    object_get_in(&library, id)
}

/// One object's stored values.
pub fn object_get_in(library: &Library, id: i64) -> Result<ObjectView, BridgeError> {
    library.with_connection(|connection| {
        let store = values::Values::new();
        let rows = store
            .rows(connection, id)
            .map_err(|error| BridgeError::Storage(error.to_string()))?;

        // An object with no values is not the same as no object. Telling them
        // apart matters to a panel deciding between "nothing here yet" and
        // "this id is wrong".
        if rows.is_empty() && !object_exists(connection, id)? {
            return Err(BridgeError::NoSuchObject(id.to_string()));
        }

        Ok(ObjectView { id, values: rows.iter().map(ValueView::from).collect() })
    })
}

/// Several objects at once, for a column rendering across a page.
///
/// Missing ids are left out rather than failing the call: a grid asking for
/// forty objects while one is being deleted should draw thirty-nine, not
/// nothing.
pub fn object_list_in(
    library: &Library,
    ids: Vec<i64>,
) -> Result<Vec<ObjectView>, BridgeError> {
    library.with_connection(|connection| {
        let store = values::Values::new();
        let mut found = Vec::new();

        for id in ids {
            let rows = store
                .rows(connection, id)
                .map_err(|error| BridgeError::Storage(error.to_string()))?;
            if rows.is_empty() && !object_exists(connection, id)? {
                continue;
            }
            found.push(ObjectView { id, values: rows.iter().map(ValueView::from).collect() });
        }

        Ok(found)
    })
}

/// What an object requires, supports or contains.
pub fn object_edges_in(
    library: &Library,
    id: i64,
) -> Result<Vec<EdgeView>, BridgeError> {
    library.with_connection(|connection| {
        let found = edges::from(connection, id, None)?;
        Ok(found.iter().map(EdgeView::from).collect())
    })
}

/// Map a spelling to a term.
///
/// `桔梗`, `Kikyo` and `Kikyou` are one avatar, and a plugin reading filenames
/// needs the same answer the rest of the library uses.
pub fn term_resolve_in(
    library: &Library,
    vocab: String,
    surface: String,
) -> Result<Option<String>, BridgeError> {
    library.with_connection(|connection| Ok(vocab::resolve(connection, &vocab, &surface)?))
}

/// Everything one vocabulary holds.
pub fn term_list_in(
    library: &Library,
    vocab: String,
) -> Result<Vec<TermView>, BridgeError> {
    library.with_connection(|connection| {
        let found = vocab::terms(connection, &vocab)?;
        Ok(found.iter().map(TermView::from).collect())
    })
}

/// List an archive without unpacking it.
pub fn archive_list_in(
    library: &Library,
    path: String,
) -> Result<Vec<ArchiveMemberView>, BridgeError> {
    let resolved = library.resolve(&path)?;
    let listing =
        archive::list(&resolved).map_err(|error| BridgeError::from_archive(error, &path))?;

    Ok(listing.members.iter().map(ArchiveMemberView::from).collect())
}

/// One entry inside an archive, as a plugin reads it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ArchiveMemberView {
    pub path: String,
    pub size: u64,
    pub compressed_size: u64,
    pub is_dir: bool,
    /// The stored name escapes the archive root. Nothing is extracted here, so
    /// it cannot overwrite anything today; it is reported because the name
    /// still reaches a screen.
    pub escapes_root: bool,
}

impl From<&archive::Member> for ArchiveMemberView {
    fn from(member: &archive::Member) -> Self {
        Self {
            path: member.path.clone(),
            size: member.size,
            compressed_size: member.compressed_size,
            is_dir: member.is_dir,
            escapes_root: member.escapes_root,
        }
    }
}

/// Hash a file or folder with the same function the core uses.
///
/// A plugin finding duplicates has to agree with the scanner about what a
/// duplicate is, which it cannot do by hashing things its own way.
pub fn hash_of_in(
    library: &Library,
        path: String,
) -> Result<String, BridgeError> {
    let resolved = library.resolve(&path)?;
    hash::of_path(&resolved).map_err(|error| BridgeError::from_io(error, &path))
}

/// What changed on an object, and when.
pub fn history_of_in(
    library: &Library,
    id: i64,
) -> Result<Vec<HistoryView>, BridgeError> {
    library.with_connection(|connection| {
        let records = history::of_object(connection, id)?;
        Ok(records.iter().map(HistoryView::from).collect())
    })
}

/// Submit a document.
///
/// The only command that changes anything. What fits into empty fields is
/// written; anything that would overwrite an existing value becomes a change
/// set for a person to review. That split is `changes::build::import`'s, not
/// this function's — a plugin gets the same treatment as an AI import or
/// another machine's export, because they are the same kind of thing.
///
/// The whole import runs in one transaction. Half an import is a library
/// describing something that never existed.
pub fn import_propose_in(
    library: &Library,
    label: String,
    document: String,
) -> Result<ProposalView, BridgeError> {
    let parsed: crate::contract::Document = serde_json::from_str(&document)
        .map_err(|error| BridgeError::BadRequest(format!("cannot read document: {error}")))?;

    library.with_connection_mut(|connection| {
        crate::store::schema::in_transaction(connection, |transaction| {
            let mut store = values::Values::new();
            let outcome = changes::build::import(transaction, &mut store, &parsed, &label)
                .map_err(|error| BridgeError::BadRequest(error.to_string()))?;

            Ok(ProposalView {
                written: outcome.written,
                unchanged: outcome.unchanged,
                objects_created: outcome.objects_created,
                terms: outcome.terms,
                edges: outcome.edges,
                pending: outcome.pending,
            })
        })
    })
}

/// What an import did.
///
/// `pending` is the change set holding whatever could not be written without
/// overwriting a decision. `None` means nothing needs a person.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct ProposalView {
    pub written: usize,
    pub unchanged: usize,
    pub objects_created: usize,
    pub terms: usize,
    pub edges: usize,
    pub pending: Option<i64>,
}

// --- the Tauri surface -------------------------------------------------
//
// Each of these unwraps `State` and calls the function above it. The split
// exists so the work is reachable from a test: a `State` cannot be built
// outside a running Tauri app, and a command that can only run inside one is
// a command whose failure paths are never exercised until a user finds them.

/// Several objects at once, for a column rendering across a page.
#[tauri::command]
pub fn object_list(
    library: State<'_, Library>,
    ids: Vec<i64>,
) -> Result<Vec<ObjectView>, BridgeError> {
    object_list_in(&library, ids)
}

/// What an object requires, supports or contains.
#[tauri::command]
pub fn object_edges(
    library: State<'_, Library>,
    id: i64,
) -> Result<Vec<EdgeView>, BridgeError> {
    object_edges_in(&library, id)
}

/// Map a spelling to a term.
#[tauri::command]
pub fn term_resolve(
    library: State<'_, Library>,
    vocab: String,
    surface: String,
) -> Result<Option<String>, BridgeError> {
    term_resolve_in(&library, vocab, surface)
}

/// Everything one vocabulary holds.
#[tauri::command]
pub fn term_list(
    library: State<'_, Library>,
    vocab: String,
) -> Result<Vec<TermView>, BridgeError> {
    term_list_in(&library, vocab)
}

/// List an archive without unpacking it.
#[tauri::command]
pub fn archive_list(
    library: State<'_, Library>,
    path: String,
) -> Result<Vec<ArchiveMemberView>, BridgeError> {
    archive_list_in(&library, path)
}

/// Hash a file or folder with the same function the core uses.
#[tauri::command]
pub fn hash_of(library: State<'_, Library>, path: String) -> Result<String, BridgeError> {
    hash_of_in(&library, path)
}

/// What changed on an object, and when.
#[tauri::command]
pub fn history_of(
    library: State<'_, Library>,
    id: i64,
) -> Result<Vec<HistoryView>, BridgeError> {
    history_of_in(&library, id)
}

/// Submit a document.
#[tauri::command]
pub fn import_propose(
    library: State<'_, Library>,
    label: String,
    document: String,
) -> Result<ProposalView, BridgeError> {
    import_propose_in(&library, label, document)
}

/// Whether an object row exists at all.
fn object_exists(
    connection: &rusqlite::Connection,
    id: i64,
) -> Result<bool, BridgeError> {
    let count: i64 = connection
        .query_row("SELECT count(*) FROM objects WHERE id = ?1", [id], |row| row.get(0))?;
    Ok(count > 0)
}
