//! What changed between the library and the disk.
//!
//! Pure: it takes what a walk found and what the library already holds, and
//! returns the difference. No filesystem, no database, no clock — which is why
//! the awkward cases below can be written as tests rather than arranged on
//! disk.
//!
//! # Moves are claimed on evidence, never on resemblance
//!
//! The hard case is telling a move from a delete plus an add. Getting it wrong
//! in one direction loses every value and edge attached to an object; getting
//! it wrong in the other silently merges two things the user kept apart.
//!
//! A content hash is the only evidence this module accepts. `object_paths.hash`
//! is null until computed — hashing 1518 files must not block a first scan from
//! showing results — so a large share of any early reconcile has nothing to go
//! on, and says so instead of guessing.
//!
//! The tempting substitute is the filename. In the seed library's own
//! reorganisation, all 174 moves kept their basename, so it looks like a
//! reliable signal. It is not: 33 of those products are a folder and a zip
//! sharing one stem, and matching on name alone would pair the wrong ones. A
//! basename match with no hash is reported as a *candidate*, for a caller that
//! can ask, and never applied on its own.

use std::collections::{HashMap, HashSet};

use crate::scan::walk::{Entry, Kind};

/// A location the library already knows about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Known {
    pub object: i64,
    pub path: String,
    pub kind: Kind,
    pub size: Option<u64>,
    pub mtime: Option<i64>,
    /// `None` until it has been computed.
    pub hash: Option<String>,
}

/// A location found on disk, with its hash if one was computed this pass.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub entry: Entry,
    pub hash: Option<String>,
}

impl Found {
    pub fn new(entry: Entry) -> Self {
        Self { entry, hash: None }
    }

    pub fn hashed(entry: Entry, hash: &str) -> Self {
        Self { entry, hash: Some(hash.to_string()) }
    }
}

/// A path on disk that no object claims.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Added {
    pub path: String,
    pub kind: Kind,
    pub size: Option<u64>,
    pub mtime: Option<i64>,
}

/// A path an object claims that is no longer there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Removed {
    pub object: i64,
    pub path: String,
}

/// One object's location moved, proven by a matching hash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Moved {
    pub object: i64,
    pub from: String,
    pub to: String,
}

/// A path whose content is unchanged but whose size or mtime is not.
///
/// Worth reporting separately from an untouched path: it is what tells a
/// caller which hashes are stale and need recomputing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Touched {
    pub object: i64,
    pub path: String,
    pub size: Option<u64>,
    pub mtime: Option<i64>,
}

/// A removal and an addition that share a basename, with no hash to decide.
///
/// Not applied. A caller may offer it to the user, or hash both and reconcile
/// again; either way the decision is made where there is more to go on than
/// this module has.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MoveCandidate {
    pub object: i64,
    pub from: String,
    pub to: String,
}

/// The difference between the library and the disk.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Changes {
    pub added: Vec<Added>,
    pub removed: Vec<Removed>,
    pub moved: Vec<Moved>,
    pub touched: Vec<Touched>,
    pub candidates: Vec<MoveCandidate>,
}

impl Changes {
    /// True when the library already matches the disk.
    ///
    /// Candidates do not count as changes: they are questions, and a library
    /// with unanswered questions is not out of date.
    pub fn is_empty(&self) -> bool {
        self.added.is_empty()
            && self.removed.is_empty()
            && self.moved.is_empty()
            && self.touched.is_empty()
    }
}

/// Compare what the library holds against what a walk found.
pub fn reconcile(known: &[Known], found: &[Found]) -> Changes {
    let by_path: HashMap<&str, &Known> =
        known.iter().map(|entry| (entry.path.as_str(), entry)).collect();
    let seen: HashSet<&str> =
        found.iter().map(|entry| entry.entry.path.as_str()).collect();

    let mut changes = Changes::default();
    let mut gone: Vec<&Known> = Vec::new();
    let mut fresh: Vec<&Found> = Vec::new();

    // Paths present in both are the same location, whatever the content.
    for entry in found {
        match by_path.get(entry.entry.path.as_str()) {
            Some(existing) => {
                if is_touched(existing, entry) {
                    changes.touched.push(Touched {
                        object: existing.object,
                        path: entry.entry.path.clone(),
                        size: entry.entry.size,
                        mtime: entry.entry.mtime,
                    });
                }
            }
            None => fresh.push(entry),
        }
    }

    for entry in known {
        if !seen.contains(entry.path.as_str()) {
            gone.push(entry);
        }
    }

    let paired = pair_by_hash(&mut gone, &mut fresh);
    changes.moved = paired;

    // Whatever is left is an addition, a removal, or a question.
    changes.candidates = candidates_by_basename(&gone, &fresh);

    changes.removed =
        gone.iter().map(|e| Removed { object: e.object, path: e.path.clone() }).collect();
    changes.added = fresh
        .iter()
        .map(|e| Added {
            path: e.entry.path.clone(),
            kind: e.entry.kind,
            size: e.entry.size,
            mtime: e.entry.mtime,
        })
        .collect();

    changes
}

/// Same path, different size or mtime.
///
/// A folder's size is always `None`, so only its mtime can change; that is
/// enough to say a directory's contents were touched.
fn is_touched(known: &Known, found: &Found) -> bool {
    known.size != found.entry.size || known.mtime != found.entry.mtime
}

/// Match disappearances against appearances by content hash, removing the
/// pairs it claims from both lists.
///
/// A hash present on both sides and unique on both sides is a move. A hash
/// appearing more than once on either side is not: the seed library has 43
/// redundant archives, so identical content under several paths is normal, and
/// pairing them arbitrarily would move an object somewhere the user did not
/// put it. Those fall through to a plain removal and addition.
fn pair_by_hash(gone: &mut Vec<&Known>, fresh: &mut Vec<&Found>) -> Vec<Moved> {
    let gone_by_hash = group_by_key(gone.iter().filter_map(|e| e.hash.as_deref().map(|h| (h, e.path.as_str()))));
    let fresh_by_hash = group_by_key(fresh.iter().filter_map(|e| e.hash.as_deref().map(|h| (h, e.entry.path.as_str()))));

    let mut moves = Vec::new();
    let mut claimed_from: HashSet<String> = HashSet::new();
    let mut claimed_to: HashSet<String> = HashSet::new();

    for (hash, from_paths) in &gone_by_hash {
        let Some(to_paths) = fresh_by_hash.get(hash) else {
            continue;
        };
        if from_paths.len() != 1 || to_paths.len() != 1 {
            continue; // ambiguous; let it read as a removal and an addition
        }

        let from = from_paths[0];
        let to = to_paths[0];
        let object = gone
            .iter()
            .find(|e| e.path == from)
            .map(|e| e.object)
            .expect("the path came from this list");

        moves.push(Moved { object, from: from.to_string(), to: to.to_string() });
        claimed_from.insert(from.to_string());
        claimed_to.insert(to.to_string());
    }

    gone.retain(|e| !claimed_from.contains(&e.path));
    fresh.retain(|e| !claimed_to.contains(&e.entry.path));

    moves.sort_by(|left, right| left.from.cmp(&right.from));
    moves
}

/// Group paths by whatever key was paired with them — a hash, or a basename.
///
/// The count matters as much as the grouping: a key with one path on each side
/// is a pairing, and a key with several is a question this module declines to
/// answer.
fn group_by_key<'a>(
    entries: impl Iterator<Item = (&'a str, &'a str)>,
) -> HashMap<&'a str, Vec<&'a str>> {
    let mut grouped: HashMap<&str, Vec<&str>> = HashMap::new();
    for (key, path) in entries {
        grouped.entry(key).or_default().push(path);
    }
    grouped
}

/// Suggest pairings for what is left, by basename.
///
/// Every one of the seed library's 174 moves kept its basename, so this catches
/// the common shape. It is a suggestion because 33 of those products are a
/// folder and a zip sharing a stem: a name match is not proof, and this module
/// does not act on it.
///
/// A basename appearing more than once on either side suggests nothing at all.
fn candidates_by_basename(gone: &[&Known], fresh: &[&Found]) -> Vec<MoveCandidate> {
    let gone_by_name = group_by_key(gone.iter().map(|e| (basename(&e.path), e.path.as_str())));
    let fresh_by_name =
        group_by_key(fresh.iter().map(|e| (basename(&e.entry.path), e.entry.path.as_str())));

    let mut candidates = Vec::new();

    for (name, from_paths) in &gone_by_name {
        let Some(to_paths) = fresh_by_name.get(name) else {
            continue;
        };
        if from_paths.len() != 1 || to_paths.len() != 1 {
            continue;
        }

        let from = from_paths[0];
        let object = gone
            .iter()
            .find(|e| e.path == from)
            .map(|e| e.object)
            .expect("the path came from this list");

        candidates.push(MoveCandidate {
            object,
            from: from.to_string(),
            to: to_paths[0].to_string(),
        });
    }

    candidates.sort_by(|left, right| left.from.cmp(&right.from));
    candidates
}

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, kind: Kind) -> Entry {
        Entry { path: path.to_string(), kind, size: Some(100), mtime: Some(1000) }
    }

    fn known(object: i64, path: &str, hash: Option<&str>) -> Known {
        Known {
            object,
            path: path.to_string(),
            kind: Kind::File,
            size: Some(100),
            mtime: Some(1000),
            hash: hash.map(str::to_string),
        }
    }

    fn found(path: &str, hash: Option<&str>) -> Found {
        Found { entry: entry(path, Kind::File), hash: hash.map(str::to_string) }
    }

    // --- nothing to do ----------------------------------------------------

    #[test]
    fn an_unchanged_library_reports_nothing() {
        let library = [known(1, "a.zip", Some("h1")), known(2, "b/c.pdf", Some("h2"))];
        let disk = [found("a.zip", Some("h1")), found("b/c.pdf", Some("h2"))];

        assert!(reconcile(&library, &disk).is_empty());
    }

    #[test]
    fn an_empty_library_sees_everything_as_new() {
        let disk = [found("a.zip", None), found("b.pdf", None)];
        let changes = reconcile(&[], &disk);

        assert_eq!(changes.added.len(), 2);
        assert!(changes.removed.is_empty());
        assert!(changes.moved.is_empty());
    }

    #[test]
    fn an_empty_disk_sees_everything_as_gone() {
        let library = [known(1, "a.zip", Some("h1"))];
        let changes = reconcile(&library, &[]);

        assert_eq!(changes.removed, [Removed { object: 1, path: "a.zip".into() }]);
        assert!(changes.added.is_empty());
    }

    // --- moves, on evidence -----------------------------------------------

    #[test]
    fn a_matching_hash_proves_a_move() {
        // The seed library's own reorganisation: 174 products regrouped.
        let library = [known(7, ".AASHAREE/TRINKETS/Endeavor_v1.0.4", Some("h1"))];
        let disk = [found("Accessory/Endeavor_v1.0.4", Some("h1"))];

        let changes = reconcile(&library, &disk);
        assert_eq!(changes.moved, [Moved {
            object: 7,
            from: ".AASHAREE/TRINKETS/Endeavor_v1.0.4".into(),
            to: "Accessory/Endeavor_v1.0.4".into(),
        }]);
        assert!(changes.added.is_empty());
        assert!(changes.removed.is_empty());
    }

    #[test]
    fn a_move_keeps_the_object_that_was_there() {
        // Getting this wrong loses every value and edge attached to it.
        let library = [known(42, "old/thing.zip", Some("h1"))];
        let disk = [found("new/thing.zip", Some("h1"))];

        assert_eq!(reconcile(&library, &disk).moved[0].object, 42);
    }

    #[test]
    fn several_moves_are_each_paired() {
        let library = [
            known(1, "old/a.zip", Some("h1")),
            known(2, "old/b.zip", Some("h2")),
        ];
        let disk = [found("new/b.zip", Some("h2")), found("new/a.zip", Some("h1"))];

        let changes = reconcile(&library, &disk);
        assert_eq!(changes.moved.len(), 2);
        assert_eq!(changes.moved[0].object, 1);
        assert_eq!(changes.moved[1].object, 2);
    }

    // --- moves it refuses to claim ----------------------------------------

    #[test]
    fn two_identical_files_moving_are_not_paired() {
        // A third of the seed library's archives are redundant copies, so
        // identical content under several paths is normal. Pairing them
        // arbitrarily would move an object somewhere the user did not put it.
        let library = [
            known(1, "old/copy-a.zip", Some("same")),
            known(2, "old/copy-b.zip", Some("same")),
        ];
        let disk = [found("new/copy-a.zip", Some("same")), found("new/copy-b.zip", Some("same"))];

        let changes = reconcile(&library, &disk);
        assert!(changes.moved.is_empty(), "an ambiguous pairing was claimed");
        assert_eq!(changes.removed.len(), 2);
        assert_eq!(changes.added.len(), 2);
    }

    #[test]
    fn a_move_with_no_hash_on_either_side_is_not_claimed() {
        // hash is null until computed, and a first scan has none.
        let library = [known(1, "old/thing.zip", None)];
        let disk = [found("new/thing.zip", None)];

        let changes = reconcile(&library, &disk);
        assert!(changes.moved.is_empty());
        assert_eq!(changes.removed.len(), 1);
        assert_eq!(changes.added.len(), 1);
    }

    #[test]
    fn a_hash_on_only_one_side_proves_nothing() {
        let library = [known(1, "old/thing.zip", Some("h1"))];
        let disk = [found("new/thing.zip", None)];

        assert!(reconcile(&library, &disk).moved.is_empty());
    }

    #[test]
    fn different_content_at_a_new_path_is_not_a_move() {
        let library = [known(1, "old/thing.zip", Some("h1"))];
        let disk = [found("new/thing.zip", Some("h2"))];

        let changes = reconcile(&library, &disk);
        assert!(changes.moved.is_empty());
        assert_eq!(changes.removed.len(), 1);
        assert_eq!(changes.added.len(), 1);
    }

    // --- candidates -------------------------------------------------------

    #[test]
    fn a_basename_match_with_no_hash_is_a_question_not_an_answer() {
        // All 174 of the seed library's moves kept their basename, so this is
        // the common shape -- but a name is not proof, so it is offered
        // rather than applied.
        let library = [known(1, ".MANUKA/Clothes/Mummy's veil.unitypackage", None)];
        let disk = [found("Accessory/Mummy's veil.unitypackage", None)];

        let changes = reconcile(&library, &disk);
        assert!(changes.moved.is_empty(), "a name match was treated as proof");
        assert_eq!(changes.candidates, [MoveCandidate {
            object: 1,
            from: ".MANUKA/Clothes/Mummy's veil.unitypackage".into(),
            to: "Accessory/Mummy's veil.unitypackage".into(),
        }]);

        // And it is still reported as a removal and an addition, so a caller
        // that ignores candidates is not left with a lost object.
        assert_eq!(changes.removed.len(), 1);
        assert_eq!(changes.added.len(), 1);
    }

    #[test]
    fn a_folder_and_its_zip_sharing_a_stem_suggest_nothing() {
        // 33 products in the seed library are exactly this pair. The
        // basenames differ by extension, so they do not collide -- but two
        // entries with the same basename on one side do.
        let library = [
            known(1, "old/AW KLASSIK MAID", None),
            known(2, "other/AW KLASSIK MAID", None),
        ];
        let disk = [found("new/AW KLASSIK MAID", None)];

        let changes = reconcile(&library, &disk);
        assert!(changes.candidates.is_empty(), "an ambiguous name was suggested");
    }

    #[test]
    fn a_candidate_is_not_a_change() {
        // A library with unanswered questions is not out of date.
        let library = [known(1, "old/thing.zip", None)];
        let disk = [found("new/thing.zip", None)];

        let changes = reconcile(&library, &disk);
        assert!(!changes.candidates.is_empty());
        assert!(!changes.is_empty(), "the removal and addition are still changes");
    }

    #[test]
    fn a_proven_move_produces_no_candidate() {
        let library = [known(1, "old/thing.zip", Some("h1"))];
        let disk = [found("new/thing.zip", Some("h1"))];

        let changes = reconcile(&library, &disk);
        assert_eq!(changes.moved.len(), 1);
        assert!(changes.candidates.is_empty());
    }

    // --- touched ----------------------------------------------------------

    #[test]
    fn a_changed_size_at_the_same_path_is_touched() {
        let library = [known(1, "a.zip", Some("h1"))];
        let disk = [Found {
            entry: Entry { path: "a.zip".into(), kind: Kind::File, size: Some(200), mtime: Some(1000) },
            hash: None,
        }];

        let changes = reconcile(&library, &disk);
        assert_eq!(changes.touched.len(), 1, "a rewritten file was not noticed");
        assert!(changes.moved.is_empty());
        assert!(changes.added.is_empty());
    }

    #[test]
    fn a_changed_mtime_at_the_same_path_is_touched() {
        let library = [known(1, "a.zip", Some("h1"))];
        let disk = [Found {
            entry: Entry { path: "a.zip".into(), kind: Kind::File, size: Some(100), mtime: Some(2000) },
            hash: None,
        }];

        assert_eq!(reconcile(&library, &disk).touched.len(), 1);
    }

    #[test]
    fn a_folder_whose_contents_changed_is_touched() {
        // A folder has no size, so mtime is all there is.
        let library = [Known {
            object: 1,
            path: "Clothing".into(),
            kind: Kind::Folder,
            size: None,
            mtime: Some(1000),
            hash: None,
        }];
        let disk = [Found {
            entry: Entry { path: "Clothing".into(), kind: Kind::Folder, size: None, mtime: Some(2000) },
            hash: None,
        }];

        assert_eq!(reconcile(&library, &disk).touched.len(), 1);
    }

    #[test]
    fn an_untouched_path_is_not_reported() {
        let library = [known(1, "a.zip", Some("h1"))];
        let disk = [found("a.zip", Some("h1"))];

        assert!(reconcile(&library, &disk).touched.is_empty());
    }

    // --- objects with several paths ---------------------------------------

    #[test]
    fn one_path_of_a_spanning_object_can_move_alone() {
        // An object holding a folder and its zip: the zip is archived
        // elsewhere and the folder stays.
        let library = [
            known(1, "Clothing/AW KLASSIK MAID", Some("folder-hash")),
            known(1, "Clothing/AW KLASSIK MAID.zip", Some("zip-hash")),
        ];
        let disk = [
            found("Clothing/AW KLASSIK MAID", Some("folder-hash")),
            found("Archives/AW KLASSIK MAID.zip", Some("zip-hash")),
        ];

        let changes = reconcile(&library, &disk);
        assert_eq!(changes.moved.len(), 1);
        assert_eq!(changes.moved[0].object, 1);
        assert_eq!(changes.moved[0].to, "Archives/AW KLASSIK MAID.zip");
        assert!(changes.touched.is_empty());
    }

    #[test]
    fn losing_one_path_of_a_spanning_object_is_a_removal_not_a_deletion() {
        // The object still has its other location; whether it should survive
        // is the caller's decision, and this module only reports the path.
        let library = [
            known(1, "Clothing/AW KLASSIK MAID", Some("h1")),
            known(1, "Clothing/AW KLASSIK MAID.zip", Some("h2")),
        ];
        let disk = [found("Clothing/AW KLASSIK MAID", Some("h1"))];

        let changes = reconcile(&library, &disk);
        assert_eq!(changes.removed, [Removed {
            object: 1,
            path: "Clothing/AW KLASSIK MAID.zip".into(),
        }]);
    }

    // --- determinism ------------------------------------------------------

    #[test]
    fn the_result_does_not_depend_on_input_order() {
        let library = [
            known(1, "old/a.zip", Some("h1")),
            known(2, "old/b.zip", Some("h2")),
            known(3, "stays.pdf", Some("h3")),
        ];
        let forward = [found("new/a.zip", Some("h1")), found("new/b.zip", Some("h2")), found("stays.pdf", Some("h3"))];
        let backward = [found("stays.pdf", Some("h3")), found("new/b.zip", Some("h2")), found("new/a.zip", Some("h1"))];

        assert_eq!(reconcile(&library, &forward).moved, reconcile(&library, &backward).moved);
    }

    #[test]
    fn a_whole_library_reorganisation_is_all_moves() {
        // The shape of the seed library's own history: every product
        // regrouped, none renamed, all content unchanged.
        let library: Vec<Known> = (0..20)
            .map(|n| known(n, &format!(".OLD/group/item{n}.zip"), Some(&format!("hash{n}"))))
            .collect();
        let disk: Vec<Found> = (0..20)
            .map(|n| found(&format!("Category/item{n}.zip"), Some(&format!("hash{n}"))))
            .collect();

        let changes = reconcile(&library, &disk);
        assert_eq!(changes.moved.len(), 20);
        assert!(changes.added.is_empty());
        assert!(changes.removed.is_empty());
    }
}
