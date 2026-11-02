//! Choosing which library the window shows.
//!
//! `libraries.rs` at the crate root holds what is remembered and how startup
//! chooses; this is the window's way in. Both commands are the application's
//! own: which library is open is the person's choice, and a plugin that could
//! switch it could point the window at any folder on the machine.

use std::path::{Path, PathBuf};

use crate::bridge::{BridgeError, Library};
use crate::libraries::{self, Remembered};

/// The application's config directory, managed as state so the commands and
/// their tests agree on where the list lives. `None` when the platform gave
/// no home to put it in; the list is then empty and switching refuses.
pub struct ConfigDir(pub Option<PathBuf>);

/// One library the picker offers.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct RecentView {
    pub path: String,
    pub name: String,
    /// Whether the folder is still there. A drive that is not plugged in is
    /// listed greyed rather than dropped: it will be back.
    pub exists: bool,
    pub current: bool,
}

/// The libraries opened before, the open one first.
pub fn library_recent_in(library: &Library, config: Option<&Path>) -> Vec<RecentView> {
    let current = libraries::plain(library.root());
    let remembered = config.map(libraries::read).unwrap_or_default();
    let mut paths = remembered.recent;
    // The open library is always offered, even when nothing was written:
    // a first run, or a config directory that could not be read.
    if !paths.iter().any(|p| p == &current) {
        paths.insert(0, current.clone());
    }
    paths
        .into_iter()
        .map(|path| RecentView {
            name: libraries::name_of(&path),
            exists: Path::new(&path).is_dir(),
            current: path == current,
            path,
        })
        .collect()
}

/// Write down that `path` is to be opened next. The command restarts after.
///
/// The folder has to exist; it does not have to be a library yet. Opening a
/// folder that has never been one makes it one, which is how a new library
/// starts.
pub fn library_switch_in(config: Option<&Path>, path: &str) -> Result<(), BridgeError> {
    let Some(config) = config else {
        return Err(BridgeError::Unreadable("there is nowhere to remember the choice".into()));
    };
    let folder = Path::new(path);
    if !folder.is_dir() {
        return Err(BridgeError::NotFound(path.to_string()));
    }
    let remembered: Remembered = libraries::read(config).switching_to(path);
    libraries::write(config, &remembered).map_err(|error| BridgeError::Unreadable(error.to_string()))
}

/// Take a library off the list. Its folder is not touched.
pub fn library_recent_remove_in(config: Option<&Path>, path: &str) -> Result<(), BridgeError> {
    let Some(config) = config else { return Ok(()) };
    let remembered = libraries::read(config).without(path);
    libraries::write(config, &remembered).map_err(|error| BridgeError::Unreadable(error.to_string()))
}

#[tauri::command]
pub fn library_recent(library: tauri::State<'_, Library>, config: tauri::State<'_, ConfigDir>) -> Vec<RecentView> {
    library_recent_in(&library, config.0.as_deref())
}

#[tauri::command]
pub fn library_recent_remove(config: tauri::State<'_, ConfigDir>, path: String) -> Result<(), BridgeError> {
    library_recent_remove_in(config.0.as_deref(), &path)
}

/// Remember the choice and restart into it.
#[tauri::command]
pub fn library_switch<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    config: tauri::State<'_, ConfigDir>,
    path: String,
) -> Result<(), BridgeError> {
    library_switch_in(config.0.as_deref(), &path)?;
    log::info!("switching to {path}");
    app.restart()
}
