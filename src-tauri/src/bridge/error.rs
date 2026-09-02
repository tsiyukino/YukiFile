//! What a command tells a plugin when it cannot do the thing.
//!
//! Tauri requires a command's error to be `Serialize`. The core's error types
//! are not, and giving them derives would push a serialization concern into
//! `store` and `commands`, which have no business knowing they are ever spoken
//! to over an IPC boundary. The bridge collapses them here instead, so the
//! dependency points one way: the bridge knows the core, the core does not
//! know the bridge.
//!
//! # A plugin is not the user
//!
//! The message a plugin receives says what went wrong in terms it can act on —
//! the path was outside the library, the file is not an archive. It does not
//! carry the underlying `io::Error` text, which names absolute paths on the
//! user's disk. A plugin has no business learning where the library sits, and
//! a message that leaks it ends up in a plugin's error reporting.

use std::fmt;

use serde::Serialize;

use crate::commands::archive::ArchiveError;

/// Why a command failed.
///
/// One flat enum rather than a nesting of the core's error types: a plugin
/// author reads this to decide what to do next, and "the file is not an
/// archive" is that decision. Which layer noticed is not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "snake_case")]
pub enum BridgeError {
    /// The path pointed outside the library.
    ///
    /// Plugins are TypeScript and pass strings, so this is the check that
    /// keeps a read-only command from reading the whole disk. It is a refusal,
    /// not a missing file: saying "not found" would invite a plugin to retry
    /// with a different escape.
    OutsideLibrary(String),
    /// Nothing is at that path.
    NotFound(String),
    /// The path is there but could not be read.
    Unreadable(String),
    /// The file is not a readable archive.
    NotAnArchive(String),
    /// No object in this library has that id.
    NoSuchObject(String),
    /// The library could not be read.
    Storage(String),
    /// A value the plugin passed does not make sense.
    BadRequest(String),
}

impl fmt::Display for BridgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::OutsideLibrary(path) => {
                write!(f, "{path:?} is outside the library")
            }
            Self::NotFound(path) => write!(f, "nothing at {path:?}"),
            Self::Unreadable(path) => write!(f, "cannot read {path:?}"),
            Self::NotAnArchive(reason) => write!(f, "not a readable archive: {reason}"),
            Self::NoSuchObject(id) => write!(f, "no object {id:?} in this library"),
            Self::Storage(detail) => write!(f, "the library could not be read: {detail}"),
            Self::BadRequest(detail) => write!(f, "{detail}"),
        }
    }
}

impl std::error::Error for BridgeError {}

impl From<rusqlite::Error> for BridgeError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(error.to_string())
    }
}

impl BridgeError {
    /// An archive failure, told without the absolute path the core error
    /// carries.
    pub fn from_archive(error: ArchiveError, shown: &str) -> Self {
        match error {
            ArchiveError::Unreadable(io) if io.kind() == std::io::ErrorKind::NotFound => {
                Self::NotFound(shown.to_string())
            }
            ArchiveError::Unreadable(_) => Self::Unreadable(shown.to_string()),
            ArchiveError::NotAnArchive(reason) => Self::NotAnArchive(reason),
        }
    }

    /// An I/O failure against a path the plugin named.
    pub fn from_io(error: std::io::Error, shown: &str) -> Self {
        match error.kind() {
            std::io::ErrorKind::NotFound => Self::NotFound(shown.to_string()),
            _ => Self::Unreadable(shown.to_string()),
        }
    }
}
