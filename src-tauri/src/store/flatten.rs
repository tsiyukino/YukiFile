//! Resolving many stored values down to one value per field.
//!
//! Values are stored under namespaced paths, so one object can hold a local
//! `title` alongside what two different shops call it. Reading has to pick one:
//!
//! ```text
//! title            "BE NATURAL (Lapwing)"   <- the local name wins
//! booth#1/title    "> BE NATURAL <"
//! gumroad#1/title  "BE NATURAL fullset"
//! ```
//!
//! The rule is one line: a bare field wins if it has a value; otherwise take
//! the first non-empty same-named field in mount order.
//!
//! This runs in the backend rather than the frontend because search, sort and
//! export all need it, and two implementations of one rule drift apart. The
//! frontend still receives the raw values and is free to render both the local
//! and the shop title; that is display logic and this module has no opinion
//! about it.
//!
//! Mount order arrives as an argument rather than being read from
//! configuration, which keeps this a pure function. Order is per library, so
//! the caller supplies the order belonging to the library being read.

use std::collections::HashMap;

use crate::store::path::ValuePath;

/// One stored value, as it comes out of the `values` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredValue {
    pub path: String,
    pub value: String,
}

/// Where a flattened value came from.
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

/// A field after resolution, with the value that won and where it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved<'a> {
    pub value: &'a str,
    pub origin: Origin<'a>,
}

/// One value per field name.
pub type FlatView<'a> = HashMap<&'a str, Resolved<'a>>;

/// A mounted property instance, in the order the library mounts it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Mount<'a> {
    pub namespace: &'a str,
    pub instance: u32,
}

/// Apply the flattening rule.
///
/// Unparseable paths and values belonging to a property the library does not
/// mount are skipped: an object can carry values from a plugin that is not
/// installed right now, and those must not surface as if they were current.
/// They stay in storage untouched, so installing the plugin brings them back.
pub fn flatten<'a>(values: &'a [StoredValue], mounts: &[Mount<'a>]) -> FlatView<'a> {
    let mut flat: FlatView<'a> = HashMap::new();
    // Rank by position so a later candidate only wins if it ranks lower.
    // Mount ranks start at 1, leaving 0 to the bare field, which outranks
    // every mount.
    let rank: HashMap<(&str, u32), usize> = mounts
        .iter()
        .enumerate()
        .map(|(i, m)| ((m.namespace, m.instance), i + 1))
        .collect();

    // Tracks how good the current winner is. A bare field is unbeatable.
    let mut best: HashMap<&str, usize> = HashMap::new();

    for stored in values {
        if stored.value.is_empty() {
            continue;
        }
        let Ok(path) = ValuePath::parse(&stored.path) else {
            continue;
        };

        let (candidate_rank, origin) = match (path.namespace, path.instance) {
            (None, _) => (BARE, Origin::Bare),
            (Some(namespace), Some(instance)) => {
                let Some(&position) = rank.get(&(namespace, instance)) else {
                    continue;
                };
                (position, Origin::Mounted { namespace, instance })
            }
            // `parse` never yields a namespace without an instance.
            (Some(_), None) => continue,
        };

        let incumbent = best.get(path.field).copied().unwrap_or(usize::MAX);
        if candidate_rank < incumbent {
            best.insert(path.field, candidate_rank);
            flat.insert(path.field, Resolved { value: &stored.value, origin });
        }
    }

    flat
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
        flat.get(field).unwrap_or_else(|| panic!("{field} should be present")).value
    }

    #[test]
    fn a_bare_field_wins_over_a_shop() {
        let values = [
            stored("title", "BE NATURAL (Lapwing)"),
            stored("booth#1/title", "> BE NATURAL <"),
        ];
        let flat = flatten(&values, &[mount("booth", 1)]);
        assert_eq!(value(&flat, "title"), "BE NATURAL (Lapwing)");
        assert_eq!(flat["title"].origin, Origin::Bare);
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
            flat["title"].origin,
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
    fn an_unparseable_path_is_skipped() {
        let values = [stored("a/b/c", "junk"), stored("title", "mine")];
        let flat = flatten(&values, &[]);
        assert_eq!(value(&flat, "title"), "mine");
        assert_eq!(flat.len(), 1);
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
}
