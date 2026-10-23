//! Listing what a Unity package holds, without unpacking it.
//!
//! A package is a gzipped tar. Each asset inside is a directory named by a
//! GUID, holding `pathname` (the asset's path inside the Unity project, as
//! text), `asset` (the bytes), `asset.meta`, and sometimes `preview.png`. A
//! folder asset has a `pathname` and a `.meta` but no `asset`.
//!
//! # Why this is core and not plugin work
//!
//! `2026-09-01_v1-scope-and-build-order.md` deferred this until a consumer
//! could decide on evidence. The evidence: a plugin is handed `file.url` and
//! never the bytes, by design (`2026-09-03_a-viewer-gets-a-url-not-bytes.md`),
//! so a plugin cannot gunzip anything. Reading inside a package is a core
//! capability or it is nothing. `2026-10-23_unitypackage-reading-is-core.md`
//! records the decision.
//!
//! # What this reports and what it does not
//!
//! Paths, sizes, and whether a preview exists. The second segment of a path
//! is almost always the vendor -- `Assets/[meron-farm]/mochi-bob/...` found 93
//! of 174 seed products with no network -- and *that* is a plugin's
//! conclusion to draw. This module does not know what a vendor is, and the
//! boundary test keeps it from knowing what an extension is: nothing here
//! matches on a filename. A caller hands it a path, or a member of a zip, and
//! it reads what is there.
//!
//! # Streamed, not loaded
//!
//! A package inside a zip is read as zip entry, then gzip, then tar, as one
//! chain of readers. The seed library's largest archive is 84 MB and nothing
//! here holds more than one tar entry at a time. The earlier Python read 206
//! packages into memory in two minutes; the point of doing it in Rust is to
//! not do that.

use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

use flate2::read::GzDecoder;

/// One asset inside a package.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Asset {
    /// The directory name inside the tar: Unity's asset GUID.
    pub guid: String,
    /// The asset's path inside the Unity project, with `/` separators.
    pub path: String,
    /// The size of the asset's bytes. Absent for a folder asset.
    pub size: Option<u64>,
    pub has_preview: bool,
}

/// What a package holds.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Package {
    pub assets: Vec<Asset>,
}

impl Package {
    /// Assets that carry bytes, as opposed to folders.
    pub fn files(&self) -> impl Iterator<Item = &Asset> {
        self.assets.iter().filter(|asset| asset.size.is_some())
    }
}

/// Why a package could not be listed.
#[derive(Debug)]
pub enum UnityError {
    /// The file could not be opened.
    Unreadable(io::Error),
    /// The zip holding it could not be read, or has no such member.
    NoSuchMember(String),
    /// The bytes are not a gzipped tar, or are damaged.
    NotAPackage(String),
}

impl std::fmt::Display for UnityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unreadable(error) => write!(f, "cannot open: {error}"),
            Self::NoSuchMember(member) => write!(f, "no member {member:?} in the archive"),
            Self::NotAPackage(reason) => write!(f, "not a readable package: {reason}"),
        }
    }
}

impl std::error::Error for UnityError {}

/// List a package on disk.
pub fn list(path: &Path) -> Result<Package, UnityError> {
    let file = File::open(path).map_err(UnityError::Unreadable)?;
    list_from(file)
}

/// List a package stored inside a zip, by the member's stored name.
///
/// 54 of the seed library's never-unpacked zips hold packages. Reading them
/// here is what took one product from "no avatars detected" to 25.
pub fn list_within(archive: &Path, member: &str) -> Result<Package, UnityError> {
    let file = File::open(archive).map_err(UnityError::Unreadable)?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|error| UnityError::NotAPackage(format!("the archive holding it: {error}")))?;

    // Stored names may use either separator; a caller read ours from
    // `archive.list`, which unified them to `/`.
    let index = (0..zip.len())
        .find(|&index| {
            zip.by_index(index)
                .map(|entry| entry.name().replace('\\', "/") == member)
                .unwrap_or(false)
        })
        .ok_or_else(|| UnityError::NoSuchMember(member.to_string()))?;

    let entry = zip
        .by_index(index)
        .map_err(|error| UnityError::NotAPackage(error.to_string()))?;
    list_from(entry)
}

/// List a package from any reader of its bytes.
pub fn list_from(reader: impl Read) -> Result<Package, UnityError> {
    let mut tar = tar::Archive::new(GzDecoder::new(reader));
    let entries = tar
        .entries()
        .map_err(|error| UnityError::NotAPackage(error.to_string()))?;

    // Assembled per GUID across entries, since `pathname` and `asset` are
    // separate tar entries that may arrive in any order.
    let mut building: std::collections::BTreeMap<String, Building> = Default::default();
    let mut any = false;

    for entry in entries {
        let mut entry = entry.map_err(|error| UnityError::NotAPackage(error.to_string()))?;
        any = true;
        let stored = entry
            .path()
            .map_err(|error| UnityError::NotAPackage(error.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");

        // `./<guid>/pathname` in some writers, `<guid>/pathname` in others.
        let mut parts = stored.trim_start_matches("./").splitn(2, '/');
        let (Some(guid), Some(file)) = (parts.next(), parts.next()) else {
            continue;
        };
        if guid.is_empty() {
            continue;
        }
        let slot = building.entry(guid.to_string()).or_default();

        match file {
            "pathname" => {
                let mut text = String::new();
                entry
                    .read_to_string(&mut text)
                    .map_err(|error| UnityError::NotAPackage(error.to_string()))?;
                // The first line. Some writers add a second line holding
                // "00", which is not part of the path.
                slot.path = Some(text.lines().next().unwrap_or("").trim().to_string());
            }
            "asset" => slot.size = Some(entry.size()),
            "preview.png" => slot.preview = true,
            _ => {}
        }
    }

    if !any {
        return Err(UnityError::NotAPackage("the archive is empty".to_string()));
    }

    let mut assets: Vec<Asset> = building
        .into_iter()
        .filter_map(|(guid, built)| {
            let path = built.path?;
            if path.is_empty() {
                return None;
            }
            Some(Asset { guid, path, size: built.size, has_preview: built.preview })
        })
        .collect();

    assets.sort_by(|left, right| left.path.cmp(&right.path).then(left.guid.cmp(&right.guid)));
    Ok(Package { assets })
}

#[derive(Default)]
struct Building {
    path: Option<String>,
    size: Option<u64>,
    preview: bool,
}

/// Writing a package, for tests.
///
/// Not behind `cfg(test)`: the integration tests in `tests/` are a separate
/// crate and cannot see a test module. A package the same crates wrote is
/// what the reader is checked against, rather than a fixture that only
/// resembles one.
pub mod fixture {
    use flate2::write::GzEncoder;
    use std::io::Write;

    /// A package holding the given assets: (guid, path, bytes or None for a
    /// folder, preview?).
    pub fn package(assets: &[(&str, &str, Option<&[u8]>, bool)]) -> Vec<u8> {
        let mut tar = tar::Builder::new(Vec::new());
        for (guid, path, bytes, preview) in assets {
            append(&mut tar, &format!("{guid}/pathname"), format!("{path}\n00").as_bytes());
            append(&mut tar, &format!("{guid}/asset.meta"), b"guid: x");
            if let Some(bytes) = bytes {
                append(&mut tar, &format!("{guid}/asset"), bytes);
            }
            if *preview {
                append(&mut tar, &format!("{guid}/preview.png"), b"\x89PNG");
            }
        }
        let tar = tar.into_inner().expect("tar");
        let mut gz = GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gz.write_all(&tar).expect("gzip");
        gz.finish().expect("finish")
    }

    pub fn append(tar: &mut tar::Builder<Vec<u8>>, name: &str, bytes: &[u8]) {
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        tar.append_data(&mut header, name, bytes).expect("append");
    }
}

#[cfg(test)]
mod tests {
    use super::fixture::{append, package};
    use super::*;
    use flate2::write::GzEncoder;
    use std::io::Write;

    #[test]
    fn every_asset_comes_back_with_its_unity_path_and_size() {
        let bytes = package(&[
            ("b2", "Assets/[meron-farm]/mochi-bob/body.fbx", Some(b"12345"), true),
            ("a1", "Assets/[meron-farm]/mochi-bob", None, false),
        ]);

        let listed = list_from(&bytes[..]).expect("list");

        assert_eq!(listed.assets.len(), 2);
        // Sorted by path: the folder sorts before what it holds.
        assert_eq!(listed.assets[0].path, "Assets/[meron-farm]/mochi-bob");
        assert_eq!(listed.assets[0].size, None);
        assert_eq!(listed.assets[1].path, "Assets/[meron-farm]/mochi-bob/body.fbx");
        assert_eq!(listed.assets[1].size, Some(5));
        assert!(listed.assets[1].has_preview);
        assert_eq!(listed.files().count(), 1);
    }

    #[test]
    fn the_second_line_of_a_pathname_is_not_part_of_the_path() {
        // Some writers append "00" on a second line. `package` does, so this
        // is what the test above already relied on; said out loud here.
        let bytes = package(&[("g", "Assets/x.png", Some(b"p"), false)]);
        assert_eq!(list_from(&bytes[..]).expect("list").assets[0].path, "Assets/x.png");
    }

    #[test]
    fn an_entry_without_a_pathname_is_not_an_asset() {
        let mut tar = tar::Builder::new(Vec::new());
        append(&mut tar, "g/asset", b"bytes with no name");
        let tar = tar.into_inner().expect("tar");
        let mut gz = GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gz.write_all(&tar).expect("gzip");
        let bytes = gz.finish().expect("finish");

        assert!(list_from(&bytes[..]).expect("list").assets.is_empty());
    }

    #[test]
    fn bytes_that_are_not_a_gzipped_tar_are_refused_in_words() {
        let refused = list_from(&b"PK\x03\x04 this is a zip, not a package"[..]);
        assert!(matches!(refused, Err(UnityError::NotAPackage(_))), "{refused:?}");
    }

    #[test]
    fn a_package_inside_a_zip_is_read_through_the_zip() {
        // zip, then gzip, then tar, as one chain of readers.
        let inner = package(&[("g", "Assets/Hollow/outfit.prefab", Some(b"prefab"), false)]);
        let dir = std::env::temp_dir().join(format!("yukifile-unity-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("dir");
        let archive = dir.join("product.zip");
        {
            let file = File::create(&archive).expect("create");
            let mut writer = zip::ZipWriter::new(file);
            writer
                .start_file("Hollow/outfit.unitypackage", zip::write::SimpleFileOptions::default())
                .expect("entry");
            writer.write_all(&inner).expect("write");
            writer.start_file("readme.txt", zip::write::SimpleFileOptions::default()).expect("entry");
            writer.write_all(b"hi").expect("write");
            writer.finish().expect("finish");
        }

        let listed = list_within(&archive, "Hollow/outfit.unitypackage").expect("list");
        assert_eq!(listed.assets[0].path, "Assets/Hollow/outfit.prefab");

        let missing = list_within(&archive, "Hollow/nothing.unitypackage");
        assert!(matches!(missing, Err(UnityError::NoSuchMember(_))));

        let not_one = list_within(&archive, "readme.txt");
        assert!(matches!(not_one, Err(UnityError::NotAPackage(_))));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
