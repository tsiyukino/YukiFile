//! Storing a cover: an image chosen for an object, kept as a file.
//!
//! `architecture.md`: thumbnails are files on disk with paths in the
//! database, never blobs, and they never enter history -- replacing a cover
//! replaces the file. This module writes the file; the value that points at
//! it is an ordinary field, `cover`, and the page resolves it like any other
//! shared field with sources.
//!
//! # Scaled once, on the way in
//!
//! A promo image inside a package is often a 4000-pixel PNG of several
//! megabytes, and a grid of 174 of them would be 174 of those. The stored
//! cover fits in 512 pixels, which is what a grid and a page need, and the
//! original stays where it was. Written as PNG so transparency survives; the
//! name is the content hash of the scaled bytes, so choosing the same image
//! twice stores it once.
//!
//! # Where the bytes come from is not this module's business
//!
//! A file in the library, a member of a zip, a preview inside a package: the
//! bridge gets the bytes and hands them here. That keeps the decoding and
//! scaling in one place, and keeps this module from knowing what a zip is.

use std::io;
use std::path::{Path, PathBuf};

/// The folder covers live in, under the library's own data directory.
pub const COVERS: &str = "covers";

/// The longest side a stored cover may have.
pub const SIDE: u32 = 512;

/// Why bytes could not become a cover.
#[derive(Debug)]
pub enum CoverError {
    /// The bytes are not an image this build can decode.
    NotAnImage(String),
    /// The file could not be written.
    Unwritable(io::Error),
}

impl std::fmt::Display for CoverError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotAnImage(reason) => write!(f, "not an image: {reason}"),
            Self::Unwritable(error) => write!(f, "cannot write the cover: {error}"),
        }
    }
}

impl std::error::Error for CoverError {}

/// Decode, scale and store. Returns the path relative to `data`.
///
/// `data` is the library's `.yukifile` directory. The returned path is what
/// the `cover` field holds, spelled from the library root so `file.url` can
/// serve it: `.yukifile/covers/<hash>.png`.
pub fn store(bytes: &[u8], data: &Path) -> Result<String, CoverError> {
    let decoded = image::load_from_memory(bytes)
        .map_err(|error| CoverError::NotAnImage(error.to_string()))?;
    let scaled = if decoded.width() > SIDE || decoded.height() > SIDE {
        decoded.thumbnail(SIDE, SIDE)
    } else {
        decoded
    };

    let mut encoded = Vec::new();
    scaled
        .write_to(&mut io::Cursor::new(&mut encoded), image::ImageFormat::Png)
        .map_err(|error| CoverError::NotAnImage(error.to_string()))?;

    let name = format!("{}.png", blake3::hash(&encoded).to_hex());
    let folder = data.join(COVERS);
    std::fs::create_dir_all(&folder).map_err(CoverError::Unwritable)?;
    let target = folder.join(&name);
    if !target.exists() {
        std::fs::write(&target, &encoded).map_err(CoverError::Unwritable)?;
    }

    let data_name = data.file_name().and_then(|n| n.to_str()).unwrap_or(".yukifile");
    Ok(format!("{data_name}/{COVERS}/{name}"))
}

/// Where a stored cover sits on disk, from the path the field holds.
pub fn location(root: &Path, held: &str) -> PathBuf {
    root.join(held)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A PNG of the given size, generated rather than fixtured.
    fn png(width: u32, height: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(width, height, image::Rgba([200, 30, 30, 255]));
        let mut out = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut io::Cursor::new(&mut out), image::ImageFormat::Png)
            .expect("encode");
        out
    }

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("yukifile-cover-{}-{}", std::process::id(), rand_suffix()));
        std::fs::create_dir_all(&dir).expect("dir");
        dir.join(".yukifile")
    }

    fn rand_suffix() -> u64 {
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        N.fetch_add(1, Ordering::Relaxed)
    }

    #[test]
    fn a_large_image_is_scaled_to_fit_and_a_small_one_is_kept() {
        let data = scratch();

        let big = store(&png(2000, 1000), &data).expect("store");
        let stored = image::open(data.parent().unwrap().join(&big)).expect("open");
        assert_eq!((stored.width(), stored.height()), (512, 256));

        let small = store(&png(100, 60), &data).expect("store");
        let stored = image::open(data.parent().unwrap().join(&small)).expect("open");
        assert_eq!((stored.width(), stored.height()), (100, 60));
    }

    #[test]
    fn the_path_is_from_the_library_root_and_names_the_content() {
        let data = scratch();

        let first = store(&png(10, 10), &data).expect("store");
        let again = store(&png(10, 10), &data).expect("store");

        assert!(first.starts_with(".yukifile/covers/"), "{first}");
        assert!(first.ends_with(".png"));
        assert_eq!(first, again, "the same image stored twice is one file");
        assert_eq!(std::fs::read_dir(data.join(COVERS)).unwrap().count(), 1);
    }

    #[test]
    fn bytes_that_are_not_an_image_are_refused() {
        let data = scratch();
        assert!(matches!(store(b"PK\x03\x04 a zip", &data), Err(CoverError::NotAnImage(_))));
    }
}
