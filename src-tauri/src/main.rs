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
    let (registry, skipped) = load_plugins()?;

    // What happened before the window existed, reported from inside `setup`.
    //
    // The log plugin attaches its logger in its own setup hook, which runs
    // during `run()` -- so a `log::info!` anywhere above this is written to a
    // logger that does not exist yet and vanishes. Registering the plugin
    // earlier does not help; only logging later does.
    let opened = root.display().to_string();
    let plugins = registry.plugins().len();

    let builder = tauri::Builder::default()
        .plugin(logging())
        .setup(move |_app| {
            log::info!("opened {opened}");
            log::info!("{plugins} plugins loaded");
            for (directory, reason) in &skipped {
                log::warn!("plugin {directory} was not loaded: {reason}");
            }
            Ok(())
        })
        .manage(library)
        .manage(registry);

    register_commands!(builder)
        .run(tauri::generate_context!())
        .map_err(|error| format!("the window could not open: {error}"))
}

/// Where log lines go.
///
/// Three places, because each answers a different question. The terminal is
/// what you watch while working. A file is what you send when something went
/// wrong an hour ago, which is the case this exists for — three of the bugs
/// found on the first real run were diagnosed by guessing from a screenshot.
/// The webview console is where frontend lines were going anyway, and routing
/// them here puts a panel's complaint in the same file as the command it
/// called.
///
/// Info by default. Debug on every command would bury the lines worth reading
/// under the ones that are only interesting when you already know where to
/// look.
fn logging() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_log::Builder::new()
        .level(log::LevelFilter::Info)
        .targets([
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                file_name: Some("yukifile".into()),
            }),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
        ])
        .build()
}

/// Which library to open.
///
/// The first argument, or the working directory. A picker belongs in the UI
/// rather than here: this has to work before a window exists.
fn library_root() -> Result<PathBuf, String> {
    if let Some(given) = std::env::args().nth(1) {
        return Ok(PathBuf::from(given));
    }

    let here =
        std::env::current_dir().map_err(|error| format!("no working directory: {error}"))?;

    // `tauri dev` runs from `src-tauri/`, so the working directory during
    // development is the source tree rather than anything a person wants
    // managed. Scanning it would pull in `target/` and `node_modules/` --
    // several gigabytes of build output -- which would make the first run of
    // the application its worst experience.
    //
    // Opening a scratch library instead of refusing to start: a GUI that
    // exits with a message on stderr has, from where the user is sitting,
    // done nothing at all. A window that opens empty can at least say so.
    if here.join("Cargo.toml").is_file() || here.join("package.json").is_file() {
        let scratch = here.join("target").join("scratch-library");
        std::fs::create_dir_all(&scratch)
            .map_err(|error| format!("cannot create {}: {error}", scratch.display()))?;
        eprintln!(
            "{} is a source tree, so opening {} instead.\n\
             Pass a folder to open a real library: yukifile <path>",
            here.display(),
            scratch.display()
        );
        return Ok(scratch);
    }

    Ok(here)
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
fn load_plugins() -> Result<(Registry, Vec<(String, String)>), String> {
    let found = discover::in_directory(&plugins_dir())
        .map_err(|error| format!("cannot read plugins: {error}"))?;

    // Carried out rather than logged here: no logger exists yet, and a skip
    // written to one that does not exist is a plugin that silently did not
    // load, which is the thing `discover` reports skips to prevent.
    let skipped = found
        .skipped
        .iter()
        .map(|s| (s.directory.clone(), s.reason.clone()))
        .collect();

    let registry = Registry::load(found.manifests).map_err(|error| error.to_string())?;
    Ok((registry, skipped))
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
