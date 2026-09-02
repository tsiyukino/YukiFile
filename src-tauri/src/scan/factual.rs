//! What an entry observably is.
//!
//! A factual property is true by looking, not by reasoning. A `.pdf` is a pdf.
//! A directory is a folder. The restraint is the feature: these attach without
//! a person confirming them, so anything that could be wrong does not belong
//! here.
//!
//! Semantic properties — `vrchat`, `booth`, `paper`, `dataset` — are attached
//! by a person and never guessed. The software cannot tell a VRChat outfit
//! from a research dataset by looking at file extensions, and pretending
//! otherwise produces confident wrong answers, which are worse than blanks.
//!
//! # The core owns the matching, not the list
//!
//! `archive`, `pdf`, `image` and the rest are contributed by the built-in
//! modules, which use the same API as any third-party plugin. This module
//! holds the mechanism — a [`Rules`] set, matched against an entry — and no
//! extension of its own. A plugin adding `.blend` or `.epub` registers a rule;
//! it does not edit the core.
//!
//! `file` and `folder` are the exception, and the only one. Every entry is one
//! or the other by definition of being on a filesystem, and a scan that could
//! not tell them apart until a plugin loaded would have nothing to report.
//!
//! # What this deliberately does not do
//!
//! Organising the seed library by hand produced a list of inferences that look
//! reasonable and are wrong (`seed/vrc-lessons.md`):
//!
//! - **Reading inside an archive.** A Santa outfit contained 23 files matching
//!   `Assets/**/Editor/*.cs`, every one of them lilToon's shader inspector.
//!   "Has editor scripts, therefore is a tool" misfiles twelve products.
//! - **Judging a folder by its name.** `Texture/` is sometimes a bucket of
//!   loose PNGs belonging to its parent and sometimes a category folder
//!   holding eighteen separate products. Excluding by name dropped all
//!   eighteen, silently, twice.
//! - **Counting compatibility.** Matching many avatar names looks like
//!   "universal tool" and means the opposite: AFK animations touch bones, so
//!   they ship one variant per avatar. `VRSuya_AFK` matched 17 avatars
//!   precisely because it is not generic.
//!
//! Each needs evidence this module does not have and judgement it is not
//! entitled to make. It types one entry by its name and its kind.

use std::collections::{BTreeMap, BTreeSet};

use crate::scan::walk::{Entry, Kind};

/// Attached to every directory.
pub const FOLDER: &str = "folder";

/// Attached to everything that is not a directory.
pub const FILE: &str = "file";

/// Which extensions bring which properties.
///
/// Built by the plugin host from what the loaded modules declare. Empty is a
/// valid state: with no modules, every file is a `file` and nothing more,
/// which is what a scan should report rather than guessing on its own.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Rules {
    /// Lowercased extension to the properties it brings.
    by_extension: BTreeMap<String, BTreeSet<String>>,
}

impl Rules {
    pub fn new() -> Self {
        Self::default()
    }

    /// Declare that an extension brings a property.
    ///
    /// One extension may bring several — a `.docx` is an archive and a
    /// document, and both are observably true — and two plugins may
    /// contribute to the same extension without either overriding the other.
    /// There is nothing to arbitrate: both facts hold.
    pub fn add(&mut self, extension: &str, property: &str) -> &mut Self {
        self.by_extension
            .entry(extension.to_lowercase())
            .or_default()
            .insert(property.to_string());
        self
    }

    /// Declare several properties for one extension.
    pub fn add_all(&mut self, extension: &str, properties: &[&str]) -> &mut Self {
        for property in properties {
            self.add(extension, property);
        }
        self
    }

    /// Every property any rule can attach, for a plugin declaring what it
    /// builds on. Semantic properties layer over these: `paper` can offer DOI
    /// lookup because `pdf` already means text can be extracted.
    pub fn known(&self) -> BTreeSet<&str> {
        let mut all: BTreeSet<&str> = [FOLDER, FILE].into_iter().collect();
        for properties in self.by_extension.values() {
            all.extend(properties.iter().map(String::as_str));
        }
        all
    }

    /// The properties an entry observably has.
    ///
    /// Sorted and deduplicated, so two scans of one tree produce the same set
    /// and a difference between them means something changed rather than that
    /// a map iterated differently.
    pub fn properties(&self, entry: &Entry) -> BTreeSet<String> {
        let mut found = BTreeSet::new();

        if entry.kind == Kind::Folder {
            found.insert(FOLDER.to_string());
            // A folder's name may end in something that looks like an
            // extension — `Airi_Ver1.00`, `mochi_bob1.0` — and it is still a
            // folder. Extensions are not consulted for directories.
            return found;
        }

        found.insert(FILE.to_string());

        if let Some(extension) = extension_of(&entry.path) {
            if let Some(properties) = self.by_extension.get(&extension) {
                found.extend(properties.iter().cloned());
            }
        }
        found
    }

    pub fn is_empty(&self) -> bool {
        self.by_extension.is_empty()
    }
}

/// The lowercased extension of a path, if it has one.
///
/// Lowercased because the seed library is inconsistent about case — `Clothes`
/// / `Cloths` / `CLOTHS`, `Texture` / `TEXTURE` — and an uppercase `.PNG` is
/// as much an image as a lowercase one.
///
/// A name that is all extension has none: `.gitignore` is a file called
/// `.gitignore`, not a file of type `gitignore`. That case is reachable here
/// because dot-prefixed entries are walked rather than skipped.
fn extension_of(path: &str) -> Option<String> {
    let name = path.rsplit('/').next()?;
    let (stem, extension) = name.rsplit_once('.')?;

    if stem.is_empty() || extension.is_empty() {
        return None;
    }
    Some(extension.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str) -> Entry {
        Entry { path: path.to_string(), kind: Kind::File, size: Some(0), mtime: None }
    }

    fn folder(path: &str) -> Entry {
        Entry { path: path.to_string(), kind: Kind::Folder, size: None, mtime: None }
    }

    /// What the built-in modules would contribute. Written out here rather
    /// than imported, because the point of the design is that the core does
    /// not hold this list — a test that reached for a core-provided one would
    /// be testing the thing this module refuses to have.
    fn builtins() -> Rules {
        let mut rules = Rules::new();
        rules
            .add("zip", "archive")
            .add("7z", "archive")
            .add("rar", "archive")
            .add_all("pdf", &["document", "pdf"])
            .add_all("docx", &["archive", "document", "docx"])
            .add("png", "image")
            .add("jpg", "image")
            .add("txt", "document");
        rules
    }

    fn names(set: &BTreeSet<String>) -> Vec<&str> {
        set.iter().map(String::as_str).collect()
    }

    // --- kind -------------------------------------------------------------

    #[test]
    fn a_directory_is_a_folder() {
        let rules = builtins();
        assert_eq!(names(&rules.properties(&folder("Clothing"))), ["folder"]);
    }

    #[test]
    fn everything_else_is_a_file() {
        let rules = builtins();
        assert!(names(&rules.properties(&file("notes"))).contains(&"file"));
    }

    #[test]
    fn kind_is_known_without_any_plugin() {
        // A scan that could not tell a file from a folder until a module
        // loaded would have nothing to report.
        let empty = Rules::new();
        assert!(empty.is_empty());
        assert_eq!(names(&empty.properties(&folder("Clothing"))), ["folder"]);
        assert_eq!(names(&empty.properties(&file("a.pdf"))), ["file"]);
    }

    // --- extensions -------------------------------------------------------

    #[test]
    fn a_pdf_is_a_pdf() {
        let rules = builtins();
        assert_eq!(names(&rules.properties(&file("paper.pdf"))), ["document", "file", "pdf"]);
    }

    #[test]
    fn one_extension_can_bring_several_facts() {
        // A .docx is an archive and a document. Both are observably true, and
        // neither overrides the other.
        let rules = builtins();
        assert_eq!(
            names(&rules.properties(&file("thesis.docx"))),
            ["archive", "document", "docx", "file"]
        );
    }

    #[test]
    fn case_does_not_matter() {
        // The seed library is inconsistent: Clothes / Cloths / CLOTHS,
        // Texture / TEXTURE.
        let rules = builtins();
        for path in ["cover.PNG", "cover.png", "cover.Png"] {
            assert!(
                names(&rules.properties(&file(path))).contains(&"image"),
                "{path} was not an image"
            );
        }
    }

    #[test]
    fn an_unknown_extension_is_just_a_file() {
        // No module claims .unitypackage in v1, and guessing is not this
        // module's job.
        let rules = builtins();
        assert_eq!(names(&rules.properties(&file("outfit.unitypackage"))), ["file"]);
    }

    #[test]
    fn a_file_with_no_extension_is_just_a_file() {
        let rules = builtins();
        assert_eq!(names(&rules.properties(&file("README"))), ["file"]);
    }

    #[test]
    fn a_dotfile_is_not_a_file_of_that_type() {
        // .gitignore is a file called .gitignore, not a gitignore file. This
        // is reachable because dot-prefixed entries are walked.
        let mut rules = builtins();
        rules.add("gitignore", "should-not-appear");

        assert_eq!(names(&rules.properties(&file(".gitignore"))), ["file"]);
    }

    #[test]
    fn only_the_last_extension_counts() {
        let rules = builtins();
        assert!(names(&rules.properties(&file("archive.tar.zip"))).contains(&"archive"));
    }

    #[test]
    fn the_extension_comes_from_the_name_not_the_path() {
        // A directory called `.AASHAREE` above the file must not be read as
        // its extension.
        let rules = builtins();
        let entry = file(".AASHAREE/CLOTHS/cover.png");
        assert!(names(&rules.properties(&entry)).contains(&"image"));
    }

    // --- what it refuses to do --------------------------------------------

    #[test]
    fn a_folder_whose_name_ends_in_a_version_is_still_a_folder() {
        // `Airi_Ver1.00` and `mochi_bob1.0` are directories in the seed
        // library. Reading `.00` as an extension would type them as files.
        let rules = builtins();
        for path in ["Airi_Ver1.00", "mochi_bob1.0", "Endeavor_v1.0.4"] {
            assert_eq!(
                names(&rules.properties(&folder(path))),
                ["folder"],
                "{path} picked up something from its name"
            );
        }
    }

    #[test]
    fn a_folder_named_texture_gets_no_special_treatment() {
        // Texture/ is sometimes loose PNGs belonging to its parent and
        // sometimes a category folder holding eighteen products. Deciding by
        // name dropped all eighteen, silently, twice.
        let rules = builtins();
        for path in ["Texture", "TEXTURES", "Clothes", "CLOTHS", "NSFW"] {
            assert_eq!(names(&rules.properties(&folder(path))), ["folder"]);
        }
    }

    #[test]
    fn an_archive_is_an_archive_and_nothing_about_its_contents() {
        // Twelve products in the seed library ship lilToon inside them. Any
        // rule that reads inward and concludes "tool" misfiles all twelve.
        let rules = builtins();
        assert_eq!(
            names(&rules.properties(&file("Santa Outfit.zip"))),
            ["archive", "file"]
        );
    }

    #[test]
    fn no_semantic_property_is_ever_attached() {
        // vrchat, booth, paper and dataset are attached by a person. A
        // filename cannot tell a VRChat outfit from a research dataset.
        let rules = builtins();
        let semantic = ["vrchat", "booth", "paper", "dataset", "tool", "avatar"];

        for path in [
            ".MANUKA/Clothes/Mummy's veil.unitypackage",
            "papers/attention-is-all-you-need.pdf",
            "VRSuya_AFK.zip",
            "lilToon.unitypackage",
        ] {
            let found = rules.properties(&file(path));
            for property in semantic {
                assert!(
                    !found.contains(property),
                    "{path} was given the semantic property {property}"
                );
            }
        }
    }

    // --- rules ------------------------------------------------------------

    #[test]
    fn two_plugins_can_claim_one_extension() {
        // Neither overrides the other; both facts hold.
        let mut rules = Rules::new();
        rules.add("psd", "image");
        rules.add("psd", "layered");

        assert_eq!(names(&rules.properties(&file("cover.psd"))), ["file", "image", "layered"]);
    }

    #[test]
    fn declaring_the_same_rule_twice_changes_nothing() {
        // Plugin loading may repeat.
        let mut rules = Rules::new();
        rules.add("png", "image").add("png", "image");

        assert_eq!(names(&rules.properties(&file("a.png"))), ["file", "image"]);
    }

    #[test]
    fn an_extension_is_registered_case_insensitively() {
        let mut rules = Rules::new();
        rules.add("PNG", "image");

        assert!(names(&rules.properties(&file("a.png"))).contains(&"image"));
    }

    #[test]
    fn known_lists_what_a_plugin_may_build_on() {
        // Semantic properties layer over these: `paper` can offer DOI lookup
        // because `pdf` already means text can be extracted.
        let rules = builtins();
        let known = rules.known();

        assert!(known.contains("file"));
        assert!(known.contains("folder"));
        assert!(known.contains("pdf"));
        assert!(known.contains("archive"));
        assert!(!known.contains("vrchat"));
    }

    #[test]
    fn an_empty_rule_set_still_knows_the_two_kinds() {
        assert_eq!(Rules::new().known().into_iter().collect::<Vec<_>>(), ["file", "folder"]);
    }
}
