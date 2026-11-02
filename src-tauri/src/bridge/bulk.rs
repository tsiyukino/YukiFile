//! Changing many objects at once.
//!
//! A person who just learned what they own wants to sort it: thirty outfits
//! that are all `Clothing`, twelve hair styles that all fit Manuka. Doing that
//! one page at a time is the work the grid's selection exists to save. Each
//! command here applies one change to every chosen object in one transaction
//! -- all of them or none -- and records the value changes as one history
//! batch, so the change can be read back as one thing a person did.
//!
//! All three are the application's own: a plugin proposes through
//! `import.propose`, and a bulk write is a person's decision.

use crate::bridge::objects::{require_object, resolve_target, write_error, TargetAt};
use crate::bridge::{BridgeError, Library};
use crate::plugin::registry::Registry;
use crate::store::flatten::StoredValue;
use crate::store::path::ValuePath;
use crate::store::{edges, history, schema, values};

/// What a bulk change did.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct BulkView {
    /// Objects the change made a difference to.
    pub changed: usize,
    /// Objects that already were as asked.
    pub unchanged: usize,
}

/// Where one object keeps `field`, so writing it changes what it shows.
///
/// A field some plugin shares is written bare: that is the person's own
/// value, and it outranks every source. A field a plugin keeps to itself --
/// the VRChat plugin's `category` -- is written where this object already
/// holds it, or else under the first property of the plugin that names it as
/// a facet, instance one. A field no plugin mentions is written bare.
pub fn path_for(field: &str, rows: &[StoredValue], registry: Option<&Registry>) -> String {
    let Some(registry) = registry else { return field.to_string() };
    let Some(owner) = registry.plugins().iter().find(|plugin| plugin.contributes.facets.iter().any(|f| f == field))
    else {
        return field.to_string();
    };
    if owner.contributes.shared.iter().any(|f| f == field) {
        return field.to_string();
    }
    for row in rows {
        let Ok(path) = ValuePath::parse(&row.path) else { continue };
        if path.field != field {
            continue;
        }
        if let (Some(namespace), Some(_)) = (path.namespace, path.instance) {
            if owner.contributes.properties.iter().any(|p| p == namespace) {
                return row.path.clone();
            }
        }
    }
    match owner.contributes.properties.first() {
        Some(property) => format!("{property}#1/{field}"),
        None => field.to_string(),
    }
}

/// Set one field on every object to one value. An empty value clears it.
pub fn objects_field_set_in(
    library: &Library,
    registry: Option<&Registry>,
    ids: &[i64],
    field: &str,
    value: &str,
) -> Result<BulkView, BridgeError> {
    if field.is_empty() || field.contains(['/', '#', '@']) || field.chars().any(char::is_whitespace) {
        return Err(BridgeError::BadRequest(format!("{field:?} is not a field name")));
    }
    library.with_connection_mut(|connection| {
        schema::in_transaction(connection, |transaction| {
            let store = values::Values::new();
            let batch = history::begin();
            let mut view = BulkView { changed: 0, unchanged: 0 };
            for &id in ids {
                require_object(transaction, id)?;
                let rows = store.rows(transaction, id).map_err(|error| write_error(error, id))?;
                let path = path_for(field, &rows, registry);
                let old = store.get(transaction, id, &path).map_err(|error| write_error(error, id))?;
                let written = store.overwrite(transaction, id, &path, value).map_err(|error| write_error(error, id))?;
                if matches!(written, values::Written::Unchanged) {
                    view.unchanged += 1;
                    continue;
                }
                let new = if value.is_empty() { None } else { Some(value) };
                history::record(transaction, id, &path, old.as_deref(), new, Some(batch))?;
                if let Ok(parsed) = ValuePath::parse(&path) {
                    if let (Some(namespace), Some(instance)) = (parsed.namespace, parsed.instance) {
                        values::mount(transaction, namespace, instance)?;
                    }
                }
                view.changed += 1;
            }
            Ok(view)
        })
    })
}

/// Say one thing about every object: each points at the same target.
pub fn objects_edge_add_in(library: &Library, ids: &[i64], kind: &str, target: TargetAt) -> Result<BulkView, BridgeError> {
    if kind.trim().is_empty() || kind.chars().any(char::is_whitespace) {
        return Err(BridgeError::BadRequest(format!("{kind:?} is not an edge kind")));
    }
    library.with_connection_mut(|connection| {
        schema::in_transaction(connection, |transaction| {
            let target = resolve_target(transaction, &target)?;
            let mut view = BulkView { changed: 0, unchanged: 0 };
            for &id in ids {
                require_object(transaction, id)?;
                let before = edges::from(transaction, id, Some(kind))?.iter().any(|edge| edge.target == target);
                if before {
                    view.unchanged += 1;
                } else {
                    edges::add(transaction, id, kind, &target)?;
                    view.changed += 1;
                }
            }
            Ok(view)
        })
    })
}

/// Unsay it for every object. One that never said it is unchanged.
pub fn objects_edge_remove_in(library: &Library, ids: &[i64], kind: &str, target: TargetAt) -> Result<BulkView, BridgeError> {
    library.with_connection_mut(|connection| {
        schema::in_transaction(connection, |transaction| {
            let target = match target {
                TargetAt::Object { id } => edges::Target::Object(crate::bridge::commands::parse_id(&id)?),
                TargetAt::Term { vocab, term } => edges::Target::Term { vocab, id: term },
            };
            let mut view = BulkView { changed: 0, unchanged: 0 };
            for &id in ids {
                require_object(transaction, id)?;
                let before = edges::from(transaction, id, Some(kind))?.iter().any(|edge| edge.target == target);
                if before {
                    edges::remove(transaction, id, kind, &target)?;
                    view.changed += 1;
                } else {
                    view.unchanged += 1;
                }
            }
            Ok(view)
        })
    })
}

fn parse_ids(ids: &[String]) -> Result<Vec<i64>, BridgeError> {
    ids.iter().map(|id| crate::bridge::commands::parse_id(id)).collect()
}

#[tauri::command]
pub fn objects_field_set(
    library: tauri::State<'_, Library>,
    registry: tauri::State<'_, Registry>,
    ids: Vec<String>,
    field: String,
    value: String,
) -> Result<BulkView, BridgeError> {
    objects_field_set_in(&library, Some(&registry), &parse_ids(&ids)?, &field, &value)
}

#[tauri::command]
pub fn objects_edge_add(
    library: tauri::State<'_, Library>,
    ids: Vec<String>,
    kind: String,
    target: TargetAt,
) -> Result<BulkView, BridgeError> {
    objects_edge_add_in(&library, &parse_ids(&ids)?, &kind, target)
}

#[tauri::command]
pub fn objects_edge_remove(
    library: tauri::State<'_, Library>,
    ids: Vec<String>,
    kind: String,
    target: TargetAt,
) -> Result<BulkView, BridgeError> {
    objects_edge_remove_in(&library, &parse_ids(&ids)?, &kind, target)
}
