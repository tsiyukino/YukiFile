//! Heavy work the core does on a plugin's behalf.
//!
//! Scanning, hashing, archive reading and text extraction are Rust because
//! they have to be fast; plugins are TypeScript because they have to be easy
//! to write. These are the seam: a plugin calls a command, the core does the
//! work.
//!
//! Nothing here runs on its own. The core does not read every archive it finds
//! during a scan — a plugin asks, when a plugin has a reason to.

pub mod archive;
pub mod hash;
