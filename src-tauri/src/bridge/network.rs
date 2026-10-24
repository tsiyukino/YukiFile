//! The application's one reach outside, lent to a press.
//!
//! Both commands are `APP_ONLY`. A plugin never calls them directly; the
//! plugin host hands a plugin an api that carries them only while an action
//! the person pressed is running, and only for the hosts the plugin's
//! manifest named. `2026-10-24_the-network-is-lent-to-a-press.md` is the
//! decision.
//!
//! `cover.fetch` stores a picture from a URL and returns where it was put,
//! without writing any field: a plugin proposes the path under its own
//! property, and the review decides, the same as any other value it would
//! propose.

use crate::bridge::{BridgeError, Library};
use crate::commands::{cover, http};
use crate::scan::walk::LIBRARY_DIR;

/// What a request returned.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ResponseView {
    pub status: u16,
    /// The body as text. Bytes that are not UTF-8 are replaced; a shop's JSON
    /// and HTML are text, and a picture goes through `cover.fetch` instead.
    pub body: String,
}

fn failed(error: http::HttpError) -> BridgeError {
    match error {
        http::HttpError::NotHttps(url) => BridgeError::BadRequest(format!("{url:?} is not an https URL")),
        http::HttpError::TooLarge => BridgeError::BadRequest("the response is too large".to_string()),
        http::HttpError::Failed(reason) => BridgeError::Unreadable(reason),
    }
}

/// GET one https URL, as text.
pub fn http_get_in(url: &str) -> Result<ResponseView, BridgeError> {
    let response = http::get(url).map_err(failed)?;
    Ok(ResponseView { status: response.status, body: String::from_utf8_lossy(&response.body).into_owned() })
}

/// Fetch a picture and store it as a cover. Returns the stored path.
pub fn cover_fetch_in(library: &Library, url: &str) -> Result<String, BridgeError> {
    let response = http::get(url).map_err(failed)?;
    if response.status != 200 {
        return Err(BridgeError::NotFound(format!("{url}: {}", response.status)));
    }
    let data = library.root().join(LIBRARY_DIR);
    cover::store(&response.body, &data).map_err(|error| match error {
        cover::CoverError::NotAnImage(reason) => BridgeError::BadRequest(format!("{url}: not an image: {reason}")),
        cover::CoverError::Unwritable(io) => BridgeError::Storage(io.to_string()),
    })
}

#[tauri::command]
pub async fn http_get(url: String) -> Result<ResponseView, BridgeError> {
    http_get_in(&url)
}

#[tauri::command]
pub async fn cover_fetch(library: tauri::State<'_, Library>, url: String) -> Result<String, BridgeError> {
    cover_fetch_in(&library, &url)
}
