//! Which plugins a library uses.
//!
//! Discovery reads a directory; this reads a library's mind. The two are
//! separate because they answer different questions: what is installed on this
//! machine, and what does this library want.
//!
//! Without that split, every plugin under `plugins/` runs in every library.
//! Then "record every file and folder" is not a choice anybody made — it is
//! what happens because a directory exists, which is a decision taken
//! somewhere the user cannot see or change. That is the same mistake as
//! putting the scanning rule in the core, one layer out.
//!
//! # Absent means all
//!
//! A library with no list runs everything discovered. A library that has never
//! said anything about plugins is not a library that wants none, and starting
//! empty would make every existing library go dark on upgrade.
//!
//! The cost is that opting out requires writing a list that names what you do
//! want, rather than what you do not. That is the right way round: the file
//! then says what the library runs, which is the thing worth reading.

use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::Path;

use super::manifest::Manifest;

/// The file a library declares its plugins in, inside `.yukifile/`.
const LIST: &str = "plugins.json";

/// What a library said about plugins, and anything wrong with how it said it.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Enabled {
    /// The ids the library enables, or `None` when it has not said.
    pub ids: Option<BTreeSet<String>>,
    /// What went wrong reading the list, if anything.
    ///
    /// Reported rather than returned as an error, following `discover`: a
    /// library whose plugin list will not parse should open with every plugin
    /// running and a complaint, not refuse to open. The complaint is what
    /// separates a bug report from a shrug.
    pub complaint: Option<String>,
}

/// Read a library's plugin list from its data directory.
///
/// A missing file is the normal case and not a complaint. Anything else that
/// goes wrong -- unreadable, malformed, the wrong shape -- leaves `ids` as
/// `None`, so the library runs everything rather than nothing.
pub fn read(data: &Path) -> Enabled {
    let path = data.join(LIST);

    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Enabled::default(),
        Err(error) => {
            return Enabled {
                ids: None,
                complaint: Some(format!("cannot read {LIST}: {error}")),
            }
        }
    };

    match serde_json::from_str::<Vec<String>>(&text) {
        Ok(ids) => Enabled { ids: Some(ids.into_iter().collect()), complaint: None },
        Err(error) => Enabled {
            ids: None,
            complaint: Some(format!("cannot read {LIST}: {error}")),
        },
    }
}

/// Keep the manifests a library enables.
///
/// `None` keeps everything. Order is preserved, because the registry loads in
/// the order it is given and two runs over one library should not disagree.
pub fn filter(manifests: Vec<Manifest>, ids: Option<&BTreeSet<String>>) -> Vec<Manifest> {
    let Some(ids) = ids else { return manifests };
    manifests.into_iter().filter(|manifest| ids.contains(&manifest.id)).collect()
}

/// Ids the library enabled that nothing on disk provides.
///
/// Worth reporting: a list naming a plugin that is not installed is a typo or
/// a missing install, and both look identical to a library that quietly runs
/// without it.
pub fn missing(manifests: &[Manifest], ids: Option<&BTreeSet<String>>) -> Vec<String> {
    let Some(ids) = ids else { return Vec::new() };
    let present: BTreeSet<&str> = manifests.iter().map(|m| m.id.as_str()).collect();
    ids.iter().filter(|id| !present.contains(id.as_str())).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(id: &str) -> Manifest {
        Manifest { id: id.to_string(), ..Manifest::default() }
    }

    fn discovered() -> Vec<Manifest> {
        vec![manifest("a.one"), manifest("a.two"), manifest("a.three")]
    }

    /// A data directory that cleans itself up, holding the given list.
    ///
    /// The counter is what lets these run in parallel: two tests sharing a
    /// path would each delete the other's file, and the failure would move
    /// around depending on which won.
    struct Dir(std::path::PathBuf);

    impl Dir {
        fn new(list: Option<&str>) -> Self {
            use std::sync::atomic::{AtomicU32, Ordering};
            static COUNTER: AtomicU32 = AtomicU32::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("yukifile-enabled-{}-{n}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("create");
            if let Some(text) = list {
                fs::write(path.join(LIST), text).expect("write list");
            }
            Self(path)
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

    fn library(list: Option<&str>) -> Dir {
        Dir::new(list)
    }

    #[test]
    fn a_library_that_has_not_said_runs_everything() {
        // The upgrade case. Every library predates this file, and starting
        // them empty would take away plugins nobody asked to remove.
        let dir = library(None);
        let read = read(dir.path());

        assert_eq!(read.ids, None);
        assert_eq!(read.complaint, None);
        assert_eq!(filter(discovered(), read.ids.as_ref()).len(), 3);
    }

    #[test]
    fn a_list_runs_only_what_it_names() {
        let dir = library(Some(r#"["a.two"]"#));
        let read = read(dir.path());

        let kept = filter(discovered(), read.ids.as_ref());
        assert_eq!(kept.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["a.two"]);
    }

    #[test]
    fn an_empty_list_runs_nothing() {
        // Distinct from having no list at all, and the distinction is the
        // whole point: this library said "none", the other said nothing.
        let dir = library(Some("[]"));
        let read = read(dir.path());

        assert_eq!(read.ids, Some(BTreeSet::new()));
        assert!(filter(discovered(), read.ids.as_ref()).is_empty());
    }

    #[test]
    fn a_malformed_list_complains_and_runs_everything() {
        // Going dark on a typo would be the worst of both: the library opens
        // with nothing working and nothing saying why.
        let dir = library(Some("not json"));
        let read = read(dir.path());

        assert_eq!(read.ids, None);
        assert!(read.complaint.is_some(), "a broken list said nothing");
        assert_eq!(filter(discovered(), read.ids.as_ref()).len(), 3);
    }

    #[test]
    fn a_list_of_the_wrong_shape_is_malformed_too() {
        // Valid JSON, wrong thing. An object here is somebody guessing at the
        // format, and guessing silently would run every plugin anyway.
        let dir = library(Some(r#"{"plugins": ["a.one"]}"#));
        let read = read(dir.path());

        assert_eq!(read.ids, None);
        assert!(read.complaint.is_some());
    }

    #[test]
    fn naming_a_plugin_nothing_provides_is_reported() {
        // A typo and a missing install look identical from inside a library
        // that quietly runs without the plugin.
        let ids = Some(["a.one".to_string(), "a.absent".to_string()].into_iter().collect());

        assert_eq!(missing(&discovered(), ids.as_ref()), ["a.absent"]);
    }

    #[test]
    fn nothing_is_missing_when_the_library_has_not_said() {
        assert!(missing(&discovered(), None).is_empty());
    }

    #[test]
    fn filtering_keeps_the_order_it_was_given() {
        // The registry loads in the order it receives, and two runs over one
        // library should not disagree about it.
        let ids = Some(["a.three".to_string(), "a.one".to_string()].into_iter().collect());
        let kept = filter(discovered(), ids.as_ref());

        assert_eq!(kept.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["a.one", "a.three"]);
    }
}
