//! Resolving many stored values down to the candidates for each field.
//!
//! Values are stored under namespaced paths, so one object can hold a local
//! `title` alongside what two different shops call it. Reading has to rank
//! them:
//!
//! ```text
//! title            "BE NATURAL (Lapwing)"   <- the local name wins
//! booth#1/title    "> BE NATURAL <"
//! gumroad#1/title  "BE NATURAL fullset"
//! ```
//!
//! The rule is one line: a bare field wins if it has a value; otherwise the
//! first non-empty same-named field in mount order takes it.
//!
//! Resolution keeps the values that lost. Search, sort and export read the
//! winner, but the UI is expected to show the local title large with the shop
//! title underneath, and to offer whichever of two prices is lower — and the
//! only way to do that without a second implementation of this rule living in
//! the frontend is to hand over the ranked candidates rather than the winner
//! alone. Which of them to display is the frontend's decision; this module has
//! no opinion about it.
//!
//! This runs in the backend because search, sort and export all need it, and
//! two implementations of one rule drift apart.
//!
//! Mount order arrives as an argument rather than being read from
//! configuration, which keeps this a pure function. Order is per library, and
//! it orders property *instances*, not property names: an object carrying both
//! `booth#1` and `booth#2` needs the two ranked against each other.

use std::collections::HashMap;

use crate::store::path::{ParseError, ValuePath};

/// One stored value, as it comes out of the `values` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredValue {
    pub path: String,
    pub value: String,
}

/// A mounted property instance, in the order the library mounts it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Mount<'a> {
    pub namespace: &'a str,
    pub instance: u32,
}

/// Where a resolved value came from.
///
/// The UI needs this to show that a title came from a shop rather than from
/// the user, and change review needs it to scope a diff to `booth#1/price`
/// rather than to the whole object.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin<'a> {
    /// A bare field, entered directly.
    Bare,
    /// A field belonging to one mounted property instance.
    Mounted { namespace: &'a str, instance: u32 },
}

/// One candidate for a field, with where it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved<'a> {
    pub value: &'a str,
    pub origin: Origin<'a>,
}

/// A stored value that resolution could not place.
///
/// Skipping is not the same as absence, and the caller has to be able to tell
/// them apart. An unmounted property is expected — an object may carry values
/// written by a plugin that is not installed right now. An unparseable path is
/// not expected: it means something wrote a malformed path, and the write side
/// cannot rule that out while `values.path` is free text fed by the import
/// contract and by plugins.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Skipped<'a> {
    pub path: &'a str,
    pub reason: SkipReason,
}

/// Why a stored value was not resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkipReason {
    /// The path does not parse. This is corruption; surface it.
    Malformed(ParseError),
    /// The path names a property this library does not mount. Expected.
    NotMounted,
}

/// The candidates for every field of one object, best first.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FlatView<'a> {
    fields: HashMap<&'a str, Vec<Resolved<'a>>>,
    skipped: Vec<Skipped<'a>>,
}

impl<'a> FlatView<'a> {
    /// The winning value for a field, which is what search, sort and export
    /// read.
    pub fn value(&self, field: &str) -> Option<&'a str> {
        self.candidates(field).first().map(|resolved| resolved.value)
    }

    /// The winning candidate, with its origin.
    pub fn winner(&self, field: &str) -> Option<&Resolved<'a>> {
        self.candidates(field).first()
    }

    /// Every candidate for a field, best first. Empty when the field has none.
    pub fn candidates(&self, field: &str) -> &[Resolved<'a>] {
        self.fields.get(field).map_or(&[], Vec::as_slice)
    }

    /// Every field that resolved to at least one value.
    pub fn fields(&self) -> impl Iterator<Item = &'a str> + '_ {
        self.fields.keys().copied()
    }

    /// Values that could not be placed. A `Malformed` entry here is a data
    /// defect worth reporting; `NotMounted` is routine.
    pub fn skipped(&self) -> &[Skipped<'a>] {
        &self.skipped
    }

    pub fn is_empty(&self) -> bool {
        self.fields.is_empty()
    }
}

/// Apply the flattening rule, keeping the losing candidates and reporting
/// what could not be placed.
///
/// Empty values are dropped rather than ranked: a blank is the absence of a
/// value, not a candidate that happens to be short.
pub fn flatten<'a>(values: &'a [StoredValue], mounts: &[Mount<'a>]) -> FlatView<'a> {
    // Mount ranks start at 1, leaving 0 to the bare field, which outranks
    // every mount. Sharing 0 would make the two tie, handing the decision to
    // whatever order the database returned rows in.
    let rank: HashMap<(&str, u32), usize> = mounts
        .iter()
        .enumerate()
        .map(|(position, mount)| ((mount.namespace, mount.instance), position + 1))
        .collect();

    let mut ranked: HashMap<&'a str, Vec<(usize, Resolved<'a>)>> = HashMap::new();
    let mut skipped = Vec::new();

    for stored in values {
        if stored.value.is_empty() {
            continue;
        }
        let path = match ValuePath::parse(&stored.path) {
            Ok(path) => path,
            Err(error) => {
                skipped.push(Skipped {
                    path: &stored.path,
                    reason: SkipReason::Malformed(error),
                });
                continue;
            }
        };

        let (rank, origin) = match (path.namespace, path.instance) {
            (None, _) => (BARE, Origin::Bare),
            (Some(namespace), Some(instance)) => match rank.get(&(namespace, instance)) {
                Some(&position) => (position, Origin::Mounted { namespace, instance }),
                None => {
                    skipped.push(Skipped {
                        path: &stored.path,
                        reason: SkipReason::NotMounted,
                    });
                    continue;
                }
            },
            // `parse` never yields a namespace without an instance.
            (Some(_), None) => continue,
        };

        ranked
            .entry(path.field)
            .or_default()
            .push((rank, Resolved { value: &stored.value, origin }));
    }

    let fields = ranked
        .into_iter()
        .map(|(field, mut candidates)| {
            // Stable, so two values at the same rank keep storage order rather
            // than swapping unpredictably between runs.
            candidates.sort_by_key(|(rank, _)| *rank);
            (field, candidates.into_iter().map(|(_, resolved)| resolved).collect())
        })
        .collect();

    FlatView { fields, skipped }
}

/// Bare fields outrank every mount. Mount ranks start at 1.
const BARE: usize = 0;

#[cfg(test)]
mod tests {
    use super::*;

    fn stored(path: &str, value: &str) -> StoredValue {
        StoredValue { path: path.to_string(), value: value.to_string() }
    }

    fn mount(namespace: &str, instance: u32) -> Mount<'_> {
        Mount { namespace, instance }
    }

    fn value<'a>(flat: &FlatView<'a>, field: &str) -> &'a str {
        flat.value(field).unwrap_or_else(|| panic!("{field} should be present"))
    }

    #[test]
    fn a_bare_field_wins_over_a_shop() {
        let values = [
            stored("title", "BE NATURAL (Lapwing)"),
            stored("booth#1/title", "> BE NATURAL <"),
        ];
        let flat = flatten(&values, &[mount("booth", 1)]);
        assert_eq!(value(&flat, "title"), "BE NATURAL (Lapwing)");
        assert_eq!(flat.winner("title").unwrap().origin, Origin::Bare);
    }

    #[test]
    fn a_bare_field_wins_regardless_of_storage_order() {
        // The bare field and the first mount must not tie: if they did, the
        // winner would be whichever row the database happened to return
        // first, which is not a decision anyone made.
        let mounts = [mount("booth", 1)];
        let shop_first = [stored("booth#1/title", "shop"), stored("title", "mine")];
        let bare_first = [stored("title", "mine"), stored("booth#1/title", "shop")];

        assert_eq!(value(&flatten(&shop_first, &mounts), "title"), "mine");
        assert_eq!(value(&flatten(&bare_first, &mounts), "title"), "mine");
    }

    #[test]
    fn an_empty_bare_field_falls_through() {
        let values = [stored("title", ""), stored("booth#1/title", "> BE NATURAL <")];
        let flat = flatten(&values, &[mount("booth", 1)]);
        assert_eq!(value(&flat, "title"), "> BE NATURAL <");
        assert_eq!(
            flat.winner("title").unwrap().origin,
            Origin::Mounted { namespace: "booth", instance: 1 }
        );
    }

    #[test]
    fn a_missing_bare_field_falls_through() {
        let values = [stored("booth#1/price", "2900")];
        let flat = flatten(&values, &[mount("booth", 1)]);
        assert_eq!(value(&flat, "price"), "2900");
    }

    #[test]
    fn mount_order_decides_between_two_shops() {
        let values = [stored("booth#1/price", "2900"), stored("gumroad#1/price", "2400")];

        let booth_first = [mount("booth", 1), mount("gumroad", 1)];
        assert_eq!(value(&flatten(&values, &booth_first), "price"), "2900");

        let gumroad_first = [mount("gumroad", 1), mount("booth", 1)];
        assert_eq!(value(&flatten(&values, &gumroad_first), "price"), "2400");
    }

    #[test]
    fn mount_order_decides_between_two_instances_of_one_property() {
        // Mount order ranks instances, not property names.
        let values = [stored("booth#1/price", "2900"), stored("booth#2/price", "2400")];
        let second_first = [mount("booth", 2), mount("booth", 1)];
        assert_eq!(value(&flatten(&values, &second_first), "price"), "2400");
    }

    #[test]
    fn an_empty_value_never_wins() {
        let values = [stored("booth#1/price", ""), stored("gumroad#1/price", "2400")];
        let mounts = [mount("booth", 1), mount("gumroad", 1)];
        assert_eq!(value(&flatten(&values, &mounts), "price"), "2400");
    }

    #[test]
    fn an_empty_value_is_not_a_candidate() {
        // A blank is the absence of a value, not a short candidate.
        let values = [stored("booth#1/price", ""), stored("gumroad#1/price", "2400")];
        let mounts = [mount("booth", 1), mount("gumroad", 1)];
        assert_eq!(flatten(&values, &mounts).candidates("price").len(), 1);
    }

    #[test]
    fn an_unmounted_property_is_not_read() {
        // An object can carry values from a plugin that is not installed.
        // They must not surface as if they were current.
        let values = [stored("booth#1/title", "shop")];
        assert!(flatten(&values, &[]).is_empty());
    }

    #[test]
    fn an_unmounted_property_does_not_shadow_a_mounted_one() {
        let values = [stored("booth#1/price", "2900"), stored("gumroad#1/price", "2400")];
        let flat = flatten(&values, &[mount("gumroad", 1)]);
        assert_eq!(value(&flat, "price"), "2400");
    }

    #[test]
    fn fields_are_independent() {
        // A local title and a shop price coexist on one object.
        let values = [
            stored("title", "BE NATURAL (Lapwing)"),
            stored("booth#1/title", "> BE NATURAL <"),
            stored("booth#1/price", "2900"),
        ];
        let flat = flatten(&values, &[mount("booth", 1)]);
        assert_eq!(value(&flat, "title"), "BE NATURAL (Lapwing)");
        assert_eq!(value(&flat, "price"), "2900");
    }

    #[test]
    fn the_worked_example_from_the_architecture_doc() {
        let values = [
            stored("title", "BE NATURAL (Lapwing)"),
            stored("note", "bought the fullset"),
            stored("booth#1/url", "https://booth.pm/ja/items/8264237"),
            stored("booth#1/title", "> BE NATURAL <"),
            stored("booth#1/price", "2900"),
            stored("vrchat#1/category", "clothing"),
        ];
        let flat = flatten(&values, &[mount("booth", 1), mount("vrchat", 1)]);

        assert_eq!(value(&flat, "title"), "BE NATURAL (Lapwing)");
        assert_eq!(value(&flat, "note"), "bought the fullset");
        assert_eq!(value(&flat, "url"), "https://booth.pm/ja/items/8264237");
        assert_eq!(value(&flat, "price"), "2900");
        assert_eq!(value(&flat, "category"), "clothing");
    }

    // --- candidates -------------------------------------------------------

    #[test]
    fn losing_candidates_are_kept_in_rank_order() {
        // The frontend shows the local title large with the shop title
        // underneath. It cannot do that from the winner alone, and deriving
        // it from raw paths would be a second copy of this rule.
        let values = [
            stored("title", "BE NATURAL (Lapwing)"),
            stored("booth#1/title", "> BE NATURAL <"),
            stored("gumroad#1/title", "BE NATURAL fullset"),
        ];
        let flat = flatten(&values, &[mount("booth", 1), mount("gumroad", 1)]);

        let titles: Vec<&str> = flat.candidates("title").iter().map(|c| c.value).collect();
        assert_eq!(
            titles,
            ["BE NATURAL (Lapwing)", "> BE NATURAL <", "BE NATURAL fullset"]
        );
    }

    #[test]
    fn candidates_carry_their_origin() {
        // "whichever of two prices is lower" needs to know which shop won.
        let values = [stored("booth#1/price", "2900"), stored("gumroad#1/price", "2400")];
        let flat = flatten(&values, &[mount("booth", 1), mount("gumroad", 1)]);

        let origins: Vec<Origin> = flat.candidates("price").iter().map(|c| c.origin).collect();
        assert_eq!(
            origins,
            [
                Origin::Mounted { namespace: "booth", instance: 1 },
                Origin::Mounted { namespace: "gumroad", instance: 1 },
            ]
        );
    }

    #[test]
    fn the_winner_is_the_first_candidate() {
        let values = [stored("booth#1/price", "2900"), stored("gumroad#1/price", "2400")];
        let flat = flatten(&values, &[mount("gumroad", 1), mount("booth", 1)]);
        assert_eq!(flat.value("price"), Some(flat.candidates("price")[0].value));
        assert_eq!(flat.value("price"), Some("2400"));
    }

    #[test]
    fn an_absent_field_has_no_candidates() {
        let flat = flatten(&[], &[]);
        assert_eq!(flat.value("title"), None);
        assert!(flat.candidates("title").is_empty());
    }

    // --- skipped ----------------------------------------------------------

    #[test]
    fn a_malformed_path_is_reported_not_swallowed() {
        // Corruption in values.path has to reach someone. The import contract
        // and plugins both write this column.
        let values = [stored("a/b/c", "junk"), stored("title", "mine")];
        let flat = flatten(&values, &[]);

        assert_eq!(value(&flat, "title"), "mine");
        assert_eq!(
            flat.skipped(),
            [Skipped {
                path: "a/b/c",
                reason: SkipReason::Malformed(ParseError::TooManySegments)
            }]
        );
    }

    #[test]
    fn a_malformed_path_does_not_stop_resolution() {
        // One bad row must not take down a library view.
        let values = [
            stored("booth#0/price", "bad instance"),
            stored("booth#1/price", "2900"),
        ];
        let flat = flatten(&values, &[mount("booth", 1)]);
        assert_eq!(value(&flat, "price"), "2900");
        assert_eq!(flat.skipped().len(), 1);
    }

    #[test]
    fn an_unmounted_property_is_reported_as_routine() {
        let values = [stored("booth#1/title", "shop")];
        let flat = flatten(&values, &[]);
        assert_eq!(
            flat.skipped(),
            [Skipped { path: "booth#1/title", reason: SkipReason::NotMounted }]
        );
    }

    #[test]
    fn nothing_is_skipped_when_everything_resolves() {
        let values = [stored("title", "mine"), stored("booth#1/price", "2900")];
        assert!(flatten(&values, &[mount("booth", 1)]).skipped().is_empty());
    }

    #[test]
    fn an_empty_value_is_not_reported_as_skipped() {
        // A blank is absence, not a defect worth surfacing.
        let values = [stored("title", "")];
        assert!(flatten(&values, &[]).skipped().is_empty());
    }
}
