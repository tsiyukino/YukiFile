//! Listing what an archive holds, without unpacking it.
//!
//! Reading an archive is a command a plugin calls, not a step in a scan. The
//! core has no reason to open every zip it walks past, and doing so would put
//! the cost of a 35 GB library's archives into a scan that only needed to know
//! the files exist.
//!
//! Listing is not extracting. A zip's central directory holds every entry's
//! name and size, so answering "what is in here" costs a seek and a few
//! kilobytes rather than the gigabyte the archive weighs. That difference is
//! what makes a third of the seed library visible: 103 archives were never
//! unpacked, 54 of them holding unitypackages, and a scanner that only sees
//! loose files is blind to all of it.
//!
//! What an archive's contents *mean* is not decided here. A plugin reading
//! this list may conclude things about it; this module reports names and
//! sizes.

use std::fs::File;
use std::io;
use std::path::Path;

/// One entry inside an archive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    /// The name as the archive stores it, with `/` separators.
    pub path: String,
    /// Uncompressed size. Zero for a directory entry.
    pub size: u64,
    pub compressed_size: u64,
    pub is_dir: bool,
    /// True when the stored name escapes the archive root — `../` segments,
    /// an absolute path, or a Windows drive letter.
    ///
    /// Nothing is extracted here, so this cannot overwrite a file today. It is
    /// reported because the name still reaches a database and a screen, and a
    /// caller that later grows an extract command needs the flag to already be
    /// in the data rather than discovering it needs one.
    pub escapes_root: bool,
}

/// What an archive holds.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Listing {
    pub members: Vec<Member>,
}

impl Listing {
    /// Total uncompressed size of everything inside.
    pub fn unpacked_size(&self) -> u64 {
        self.members.iter().map(|member| member.size).sum()
    }

    /// Members whose stored name escapes the archive root.
    pub fn escaping(&self) -> impl Iterator<Item = &Member> {
        self.members.iter().filter(|member| member.escapes_root)
    }

    /// Files only, without the directory entries some writers include.
    pub fn files(&self) -> impl Iterator<Item = &Member> {
        self.members.iter().filter(|member| !member.is_dir)
    }
}

/// Why an archive could not be listed.
#[derive(Debug)]
pub enum ArchiveError {
    /// The file could not be opened.
    Unreadable(io::Error),
    /// The file is not a zip, or is damaged.
    ///
    /// The seed library has one RAR that could not be opened at all. That is
    /// a fact to record about the object, not a scan failure.
    NotAnArchive(String),
}

impl std::fmt::Display for ArchiveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unreadable(error) => write!(f, "cannot open: {error}"),
            Self::NotAnArchive(reason) => write!(f, "not a readable archive: {reason}"),
        }
    }
}

impl std::error::Error for ArchiveError {}

/// List an archive's contents without unpacking it.
pub fn list(path: &Path) -> Result<Listing, ArchiveError> {
    let file = File::open(path).map_err(ArchiveError::Unreadable)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| ArchiveError::NotAnArchive(error.to_string()))?;

    let mut members = Vec::with_capacity(archive.len());

    for index in 0..archive.len() {
        // A damaged entry in the middle does not lose the ones around it: a
        // partly readable archive still tells the user more than nothing.
        let Ok(entry) = archive.by_index(index) else {
            continue;
        };
        let stored = entry.name().to_string();

        members.push(Member {
            escapes_root: escapes_root(&stored),
            path: normalise(&stored),
            size: entry.size(),
            compressed_size: entry.compressed_size(),
            is_dir: entry.is_dir(),
        });
    }

    members.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(Listing { members })
}

/// Whether a stored name would land outside the archive root if extracted.
///
/// Three shapes: a `..` segment, a leading `/`, and a Windows drive letter.
/// The check runs on the stored name before normalisation, since normalising
/// first would be the bug.
fn escapes_root(stored: &str) -> bool {
    let unified = stored.replace('\\', "/");

    unified.starts_with('/')
        || unified.split('/').any(|segment| segment == "..")
        || unified.chars().nth(1) == Some(':')
}

/// The stored name with `\` separators unified to `/`.
///
/// Zip requires `/`, but writers on Windows have produced `\` for decades, and
/// a name that mixes them reads as one long segment otherwise.
fn normalise(stored: &str) -> String {
    stored.replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;

    /// A file that deletes itself.
    struct TempFile(PathBuf);

    impl TempFile {
        fn new(label: &str) -> Self {
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            Self(std::env::temp_dir().join(format!("yukifile-{label}-{unique}.zip")))
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    /// Build a zip holding the given entries.
    fn zip_with(label: &str, entries: &[(&str, &[u8])]) -> TempFile {
        let file = TempFile::new(label);
        let handle = File::create(file.path()).expect("create");
        let mut writer = zip::ZipWriter::new(handle);
        let options: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();

        for (name, contents) in entries {
            writer.start_file(*name, options).expect("start entry");
            writer.write_all(contents).expect("write entry");
        }
        writer.finish().expect("finish");
        file
    }

    fn names(listing: &Listing) -> Vec<&str> {
        listing.members.iter().map(|member| member.path.as_str()).collect()
    }

    // --- listing ----------------------------------------------------------

    #[test]
    fn an_archive_lists_what_it_holds() {
        let file = zip_with("basic", &[("readme.txt", b"hello"), ("body.fbx", b"mesh data")]);
        let listing = list(file.path()).expect("list");

        assert_eq!(names(&listing), ["body.fbx", "readme.txt"]);
    }

    #[test]
    fn a_member_reports_its_unpacked_size() {
        let file = zip_with("sizes", &[("a.txt", b"12345")]);
        let listing = list(file.path()).expect("list");

        assert_eq!(listing.members[0].size, 5);
        assert_eq!(listing.unpacked_size(), 5);
    }

    #[test]
    fn listing_does_not_unpack() {
        // The whole reason this is cheap. A listing of a large archive costs
        // the central directory, not the payload.
        let big = vec![b'x'; 2_000_000];
        let file = zip_with("large", &[("payload.bin", &big)]);

        let listing = list(file.path()).expect("list");
        assert_eq!(listing.unpacked_size(), 2_000_000);

        // Nothing was written next to the archive.
        let beside = file.path().with_extension("");
        assert!(!beside.exists(), "listing left something behind");
    }

    #[test]
    fn an_empty_archive_lists_nothing() {
        let file = zip_with("empty", &[]);
        assert!(list(file.path()).expect("list").members.is_empty());
    }

    #[test]
    fn the_order_is_the_same_every_run() {
        let file = zip_with("stable", &[("z.txt", b""), ("a.txt", b""), ("m/n.txt", b"")]);

        let first = list(file.path()).expect("first");
        let second = list(file.path()).expect("second");
        assert_eq!(names(&first), names(&second));
    }

    // --- the shape that matters -------------------------------------------

    #[test]
    fn a_zip_holding_a_unitypackage_reports_it() {
        // 103 archives in the seed library were never unpacked, 54 of them
        // holding unitypackages. A scanner that only sees loose files is
        // blind to a third of the library.
        let file = zip_with(
            "vrc",
            &[
                ("AW KLASSIK MAID/outfit.unitypackage", b"\x1f\x8b gzip"),
                ("AW KLASSIK MAID/readme.txt", b"thanks"),
            ],
        );

        let listing = list(file.path()).expect("list");
        assert!(names(&listing).contains(&"AW KLASSIK MAID/outfit.unitypackage"));
    }

    #[test]
    fn nested_paths_keep_their_shape() {
        let file = zip_with("nested", &[("Assets/[meron-farm]/mochi-bob/body.fbx", b"x")]);
        let listing = list(file.path()).expect("list");

        assert_eq!(names(&listing), ["Assets/[meron-farm]/mochi-bob/body.fbx"]);
    }

    #[test]
    fn non_ascii_member_names_survive() {
        let file = zip_with("unicode", &[("昼星と黄昏/body.fbx", b"x"), ("説明書.txt", b"y")]);
        let listing = list(file.path()).expect("list");

        assert!(names(&listing).iter().any(|n| n.contains("昼星と黄昏")));
        assert!(names(&listing).contains(&"説明書.txt"));
    }

    #[test]
    fn files_can_be_separated_from_directory_entries() {
        let file = zip_with("dirs", &[("folder/", b""), ("folder/a.txt", b"x")]);
        let listing = list(file.path()).expect("list");

        assert_eq!(listing.files().count(), 1);
        assert_eq!(listing.members.len(), 2);
    }

    // --- escaping members -------------------------------------------------

    #[test]
    fn a_member_climbing_out_is_flagged() {
        // Nothing is extracted here, so this cannot overwrite anything today.
        // The name still reaches a database and a screen, and an extract
        // command added later needs the flag already in the data.
        let file = zip_with("climb", &[("../../etc/passwd", b"x"), ("normal.txt", b"y")]);
        let listing = list(file.path()).expect("list");

        let escaping: Vec<&str> = listing.escaping().map(|m| m.path.as_str()).collect();
        assert_eq!(escaping, ["../../etc/passwd"]);
    }

    #[test]
    fn an_absolute_member_is_flagged() {
        let file = zip_with("absolute", &[("/etc/passwd", b"x")]);
        let listing = list(file.path()).expect("list");

        assert_eq!(listing.escaping().count(), 1);
    }

    #[test]
    fn a_windows_drive_letter_is_flagged() {
        let file = zip_with("drive", &[("C:/Windows/System32/evil.dll", b"x")]);
        let listing = list(file.path()).expect("list");

        assert_eq!(listing.escaping().count(), 1);
    }

    #[test]
    fn a_dotdot_inside_a_name_is_not_an_escape() {
        // `..cache` and `a..b` are ordinary names. Only a whole `..` segment
        // climbs out, which is why the check splits on separators rather than
        // searching for the substring.
        let file = zip_with("innocent", &[("..cache/a.txt", b"x"), ("a..b/c.txt", b"y")]);
        let listing = list(file.path()).expect("list");

        assert_eq!(listing.escaping().count(), 0, "an ordinary name was flagged");
    }

    #[test]
    fn an_ordinary_archive_flags_nothing() {
        let file = zip_with("clean", &[("a/b/c.txt", b"x"), ("readme.md", b"y")]);
        assert_eq!(list(file.path()).expect("list").escaping().count(), 0);
    }

    // --- trouble ----------------------------------------------------------

    #[test]
    fn a_missing_file_is_unreadable() {
        let missing = std::env::temp_dir().join("yukifile-nothing-here.zip");
        assert!(matches!(list(&missing), Err(ArchiveError::Unreadable(_))));
    }

    #[test]
    fn a_file_that_is_not_an_archive_says_so() {
        // The seed library has one RAR that could not be opened at all. That
        // is a fact about the object, not a scan failure.
        let file = TempFile::new("notazip");
        std::fs::write(file.path(), b"this is not a zip file").expect("write");

        assert!(matches!(list(file.path()), Err(ArchiveError::NotAnArchive(_))));
    }

    #[test]
    fn an_error_carries_something_a_person_can_read() {
        let missing = std::env::temp_dir().join("yukifile-nothing-here.zip");
        let message = list(&missing).unwrap_err().to_string();

        assert!(message.contains("cannot open"), "got: {message}");
    }
}
