//! Which library to open, and the ones opened before.
//!
//! A library is a folder; its data lives in `.yukifile/` inside it, so the
//! library carries itself between machines. Which library the *application*
//! opens is a different kind of fact: it belongs to this machine and this
//! person, not to any library, so it lives in the application's own config
//! directory, in one small file.
//!
//! # Switching is a restart
//!
//! Everything the window shows hangs off one opened library: the database
//! connection, the plugins that library enables, the asset scope granted for
//! its files. Swapping all of that under a running window is a dozen places
//! to get half right. Restarting the process gets all of it right by
//! construction, and takes a second. So switching writes the choice down as
//! `switch_to` and restarts; startup reads it once and clears it.
//!
//! # What startup opens
//!
//! A switch the person just asked for, then a folder named on the command
//! line, then the last library opened, then nothing -- and nothing is the
//! caller's to handle. A command-line argument outranks the remembered
//! library because typing a path is the most explicit thing a person can do,
//! but not a switch made from inside the window: the restart carries the
//! old arguments along, and a switch that reopened the old library would be
//! a button that does nothing.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// How many libraries the picker remembers.
pub const RECENT: usize = 8;

/// The file, inside the application's config directory.
const FILE: &str = "libraries.json";

/// What the application remembers about libraries.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Remembered {
    /// Most recently opened first, the current one included.
    pub recent: Vec<String>,
    /// Open this at the next start, once.
    pub switch_to: Option<String>,
}

impl Remembered {
    /// The library opened last, if any.
    pub fn last(&self) -> Option<&str> {
        self.recent.first().map(String::as_str)
    }

    /// Remember that `root` was opened: first in the list, once, and no
    /// pending switch any more.
    pub fn opened(mut self, root: &str) -> Self {
        self.recent.retain(|held| !same_path(held, root));
        self.recent.insert(0, root.to_string());
        self.recent.truncate(RECENT);
        self.switch_to = None;
        self
    }

    /// Ask for `root` at the next start.
    pub fn switching_to(mut self, root: &str) -> Self {
        self.switch_to = Some(root.to_string());
        self
    }

    /// Drop a library from the list. Its folder is not touched.
    pub fn without(mut self, root: &str) -> Self {
        self.recent.retain(|held| !same_path(held, root));
        self
    }
}

/// Which library to open at startup, by the order the module comment gives.
pub fn choose(remembered: &Remembered, argument: Option<String>) -> Option<String> {
    remembered
        .switch_to
        .clone()
        .or(argument)
        .or_else(|| remembered.last().map(str::to_string))
}

/// Read what was remembered. A missing or unreadable file is nothing
/// remembered: losing the recent list must never stop the application
/// opening.
pub fn read(dir: &Path) -> Remembered {
    std::fs::read_to_string(dir.join(FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Write it down.
pub fn write(dir: &Path, remembered: &Remembered) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let text = serde_json::to_string_pretty(remembered).map_err(std::io::Error::other)?;
    std::fs::write(dir.join(FILE), text)
}

/// Where the application keeps its own config, per platform.
///
/// Written out rather than taken from a crate: three environment variables
/// are the whole of it, and this has to work before any window exists.
pub fn config_dir() -> Option<PathBuf> {
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library").join("Application Support"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
    }?;
    Some(base.join("yukifile"))
}

/// A path as a person reads it.
///
/// Canonicalising on Windows yields `\\?\E:\Avatar`, which is correct and
/// unreadable. The prefix is dropped for display and for remembering; the
/// path still opens.
pub fn plain(path: &Path) -> String {
    let text = path.display().to_string();
    text.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(text)
}

/// The folder's own name, for a menu.
pub fn name_of(path: &str) -> String {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_string()
}

/// Two spellings of one folder. Windows paths ignore case, and the library
/// is used mostly on Windows.
fn same_path(a: &str, b: &str) -> bool {
    let tidy = |p: &str| p.trim_end_matches(['/', '\\']).replace('\\', "/");
    if cfg!(windows) {
        tidy(a).to_lowercase() == tidy(b).to_lowercase()
    } else {
        tidy(a) == tidy(b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_switch_outranks_the_argument_which_outranks_the_last_library() {
        let remembered = Remembered { recent: vec!["/last".into()], switch_to: None };
        assert_eq!(choose(&remembered, None).as_deref(), Some("/last"));
        assert_eq!(choose(&remembered, Some("/typed".into())).as_deref(), Some("/typed"));

        // The restart carries the old arguments along; the switch still wins.
        let switching = remembered.switching_to("/chosen");
        assert_eq!(choose(&switching, Some("/typed".into())).as_deref(), Some("/chosen"));

        assert_eq!(choose(&Remembered::default(), None), None);
    }

    #[test]
    fn opening_puts_a_library_first_once_and_clears_the_switch() {
        let remembered = Remembered { recent: vec!["/a".into(), "/b".into()], switch_to: Some("/b".into()) };
        let after = remembered.opened("/b/");
        assert_eq!(after.recent, ["/b/", "/a"]);
        assert_eq!(after.switch_to, None);
    }

    #[test]
    fn the_list_is_capped() {
        let mut remembered = Remembered::default();
        for i in 0..20 {
            remembered = remembered.opened(&format!("/lib{i}"));
        }
        assert_eq!(remembered.recent.len(), RECENT);
        assert_eq!(remembered.last(), Some("/lib19"));
    }

    #[test]
    fn forgetting_one_leaves_the_rest() {
        let remembered = Remembered { recent: vec!["/a".into(), "/b".into()], switch_to: None };
        assert_eq!(remembered.without("/a").recent, ["/b"]);
    }

    #[test]
    fn what_is_written_is_what_is_read_and_a_broken_file_is_nothing() {
        let dir = std::env::temp_dir().join(format!("yukifile-libraries-{}", std::process::id()));
        let remembered = Remembered::default().opened("/a").switching_to("/b");
        write(&dir, &remembered).expect("write");
        assert_eq!(read(&dir), remembered);

        std::fs::write(dir.join(FILE), "not json").expect("break it");
        assert_eq!(read(&dir), Remembered::default());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_windows_path_reads_without_its_verbatim_prefix() {
        assert_eq!(plain(Path::new(r"\\?\E:\Avatar")), r"E:\Avatar");
        assert_eq!(plain(Path::new("/home/me/Avatar")), "/home/me/Avatar");
        assert_eq!(name_of(r"E:\Unity\Avatar\"), "Avatar");
        assert_eq!(name_of("/home/me/lib"), "lib");
    }
}
