//! A library in and out of a file, as a person does it.
//!
//! Both commands take an absolute path. Everything else in the bridge
//! confines paths to the library root, because a plugin names them; these
//! two take the path the operating system's own dialog handed back, which
//! the person chose. That is why they are `APP_ONLY` and why the one door to
//! the runtime, `invoke.ts`, is also where the dialogs live.
//!
//! The seed library came in through `examples/import.rs` from a shell. This
//! is the same path with a button in front of it.

use std::path::Path;

use crate::bridge::commands::{import_propose_in_with, ProposalView};
use crate::bridge::{BridgeError, Library};
use crate::plugin::registry::Registry;

/// What an export wrote.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ExportView {
    pub objects: usize,
    pub terms: usize,
    /// Edges to objects with no path, which the contract cannot name.
    pub edges_left_out: usize,
}

/// Write the library to a file the person chose.
pub fn library_export_file_in(library: &Library, to: &Path) -> Result<ExportView, BridgeError> {
    let exported = library.with_connection(|connection| Ok(crate::export::document(connection)?))?;
    let json = exported.document.to_json().map_err(|error| BridgeError::Storage(error.to_string()))?;
    std::fs::write(to, json).map_err(|error| BridgeError::Unreadable(format!("{}: {error}", to.display())))?;
    Ok(ExportView {
        objects: exported.document.objects.len(),
        terms: exported.document.terms.len(),
        edges_left_out: exported.edges_left_out,
    })
}

/// Import a document from a file the person chose, labelled by its name.
pub fn library_import_file_in(
    library: &Library,
    registry: Option<&Registry>,
    from: &Path,
) -> Result<ProposalView, BridgeError> {
    let text = std::fs::read_to_string(from).map_err(|error| BridgeError::from_io(error, &from.display().to_string()))?;
    let label = from.file_name().and_then(|n| n.to_str()).unwrap_or("a file").to_string();
    import_propose_in_with(library, registry, label, text)
}

#[tauri::command]
pub async fn library_export_file(library: tauri::State<'_, Library>, to: String) -> Result<ExportView, BridgeError> {
    library_export_file_in(&library, Path::new(&to))
}

#[tauri::command]
pub async fn library_import_file(
    library: tauri::State<'_, Library>,
    registry: tauri::State<'_, Registry>,
    from: String,
) -> Result<ProposalView, BridgeError> {
    library_import_file_in(&library, Some(&registry), Path::new(&from))
}
