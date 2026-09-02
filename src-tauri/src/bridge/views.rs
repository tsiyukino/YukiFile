//! What a command sends back.
//!
//! The store's types do not derive `Serialize`, deliberately: `store::Edge`
//! and `store::history::Record` describe rows in a database, and giving them
//! serde derives would make the shape a plugin sees the same object as the
//! shape the schema holds. The two have different reasons to change — a column
//! added for an index is not a change to what plugins are told — and welding
//! them together means every schema edit is a plugin-facing edit.
//!
//! So the bridge converts. It is more typing and one fewer coupling.

use serde::Serialize;

use crate::store::edges::{Edge, Target};
use crate::store::flatten::StoredValue;
use crate::store::history::Record;
use crate::store::vocab::Term;

/// One object's values, as a plugin reads them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ObjectView {
    pub id: i64,
    /// Field path to value, exactly as stored. Flattening is a separate
    /// question with its own mount order, and a panel rendering its own
    /// property's region wants the namespaced paths rather than the winners.
    pub values: Vec<ValueView>,
}

/// One stored value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ValueView {
    pub path: String,
    pub value: String,
}

impl From<&StoredValue> for ValueView {
    fn from(stored: &StoredValue) -> Self {
        Self { path: stored.path.clone(), value: stored.value.clone() }
    }
}

/// One edge leaving an object.
///
/// The target is flattened into a tagged shape rather than mirroring the
/// store's `Target` enum, because a plugin switching on `kind` in TypeScript
/// reads a discriminant field more naturally than a Rust-shaped variant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "target", rename_all = "snake_case")]
pub enum TargetView {
    Object { id: i64 },
    Term { vocab: String, term: String },
}

/// One edge, as a plugin reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EdgeView {
    pub kind: String,
    #[serde(flatten)]
    pub target: TargetView,
}

impl From<&Edge> for EdgeView {
    fn from(edge: &Edge) -> Self {
        let target = match &edge.target {
            Target::Object(id) => TargetView::Object { id: *id },
            Target::Term { vocab, id } => {
                TargetView::Term { vocab: vocab.clone(), term: id.clone() }
            }
        };
        Self { kind: edge.kind.clone(), target }
    }
}

/// One vocabulary term.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TermView {
    pub vocab: String,
    pub id: String,
    pub label: String,
}

impl From<&Term> for TermView {
    fn from(term: &Term) -> Self {
        Self { vocab: term.vocab.clone(), id: term.id.clone(), label: term.label.clone() }
    }
}

/// One history entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HistoryView {
    pub field: String,
    pub old: Option<String>,
    pub new: Option<String>,
    /// Milliseconds since the Unix epoch.
    pub at: i64,
}

impl From<&Record> for HistoryView {
    fn from(record: &Record) -> Self {
        Self {
            field: record.field_path.clone(),
            old: record.old.clone(),
            new: record.new.clone(),
            at: record.at,
        }
    }
}
