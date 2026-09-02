//! The application.
//!
//! Everything of substance is in the library crate; this opens a library,
//! loads whatever plugins are installed, and hands both to Tauri as state.
//!
//! # Startup is where the two failure modes are told apart
//!
//! A plugin directory that will not parse is skipped and reported. A set of
//! plugins that do not satisfy each other refuses to load at all. `discover`
//! and `Registry::load` draw that line; this only has to respect it, and
//! respecting it means an unsatisfied dependency stops startup while a
//! leftover folder does not.

// The console window on Windows release builds is noise for a GUI app; a
// debug build keeps it, because that is where a panic message has to go.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::ExitCode;

use yukifile::bridge::Library;
use yukifile::plugin::{discover, registry::Registry};
use yukifile::register_commands;
use yukifile::store::schema;

fn main() -> ExitCode {
    match start() {
        Ok(()) => ExitCode::SUCCESS,
        Err(problem) => {
            eprintln!("yukifile could not start: {problem}");
            ExitCode::FAILURE
        }
    }
}

fn start() -> Result<(), String> {
    let root = library_root()?;
    let library = open_library(&root)?;
    let registry = load_plugins()?;

    let builder = tauri::Builder::default().manage(library).manage(registry);

    register_commands!(builder)
        .run(tauri::generate_context!())
        .map_err(|error| format!("the window could not open: {error}"))
}

/// Which library to open.
///
/// The first argument, or the working directory. A picker belongs in the UI
/// rather than here: this has to work before a window exists.
fn library_root() -> Result<PathBuf, String> {
    if let Some(given) = std::env::args().nth(1) {
        return Ok(PathBuf::from(given));
    }
    std::env::current_dir().map_err(|error| format!("no working directory: {error}"))
}

/// Open the library's database, creating it if this is the first run.
///
/// Data lives in `.yukifile/` at the library root, so the whole library is
/// self-contained and can be copied to another machine.
fn open_library(root: &std::path::Path) -> Result<Library, String> {
    let data = root.join(".yukifile");
    std::fs::create_dir_all(&data)
        .map_err(|error| format!("cannot create {}: {error}", data.display()))?;

    let connection = schema::open(&data.join("library.db"))
        .map_err(|error| format!("cannot open the library: {error}"))?;

    Library::new(root, connection).map_err(|error| error.to_string())
}

/// Read `plugins/` and resolve what it holds.
///
/// A directory that will not parse is reported and skipped; the rest load.
/// An unsatisfied dependency refuses the whole set, because a partly loaded
/// set is a library where some objects have panels and others do not for
/// reasons nobody can see.
fn load_plugins() -> Result<Registry, String> {
    let found = discover::in_directory(&plugins_dir())
        .map_err(|error| format!("cannot read plugins: {error}"))?;

    for skipped in &found.skipped {
        eprintln!("plugin {} was not loaded: {}", skipped.directory, skipped.reason);
    }

    Registry::load(found.manifests).map_err(|error| error.to_string())
}

/// Where the built-in plugins live, relative to the executable.
///
/// Alongside the binary in a bundle; two levels up from `target/debug` when
/// run from the source tree. Falling back to the repository layout keeps
/// `cargo run` working without a build step that copies plugins around.
fn plugins_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let beside = dir.join("plugins");
            if beside.is_dir() {
                return beside;
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("plugins")
}
