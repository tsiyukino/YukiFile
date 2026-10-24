//! Bringing the library's locations back in line with the disk.
//!
//! A plugin's scan proposes objects and only ever adds. Between scans a
//! person moves a product into another category, renames a folder, deletes a
//! zip they unpacked -- and the library goes on saying the thing is where it
//! was. `scan::reconcile` has known how to tell a move from a delete plus an
//! add since layer 2; until now nothing a person could press reached it.
//!
//! # What it applies, and what it only reports
//!
//! Moves, touches and removals are applied: they are facts about locations
//! the library already claims, and `architecture.md` gives a scan the same
//! reading for them as for a first import -- those rows changing, not
//! somebody editing. Additions are **reported, not applied**: what counts as
//! an object is a plugin's judgement, and a path nothing claims is for a
//! plugin's scan to decide about.
//!
//! A move is applied only when proven by a hash on both sides. A removal and
//! an addition sharing a basename are a *candidate*: offered to the person,
//! who knows whether they moved it, rather than guessed at -- 33 of the seed
//! library's products are a folder and a zip sharing a stem. When the library
//! holds a hash for the gone side, the found side is hashed and the pair is
//! tried again; most known rows hold no hash, since nothing computes them
//! for a 35 GB library on its own, and those pairs stay questions.
//!
//! An object left with no location is a grouping, which is a normal thing to
//! be. Whether to forget it is the person's call, and the object page has
//! the button.

use crate::bridge::{BridgeError, Library};
use crate::scan::reconcile::{self, Found, Step};
use crate::scan::walk;
use crate::store::{paths, schema};

/// What a rescan found and did.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct RescanView {
    pub moved: usize,
    pub touched: usize,
    pub removed: usize,
    /// Paths on disk nothing claims. Reported, not recorded: a plugin's scan
    /// decides what to make of them.
    pub added: Vec<String>,
    /// A removal and an addition sharing a basename, for a person to decide.
    pub candidates: Vec<CandidateView>,
    pub unreadable: Vec<String>,
}

/// One possible move.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct CandidateView {
    #[serde(with = "crate::bridge::views::id_as_string")]
    pub object: i64,
    pub from: String,
    pub to: String,
    /// What the found side is, so a confirmation can re-add it without
    /// looking twice.
    pub kind: String,
}

/// Compare the library's locations with the disk and apply what is certain.
pub fn library_reconcile_in(library: &Library) -> Result<RescanView, BridgeError> {
    let root = library.root().to_path_buf();
    let walked = walk::walk(&root);
    let mut found: Vec<Found> = walked
        .entries
        .iter()
        .filter(|entry| !entry.path.split('/').any(|segment| segment == walk::LIBRARY_DIR))
        .map(|entry| Found::new(entry.clone()))
        .collect();

    library.with_connection_mut(|connection| {
        schema::in_transaction(connection, |transaction| {
            let known = paths::known(transaction)?;
            let mut changes = reconcile::reconcile(&known, &found);

            // A second look at the candidates the library can settle itself:
            // where the gone side carries a hash, hash the found side.
            let provable: Vec<(String, String)> = changes
                .candidates
                .iter()
                .filter(|candidate| {
                    known.iter().any(|k| k.path == candidate.from && k.hash.is_some())
                })
                .map(|candidate| (candidate.from.clone(), candidate.to.clone()))
                .collect();
            if !provable.is_empty() {
                for (_, to) in &provable {
                    if let Some(entry) = found.iter_mut().find(|f| f.entry.path == *to) {
                        if let Ok(hash) = crate::commands::hash::of_path(&root.join(to)) {
                            entry.hash = Some(hash);
                        }
                    }
                }
                changes = reconcile::reconcile(&known, &found);
            }

            let mut view = RescanView::default();
            for step in changes.steps() {
                match step {
                    Step::Move(moved) => {
                        paths::move_path(transaction, &moved.from, &moved.to)?;
                        view.moved += 1;
                    }
                    Step::Touch(touched) => {
                        paths::touch(transaction, &touched.path, touched.size, touched.mtime)?;
                        view.touched += 1;
                    }
                    Step::Remove(removed) => {
                        paths::forget(transaction, &removed.path)?;
                        view.removed += 1;
                    }
                    Step::Add(added) => view.added.push(added.path.clone()),
                }
            }

            let kinds: std::collections::HashMap<&str, walk::Kind> =
                found.iter().map(|f| (f.entry.path.as_str(), f.entry.kind)).collect();
            view.candidates = changes
                .candidates
                .iter()
                .map(|candidate| CandidateView {
                    object: candidate.object,
                    from: candidate.from.clone(),
                    to: candidate.to.clone(),
                    kind: match kinds.get(candidate.to.as_str()) {
                        Some(walk::Kind::Folder) => "folder".to_string(),
                        _ => "file".to_string(),
                    },
                })
                .collect();
            view.unreadable = walked.trouble.iter().map(|t| t.path.display().to_string()).collect();

            log::info!(
                "rescanned {}: {} moved, {} touched, {} removed, {} new on disk, {} candidates",
                root.display(),
                view.moved,
                view.touched,
                view.removed,
                view.added.len(),
                view.candidates.len()
            );
            Ok(view)
        })
    })
}

/// Bring the library's locations back in line with the disk.
#[tauri::command]
pub async fn library_reconcile(library: tauri::State<'_, Library>) -> Result<RescanView, BridgeError> {
    library_reconcile_in(&library)
}
