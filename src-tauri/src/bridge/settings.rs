//! What a library has decided about itself, and what it runs.
//!
//! Three things a person changes from a settings page, and one a plugin
//! reads. Settings are strings in the library's own table; a plugin's
//! setting -- how deep its groupings go -- lives beside the data it shapes,
//! and a plugin reads its own keys. Which plugins the library runs is the
//! `plugins.json` file `plugin::enabled` reads at startup; writing it here
//! takes effect at the next open, because a registry is loaded once and the
//! panels on screen were arbitrated against it. Mount order is the
//! library-wide rule every page follows, reordered as a whole.
//!
//! `setting.get` is the one plugin-callable command. `setting.set` is not: a
//! plugin that could write settings could change what another plugin's scan
//! does, which is the reach the allowlist exists to refuse.

use std::path::{Path, PathBuf};

use crate::bridge::{BridgeError, Library};
use crate::plugin::{discover, enabled, registry::Registry};
use crate::scan::walk::LIBRARY_DIR;
use crate::store::{settings, values};

/// Where the installed plugins live. Managed by the binary, since only it
/// knows where it was run from.
pub struct PluginsDir(pub PathBuf);

/// One setting.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct SettingView {
    pub key: String,
    pub value: String,
}

/// One installed plugin, and whether this library runs it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PluginView {
    pub id: String,
    pub directory: String,
    /// Named in the library's list, or the list is absent and everything runs.
    pub enabled: bool,
    /// Loaded in this session. Differs from `enabled` until the next open.
    pub running: bool,
}

/// The library, as a settings page describes it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct LibraryView {
    /// The root, as the operating system spells it.
    pub root: String,
    pub plugins: Vec<PluginView>,
    /// Whether the library has chosen; `false` means everything installed runs.
    pub chosen: bool,
    /// Plugin directories that would not parse, with why.
    pub skipped: Vec<(String, String)>,
}

pub fn setting_get_in(library: &Library, key: &str) -> Result<Option<String>, BridgeError> {
    library.with_connection(|connection| Ok(settings::get(connection, key)?))
}

pub fn setting_all_in(library: &Library) -> Result<Vec<SettingView>, BridgeError> {
    library.with_connection(|connection| {
        Ok(settings::all(connection)?
            .into_iter()
            .map(|(key, value)| SettingView { key, value })
            .collect())
    })
}

/// Set a setting. An empty value clears it. A key with whitespace or no
/// characters is not a key.
pub fn setting_set_in(library: &Library, key: &str, value: &str) -> Result<(), BridgeError> {
    if key.is_empty() || key.chars().any(char::is_whitespace) {
        return Err(BridgeError::BadRequest(format!("{key:?} is not a setting key")));
    }
    library.with_connection_mut(|connection| Ok(settings::set(connection, key, value)?))
}

/// The library and its plugins, installed against enabled against running.
pub fn library_info_in(
    library: &Library,
    registry: Option<&Registry>,
    plugins_dir: &Path,
) -> Result<LibraryView, BridgeError> {
    let found = discover::in_directory(plugins_dir)
        .map_err(|error| BridgeError::Storage(format!("cannot read plugins: {error}")))?;
    let chosen = enabled::read(&library.root().join(LIBRARY_DIR));
    let running: std::collections::BTreeSet<&str> = registry
        .map(|r| r.plugins().iter().map(|m| m.id.as_str()).collect())
        .unwrap_or_default();

    let plugins = found
        .manifests
        .iter()
        .map(|manifest| PluginView {
            id: manifest.id.clone(),
            directory: manifest.directory.clone(),
            enabled: chosen.ids.as_ref().is_none_or(|ids| ids.contains(&manifest.id)),
            running: running.contains(manifest.id.as_str()),
        })
        .collect();

    Ok(LibraryView {
        root: library.root().display().to_string(),
        plugins,
        chosen: chosen.ids.is_some(),
        skipped: found.skipped.iter().map(|s| (s.directory.clone(), s.reason.clone())).collect(),
    })
}

/// Write which plugins the library runs. `None` means everything installed,
/// and removes the list rather than writing an empty one -- an empty list
/// would be a library that runs nothing, which is a different choice.
pub fn plugins_enable_in(library: &Library, ids: Option<Vec<String>>) -> Result<(), BridgeError> {
    let data = library.root().join(LIBRARY_DIR);
    let path = data.join(enabled::LIST);
    match ids {
        None => match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(BridgeError::Storage(error.to_string())),
        },
        Some(ids) => {
            std::fs::create_dir_all(&data).map_err(|error| BridgeError::Storage(error.to_string()))?;
            let text = serde_json::to_string_pretty(&ids).map_err(|error| BridgeError::Storage(error.to_string()))?;
            std::fs::write(&path, text).map_err(|error| BridgeError::Storage(error.to_string()))
        }
    }
}

/// One mount, as a new order names it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct MountAt {
    pub namespace: String,
    pub instance: u32,
}

/// Put the mounts in a new order. Every mount has to be named.
pub fn mount_order_set_in(library: &Library, order: Vec<MountAt>) -> Result<(), BridgeError> {
    let pairs: Vec<(String, u32)> = order.into_iter().map(|m| (m.namespace, m.instance)).collect();
    library.with_connection_mut(|connection| {
        values::reorder_mounts(connection, &pairs).map_err(|error| match error {
            values::ReorderError::Database(error) => BridgeError::Storage(error.to_string()),
            other => BridgeError::BadRequest(other.to_string()),
        })
    })
}

// --- the Tauri surface -------------------------------------------------

#[tauri::command]
pub fn setting_get(library: tauri::State<'_, Library>, key: String) -> Result<Option<String>, BridgeError> {
    setting_get_in(&library, &key)
}

#[tauri::command]
pub fn setting_all(library: tauri::State<'_, Library>) -> Result<Vec<SettingView>, BridgeError> {
    setting_all_in(&library)
}

#[tauri::command]
pub fn setting_set(library: tauri::State<'_, Library>, key: String, value: String) -> Result<(), BridgeError> {
    setting_set_in(&library, &key, &value)
}

#[tauri::command]
pub fn library_info(
    library: tauri::State<'_, Library>,
    registry: tauri::State<'_, Registry>,
    plugins: tauri::State<'_, PluginsDir>,
) -> Result<LibraryView, BridgeError> {
    library_info_in(&library, Some(&registry), &plugins.0)
}

#[tauri::command]
pub fn plugins_enable(library: tauri::State<'_, Library>, ids: Option<Vec<String>>) -> Result<(), BridgeError> {
    plugins_enable_in(&library, ids)
}

#[tauri::command]
pub fn mount_order_set(library: tauri::State<'_, Library>, order: Vec<MountAt>) -> Result<(), BridgeError> {
    mount_order_set_in(&library, order)
}
