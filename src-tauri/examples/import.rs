//! Import a contract document into a library from the command line.
//!
//! ```text
//! cargo run --example import -- <library-root> <document.json> [label]
//! ```
//!
//! The same path `import.propose` takes: what fits into empty fields is
//! written, and anything that would overwrite a value opens a change set for
//! the review screen. That is what this exists for -- no built-in plugin
//! proposes a conflicting value yet, so without it the review screen could
//! only be exercised by a test. It will also be how the seed library's
//! sources come in, once they are written as a document.
//!
//! Close the application first, or run this while it is idle: both hold the
//! same SQLite file, and a write under an open read fails with "database is
//! locked" rather than corrupting anything.

use std::path::PathBuf;
use std::process::ExitCode;

use yukifile::bridge::commands::import_propose_in;
use yukifile::bridge::Library;
use yukifile::store::schema;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(problem) => {
            eprintln!("{problem}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let (Some(root), Some(document)) = (args.next(), args.next()) else {
        return Err("usage: import <library-root> <document.json> [label]".to_string());
    };
    let label = args.next().unwrap_or_else(|| "command line import".to_string());

    let root = PathBuf::from(root);
    let data = root.join(".yukifile");
    std::fs::create_dir_all(&data).map_err(|error| format!("cannot create {}: {error}", data.display()))?;
    let connection = schema::open(&data.join("library.db"))
        .map_err(|error| format!("cannot open the library: {error}"))?;
    let library = Library::new(&root, connection).map_err(|error| error.to_string())?;

    let json = std::fs::read_to_string(&document)
        .map_err(|error| format!("cannot read {document}: {error}"))?;

    let outcome = import_propose_in(&library, label, json).map_err(|error| error.to_string())?;

    println!(
        "written {}, unchanged {}, objects created {}, terms {}, edges {}",
        outcome.written, outcome.unchanged, outcome.objects_created, outcome.terms, outcome.edges
    );
    match outcome.pending {
        Some(set) => println!("change set {set} is waiting for review"),
        None => println!("nothing needs review"),
    }
    Ok(())
}
