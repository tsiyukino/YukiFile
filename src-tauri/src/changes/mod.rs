//! Change sets: batches of proposed writes, reviewed before they apply.
//!
//! Writing a value into an empty field just happens. Overwriting a field that
//! already holds something different produces a proposal instead — a batch
//! shaped like a pull request, which a person accepts or discards entry by
//! entry.
//!
//! # Source-agnostic on purpose
//!
//! A set from an AI import, from another machine's export, and from a shop
//! fetch are the same kind of thing. There is no per-field provenance beyond a
//! label for the person reading the list, because the question at review time
//! is "do I want this value" and not "who suggested it".
//!
//! # Additions and modifications default differently
//!
//! An addition fills a blank and loses nothing, so it starts accepted. A
//! modification overwrites something a person chose, so it starts unaccepted.
//! The most useful bulk action follows from that split — accept every addition
//! and leave every modification — which fills in what is missing without
//! touching a single decision already made.

pub mod apply;
pub mod build;

use crate::store::values::WriteError;

/// What a proposal would do to a field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// The field is empty. Lossless, so accepted by default.
    Addition,
    /// The field holds something else. Accepted only if a person says so.
    Modification,
}

/// One proposed write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    pub id: i64,
    pub object: i64,
    pub field_path: String,
    /// What the field held when the set was built. `None` for an addition.
    pub old: Option<String>,
    /// What is proposed. `None` proposes clearing the field.
    pub new: Option<String>,
    pub reason: Option<String>,
    pub accepted: bool,
}

impl Change {
    pub fn kind(&self) -> Kind {
        if self.old.is_none() { Kind::Addition } else { Kind::Modification }
    }
}

/// A batch of proposals.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangeSet {
    pub id: i64,
    /// Where it came from, for a person reading the list. Nothing branches on
    /// it.
    pub label: String,
    pub created: i64,
    /// When it was applied, if it has been.
    pub applied: Option<i64>,
}

impl ChangeSet {
    pub fn is_pending(&self) -> bool {
        self.applied.is_none()
    }
}

/// Why a change set operation failed.
#[derive(Debug)]
pub enum ChangeError {
    /// The set does not exist.
    NoSuchSet(i64),
    /// The set has already been applied. Applying twice would write values
    /// against an `old` that is two versions stale.
    AlreadyApplied(i64),
    /// A field moved under the proposal: what it holds now is not what it
    /// held when the set was built. Applying anyway would overwrite whatever
    /// happened in between without anyone seeing it.
    Stale { object: i64, field_path: String, expected: Option<String>, found: Option<String> },
    Write(WriteError),
    Database(rusqlite::Error),
}

impl std::fmt::Display for ChangeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoSuchSet(id) => write!(f, "no change set {id}"),
            Self::AlreadyApplied(id) => write!(f, "change set {id} was already applied"),
            Self::Stale { object, field_path, expected, found } => write!(
                f,
                "{field_path} on object {object} was {found:?}, not the {expected:?} \
                 this change was built against"
            ),
            Self::Write(error) => write!(f, "{error}"),
            Self::Database(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for ChangeError {}

impl From<rusqlite::Error> for ChangeError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error)
    }
}

impl From<WriteError> for ChangeError {
    fn from(error: WriteError) -> Self {
        Self::Write(error)
    }
}
