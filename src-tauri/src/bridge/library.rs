//! The open library a command acts on, and the boundary around it.
//!
//! Commands are stateless functions; the connection and the library root have
//! to live somewhere. That is this.
//!
//! # Confining paths is the bridge's job, not the allowlist's
//!
//! `plugin::commands::ALLOWED` says `archive.list` and `hash.of` only read.
//! What it cannot say is *what* they may read. Plugins are TypeScript and pass
//! strings, so without a check here "read-only" would mean read-only access to
//! the entire disk — every `.ssh/id_rsa` on the machine included, through a
//! command whose stated reason is listing a zip.
//!
//! So every path a plugin names is resolved against the library root and
//! refused if it lands outside. The check is on the *resolved* path rather
//! than the spelling, because `a/../../b` and `..\b` and a symlink into
//! `C:\Windows` all spell differently and mean the same thing.
//!
//! # Symlinks are followed before the check, not after
//!
//! [`std::fs::canonicalize`] resolves symlinks, so a link inside the library
//! pointing at `/etc` is caught by the same comparison. Checking the spelling
//! first and resolving later is the mistake that makes these checks decorative.

use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;

use crate::bridge::error::BridgeError;

/// A library a command can act on.
pub struct Library {
    /// The canonical library root. Every path a plugin names resolves under
    /// this or is refused.
    root: PathBuf,
    connection: Mutex<Connection>,
}

impl Library {
    /// Hold an open library.
    ///
    /// The root is canonicalised once, here, so that the comparison in
    /// [`Self::resolve`] is between two canonical paths. Comparing a canonical
    /// path against a root that still contains `..` or an unresolved symlink
    /// is a check that passes for the wrong reason.
    pub fn new(root: &Path, connection: Connection) -> Result<Self, BridgeError> {
        let root = root
            .canonicalize()
            .map_err(|error| BridgeError::from_io(error, &root.display().to_string()))?;

        Ok(Self { root, connection: Mutex::new(connection) })
    }

    /// The library root.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Run something against the library's connection.
    ///
    /// A poisoned lock means another command panicked mid-query. The
    /// connection may hold a half-finished transaction, so this reports rather
    /// than recovering into it: a plugin seeing an error is better than one
    /// reading from a connection nobody can vouch for.
    pub fn with_connection<T>(
        &self,
        work: impl FnOnce(&Connection) -> Result<T, BridgeError>,
    ) -> Result<T, BridgeError> {
        let guard = self.connection.lock().map_err(|_| {
            BridgeError::Storage("the library connection is in an unknown state".into())
        })?;
        work(&guard)
    }

    /// Run something that needs to open a transaction.
    ///
    /// Separate from [`Self::with_connection`] because `schema::in_transaction`
    /// needs `&mut Connection`, and handing every reader a mutable borrow would
    /// let a read start a transaction by accident.
    pub fn with_connection_mut<T>(
        &self,
        work: impl FnOnce(&mut Connection) -> Result<T, BridgeError>,
    ) -> Result<T, BridgeError> {
        let mut guard = self.connection.lock().map_err(|_| {
            BridgeError::Storage("the library connection is in an unknown state".into())
        })?;
        work(&mut guard)
    }

    /// Turn a path a plugin named into one that is safe to open.
    ///
    /// The argument is relative to the library root. An absolute path is
    /// refused outright rather than being joined, because joining an absolute
    /// path onto a root silently discards the root on every platform this
    /// runs on.
    pub fn resolve(&self, relative: &str) -> Result<PathBuf, BridgeError> {
        if relative.is_empty() {
            return Err(BridgeError::BadRequest("no path given".into()));
        }

        let candidate = Path::new(relative);
        if candidate.is_absolute() || has_prefix(candidate) {
            return Err(BridgeError::OutsideLibrary(relative.to_string()));
        }

        let joined = self.root.join(candidate);

        // Resolve before comparing. A path that does not exist cannot be
        // canonicalised, so it is reported as missing -- which is also what
        // stops this from being a way to test whether a file exists outside
        // the library, since anything outside is refused below either way.
        let resolved = joined
            .canonicalize()
            .map_err(|error| BridgeError::from_io(error, relative))?;

        if !resolved.starts_with(&self.root) {
            return Err(BridgeError::OutsideLibrary(relative.to_string()));
        }

        Ok(resolved)
    }
}

/// Whether a path carries a Windows prefix (`C:`, `\\?\`, a UNC share).
///
/// `C:file` is not absolute by [`Path::is_absolute`] -- it is relative to
/// whatever the current directory on that drive happens to be -- and joining
/// it onto the root discards the root.
///
/// The containment check below would refuse these anyway, once the path has
/// been resolved. Refusing them here instead keeps the answer from depending
/// on whether the file exists: with only the late check, a missing target
/// reports `NotFound` and an existing one reports `OutsideLibrary`, and the
/// difference tells a plugin what sits on the user's other drives.
fn has_prefix(path: &Path) -> bool {
    matches!(path.components().next(), Some(Component::Prefix(_)))
}
