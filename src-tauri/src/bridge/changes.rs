//! Reviewing what was proposed, as a person does it.
//!
//! `import.propose` is how anything outside the application changes the
//! library, and anything that would overwrite a decision waits in a change set.
//! Until this module the set waited where nothing could see it: the core could
//! list, accept and apply one, and no command reached any of that. A review
//! that cannot be held is not a review, it is a place values go to be lost.
//!
//! # Reading is a plugin's business, deciding is not
//!
//! `changes.pending` and `changes.entries` are on the plugin list. A panel
//! saying "a shop fetch proposes a new title for this" is a reasonable thing
//! for a plugin to draw. Accepting and applying are `APP_ONLY`: a plugin that
//! could accept its own proposal would make the review a formality, which is
//! the failure change sets exist to prevent.
//!
//! # The core decides what a review may do
//!
//! Every rule here -- additions start accepted, a decided set stays decided, a
//! field that moved refuses to be overwritten -- lives in `changes::apply`.
//! This module converts shapes and errors and holds the transaction. Putting a
//! second copy of any rule here would be the drift `plugin-host/types` warns
//! about, one layer down.

use crate::bridge::{BridgeError, Library};
use crate::changes::{apply, build, Kind};
use crate::store::{schema, values};

/// One set awaiting review, with enough to list it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ChangeSetView {
    /// A row id. Small, so it crosses as a number; object ids do not because
    /// they are 62-bit.
    pub id: i64,
    /// Where it came from, for the person reading the list.
    pub label: String,
    /// Milliseconds since the Unix epoch.
    pub created: i64,
    pub additions: usize,
    pub modifications: usize,
    /// How many entries are currently accepted, of either kind.
    pub accepted: usize,
}

/// One proposed write, as a review screen draws it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ChangeView {
    pub id: i64,
    #[serde(with = "crate::bridge::views::id_as_string")]
    pub object: i64,
    /// The stored path: `title`, `booth#1/price`.
    pub field: String,
    /// What the field held when the set was built. Absent for an addition.
    pub old: Option<String>,
    /// What is proposed. Absent proposes clearing the field.
    pub new: Option<String>,
    pub reason: Option<String>,
    pub accepted: bool,
    /// `addition` or `modification`.
    pub kind: String,
}

/// What applying a set did.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct AppliedView {
    pub changed: usize,
    pub already_matched: usize,
    pub declined: usize,
}

/// Every set awaiting review, oldest first, with its counts.
///
/// The counts ride along because a list of labels is not enough to choose
/// from: "booth fetch, 3 additions and 1 modification" is a decision, "booth
/// fetch" is a click to find out.
pub fn changes_pending_in(library: &Library) -> Result<Vec<ChangeSetView>, BridgeError> {
    library.with_connection(|connection| {
        let mut views = Vec::new();
        for set in build::pending(connection)? {
            let summary = apply::summary(connection, set.id)?;
            views.push(ChangeSetView {
                id: set.id,
                label: set.label,
                created: set.created,
                additions: summary.additions,
                modifications: summary.modifications,
                accepted: summary.accepted,
            });
        }
        Ok(views)
    })
}

/// Everything one set proposes, in a stable order.
pub fn changes_entries_in(library: &Library, set: i64) -> Result<Vec<ChangeView>, BridgeError> {
    library.with_connection(|connection| {
        if apply::set(connection, set)?.is_none() {
            return Err(BridgeError::NoSuchSet(set));
        }
        Ok(apply::entries(connection, set)?
            .into_iter()
            .map(|change| ChangeView {
                id: change.id,
                object: change.object,
                field: change.field_path.clone(),
                old: change.old.clone(),
                new: change.new.clone(),
                reason: change.reason.clone(),
                accepted: change.accepted,
                kind: match change.kind() {
                    Kind::Addition => "addition",
                    Kind::Modification => "modification",
                }
                .to_string(),
            })
            .collect())
    })
}

/// Accept or decline one entry.
pub fn changes_accept_in(library: &Library, change: i64, accepted: bool) -> Result<(), BridgeError> {
    library.with_connection_mut(|connection| Ok(apply::set_accepted(connection, change, accepted)?))
}

/// Accept every addition and leave every modification as it is.
pub fn changes_accept_additions_in(library: &Library, set: i64) -> Result<usize, BridgeError> {
    library.with_connection_mut(|connection| Ok(apply::accept_additions(connection, set)?))
}

/// Accept or decline everything in a set.
pub fn changes_accept_all_in(library: &Library, set: i64, accepted: bool) -> Result<usize, BridgeError> {
    library.with_connection_mut(|connection| Ok(apply::accept_all(connection, set, accepted)?))
}

/// Write what was accepted.
///
/// One transaction with the history it records, and all or nothing: the core
/// refuses a field that moved since the proposal, and half an applied set with
/// a complete-looking history batch is the state that refusal exists to
/// prevent. The error names the field, so the screen can point at it.
pub fn changes_apply_in(library: &Library, set: i64) -> Result<AppliedView, BridgeError> {
    library.with_connection_mut(|connection| {
        schema::in_transaction(connection, |transaction| {
            let store = values::Values::new();
            let applied = apply::apply(transaction, &store, set)?;
            Ok(AppliedView {
                changed: applied.changed,
                already_matched: applied.already_matched,
                declined: applied.declined,
            })
        })
    })
}

// --- the Tauri surface -------------------------------------------------

/// Every set awaiting review.
#[tauri::command]
pub fn changes_pending(library: tauri::State<'_, Library>) -> Result<Vec<ChangeSetView>, BridgeError> {
    changes_pending_in(&library)
}

/// What one set proposes.
#[tauri::command]
pub fn changes_entries(
    library: tauri::State<'_, Library>,
    set: i64,
) -> Result<Vec<ChangeView>, BridgeError> {
    changes_entries_in(&library, set)
}

/// Accept or decline one entry.
#[tauri::command]
pub fn changes_accept(
    library: tauri::State<'_, Library>,
    change: i64,
    accepted: bool,
) -> Result<(), BridgeError> {
    changes_accept_in(&library, change, accepted)
}

/// Accept every addition.
#[tauri::command]
pub fn changes_accept_additions(
    library: tauri::State<'_, Library>,
    set: i64,
) -> Result<usize, BridgeError> {
    changes_accept_additions_in(&library, set)
}

/// Accept or decline everything.
#[tauri::command]
pub fn changes_accept_all(
    library: tauri::State<'_, Library>,
    set: i64,
    accepted: bool,
) -> Result<usize, BridgeError> {
    changes_accept_all_in(&library, set, accepted)
}

/// Write what was accepted.
#[tauri::command]
pub fn changes_apply(
    library: tauri::State<'_, Library>,
    set: i64,
) -> Result<AppliedView, BridgeError> {
    changes_apply_in(&library, set)
}
