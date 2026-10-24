//! Choosing a cover, as a person does it.
//!
//! The bytes come from one of three places a person can point at -- an image
//! file in the library, an image inside a zip, the preview of an asset inside
//! a package -- and go into `commands::cover::store` without passing through
//! a plugin. The stored path is then written to the object's bare `cover`
//! field through the same path every other edit takes, so the page resolves
//! it as a shared field with sources and history records the choice.
//!
//! `APP_ONLY`: a person chose it. A shop's cover will arrive by proposal once
//! the core can fetch, and will land under the shop's own `booth#1/cover`.

use crate::bridge::objects::object_value_set_in;
use crate::bridge::{BridgeError, Library};
use crate::commands::{archive, cover, unitypackage};
use crate::scan::walk::LIBRARY_DIR;

/// The most bytes read for a cover. A promo PNG is a few megabytes; a 4 GB
/// member is somebody clicking the wrong row.
const LIMIT: u64 = 64 * 1024 * 1024;

/// Where a cover's bytes come from.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(tag = "from", rename_all = "snake_case")]
pub enum CoverSource {
    /// An image file in the library.
    File { path: String },
    /// An image stored in a zip, by the member's stored name.
    Member { path: String, member: String },
    /// The preview of one asset in a package, on disk or inside a zip.
    Preview {
        path: String,
        #[serde(default)]
        member: Option<String>,
        guid: String,
    },
}

/// Store the image and point the object's `cover` at it. Returns the path.
pub fn cover_set_in(library: &Library, id: i64, source: CoverSource) -> Result<String, BridgeError> {
    let bytes = match &source {
        CoverSource::File { path } => {
            let resolved = library.resolve(path)?;
            let size = std::fs::metadata(&resolved).map_err(|e| BridgeError::from_io(e, path))?.len();
            if size > LIMIT {
                return Err(BridgeError::BadRequest(format!("{path:?} is too large to be a cover")));
            }
            std::fs::read(&resolved).map_err(|e| BridgeError::from_io(e, path))?
        }
        CoverSource::Member { path, member } => {
            let resolved = library.resolve(path)?;
            archive::read_member(&resolved, member, LIMIT)
                .map_err(|error| BridgeError::from_archive(error, path))?
        }
        CoverSource::Preview { path, member, guid } => {
            let resolved = library.resolve(path)?;
            let found = match member.as_deref().filter(|m| !m.is_empty()) {
                Some(member) => unitypackage::preview_within(&resolved, member, guid),
                None => {
                    let file = std::fs::File::open(&resolved).map_err(|e| BridgeError::from_io(e, path))?;
                    unitypackage::preview_of(file, guid)
                }
            }
            .map_err(|error| BridgeError::from_unity(error, path))?;
            found.ok_or_else(|| BridgeError::NotFound(format!("{path}: no preview for {guid}")))?
        }
    };

    let data = library.root().join(LIBRARY_DIR);
    let stored = cover::store(&bytes, &data).map_err(|error| match error {
        cover::CoverError::NotAnImage(reason) => BridgeError::BadRequest(format!("not an image: {reason}")),
        cover::CoverError::Unwritable(io) => BridgeError::Storage(io.to_string()),
    })?;

    object_value_set_in(library, id, "cover", &stored)?;
    Ok(stored)
}

/// Store an image and make it the object's cover.
#[tauri::command]
pub async fn cover_set(
    library: tauri::State<'_, Library>,
    id: String,
    source: CoverSource,
) -> Result<String, BridgeError> {
    cover_set_in(&library, crate::bridge::commands::parse_id(&id)?, source)
}
