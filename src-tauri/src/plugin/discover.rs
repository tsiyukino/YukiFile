//! Finding manifests on disk.
//!
//! A plugin is a directory holding a `manifest.json`. This reads a directory
//! of those and hands back what it found.
//!
//! # Reading is not loading
//!
//! [`in_directory`] parses each manifest on its own and reports the ones it
//! could not, rather than failing the lot. [`crate::plugin::registry::Registry::load`]
//! is the opposite: all or nothing.
//!
//! The two answer different questions, which is why they are separate calls.
//! "This directory is not a plugin" is about one directory and the rest are
//! unaffected — a half-copied folder, a leftover `.bak`, an editor's scratch
//! file. "These plugins do not satisfy each other" is about the set, and
//! starting anyway would give a library where some objects have panels and
//! others do not for reasons nobody can see.
//!
//! Folding them together would mean a stray directory could stop the
//! application, or an unsatisfied dependency could pass silently. Both are
//! worse than the split.

use std::fs;
use std::io;
use std::path::Path;

use crate::plugin::manifest::Manifest;

/// What a directory held.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Found {
    /// Manifests that parsed, in directory order so that a run over the same
    /// tree twice produces the same order.
    pub manifests: Vec<Manifest>,
    /// Directories that looked like plugins and were not.
    pub skipped: Vec<Skipped>,
}

/// A directory that could not be read as a plugin.
///
/// Reported rather than dropped: a plugin that silently does not load is a
/// missing panel with no explanation, and the explanation is the whole
/// difference between a bug report and a shrug.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Skipped {
    pub directory: String,
    pub reason: String,
}

/// The file a plugin directory is recognised by.
const MANIFEST: &str = "manifest.json";

/// Read every plugin directory under `root`.
///
/// A missing root is not an error: a library with no plugins installed is a
/// working library, and treating an absent directory as a failure would make
/// the empty case the loud one.
pub fn in_directory(root: &Path) -> io::Result<Found> {
    let mut found = Found::default();

    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(found),
        Err(error) => return Err(error),
    };

    // Sorted, because read_dir order is whatever the filesystem says and two
    // runs over one tree should not disagree about load order.
    let mut directories: Vec<_> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    directories.sort();

    for directory in directories {
        let name = directory
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();

        let manifest_path = directory.join(MANIFEST);
        if !manifest_path.is_file() {
            // Not a plugin directory at all. Nothing to report -- a `docs` or
            // `node_modules` sitting alongside plugins is not a failure, and
            // saying so on every start would train people to ignore the list.
            continue;
        }

        match fs::read_to_string(&manifest_path) {
            Ok(text) => match Manifest::parse(&text) {
                Ok(mut manifest) => {
                    // Where it was found, so the frontend can resolve a
                    // manifest's `./panel` against the right directory. The
                    // id cannot stand in for it: `yukifile.archive` lives in
                    // `archive/`, and deriving one from the other would be a
                    // convention nothing enforces.
                    manifest.directory = name.clone();
                    found.manifests.push(manifest);
                }
                Err(error) => found.skipped.push(Skipped {
                    directory: name,
                    reason: error.to_string(),
                }),
            },
            Err(error) => found.skipped.push(Skipped {
                directory: name,
                reason: format!("cannot read {MANIFEST}: {error}"),
            }),
        }
    }

    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A directory that cleans itself up.
    struct Dir(std::path::PathBuf);

    impl Dir {
        fn new(tag: &str) -> Self {
            use std::sync::atomic::{AtomicU32, Ordering};
            static COUNTER: AtomicU32 = AtomicU32::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("yukifile-discover-{tag}-{}-{n}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("create");
            Self(path)
        }

        fn plugin(&self, name: &str, manifest: &str) -> &Self {
            let directory = self.0.join(name);
            fs::create_dir_all(&directory).expect("mkdir");
            fs::write(directory.join(MANIFEST), manifest).expect("write");
            self
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn manifest(id: &str, property: &str) -> String {
        format!(
            r#"{{"id":"{id}","contributes":{{"properties":["{property}"],
               "panels":{{"{property}":"./panel"}}}}}}"#
        )
    }

    #[test]
    fn a_directory_of_plugins_is_read() {
        let dir = Dir::new("two");
        dir.plugin("first", &manifest("example.first", "first"))
            .plugin("second", &manifest("example.second", "second"));

        let found = in_directory(dir.path()).expect("read");

        assert_eq!(found.manifests.len(), 2);
        assert!(found.skipped.is_empty());
    }

    #[test]
    fn plugins_come_back_in_a_stable_order() {
        // read_dir order is the filesystem's business. Two runs over one tree
        // that disagreed would make load order depend on how the directory
        // happened to be written.
        let dir = Dir::new("order");
        dir.plugin("zebra", &manifest("z.plugin", "z"))
            .plugin("alpha", &manifest("a.plugin", "a"))
            .plugin("middle", &manifest("m.plugin", "m"));

        let found = in_directory(dir.path()).expect("read");
        let ids: Vec<&str> = found.manifests.iter().map(|m| m.id.as_str()).collect();

        assert_eq!(ids, ["a.plugin", "m.plugin", "z.plugin"]);
    }

    #[test]
    fn a_directory_without_a_manifest_is_not_a_plugin_and_not_a_complaint() {
        // A `node_modules` or a `docs` sitting alongside plugins is not a
        // failure. Reporting it on every start trains people to ignore the
        // list, and then the real skips go unread too.
        let dir = Dir::new("bystander");
        dir.plugin("first", &manifest("example.first", "first"));
        fs::create_dir_all(dir.path().join("notes")).expect("mkdir");

        let found = in_directory(dir.path()).expect("read");

        assert_eq!(found.manifests.len(), 1);
        assert!(found.skipped.is_empty(), "a bystander directory was reported");
    }

    #[test]
    fn a_broken_manifest_is_skipped_with_a_reason_and_the_rest_load() {
        let dir = Dir::new("broken");
        dir.plugin("good", &manifest("example.first", "first"))
            .plugin("bad", "{ this is not json");

        let found = in_directory(dir.path()).expect("read");

        assert_eq!(found.manifests.len(), 1, "one bad manifest stopped the others");
        assert_eq!(found.skipped.len(), 1);
        assert_eq!(found.skipped[0].directory, "bad");
        assert!(
            !found.skipped[0].reason.trim().is_empty(),
            "a skip with no reason is a missing panel nobody can explain"
        );
    }

    #[test]
    fn a_manifest_that_parses_but_breaks_a_rule_is_skipped_too() {
        // Reading a manifest means Manifest::parse, which checks. A file that
        // is valid JSON and an invalid manifest must not reach the registry.
        let dir = Dir::new("invalid");
        dir.plugin(
            "sneaky",
            r#"{"id":"x.plugin","contributes":{"properties":["fs"]}}"#,
        );

        let found = in_directory(dir.path()).expect("read");

        assert!(found.manifests.is_empty(), "a reserved property got through");
        assert!(found.skipped[0].reason.contains("reserved"));
    }

    #[test]
    fn an_extension_in_a_specifier_is_caught_here_too() {
        let dir = Dir::new("extension");
        dir.plugin(
            "built",
            r#"{"id":"x.plugin","contributes":{"properties":["x"],
               "panels":{"x":"./panel.js"}}}"#,
        );

        let found = in_directory(dir.path()).expect("read");

        assert!(found.manifests.is_empty());
        assert!(found.skipped[0].reason.contains("extension"));
    }

    #[test]
    fn a_missing_root_is_an_empty_result_rather_than_an_error() {
        // A library with no plugins installed is a working library.
        let nowhere = std::env::temp_dir().join("yukifile-discover-does-not-exist");

        let found = in_directory(&nowhere).expect("should not error");

        assert_eq!(found, Found::default());
    }

    #[test]
    fn an_empty_directory_holds_no_plugins() {
        let dir = Dir::new("empty");

        assert_eq!(in_directory(dir.path()).expect("read"), Found::default());
    }

    #[test]
    fn what_is_found_can_be_loaded() {
        // The two calls have to compose: this is the whole reason discovery
        // returns manifests rather than a registry.
        use crate::plugin::registry::Registry;

        let dir = Dir::new("compose");
        dir.plugin("first", &manifest("example.first", "first"))
            .plugin("second", &manifest("example.second", "second"));

        let found = in_directory(dir.path()).expect("read");
        let registry = Registry::load(found.manifests).expect("load");

        assert_eq!(registry.plugins().len(), 2);
        assert!(registry.provider_of("first").is_some());
    }
}
