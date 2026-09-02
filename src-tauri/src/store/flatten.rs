//! Resolving the stored values of one object into the sources for each field.
//!
//! A product sold on two shops has three titles, and all three are true:
//!
//! ```text
//! title            "BE NATURAL (Lapwing)"   what I call it
//! booth#1/title    "> BE NATURAL <"         what Booth calls it
//! gumroad#1/title  "BE NATURAL fullset"     what Gumroad calls it
//! ```
//!
//! Resolution does not pick one and discard the rest. It returns the sources
//! for a field, best first. Search, sort and export read the first; the detail
//! page can show them all, attributed. There are no losers, which is why
//! nothing here is named for winning.
//!
//! Fields do not compete unless a plugin says they do. A plugin declares which
//! of its fields contribute to a shared concept, and only those join the
//! sources for a bare name; everything else is read through its full path.
//! Isolation is the default because the alternative lets installing a plugin
//! silently change values the user is already looking at, on objects they
//! never touched.
//!
//! Among the sources for a shared field the rule is one line: a bare field wins
//! if it has a value, otherwise the first non-empty source in mount order. A
//! pin overrides that for one field on one object.
//!
//! This runs in the backend because search, sort and export all need it, and
//! two implementations of one rule drift apart.
//!
//! Mount order arrives as an argument rather than being read from
//! configuration, which keeps this a pure function. It ranks property
//! *instances*, not property names — an object carrying both `booth#1` and
//! `booth#2` needs the two ranked against each other — and it belongs to the
//! library, so the caller passes the order of the library being read.

use std::collections::HashMap;

use crate::store::path::{MountRef, ParseError, ValuePath};

/// The namespace pins are stored under. Reserved: no plugin may contribute a
/// pin on the user's behalf.
pub const PIN_NAMESPACE: &str = "@pin";

/// One stored value, as it comes out of the `values_` table.
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
    /// Fields this plugin declares as contributing to a shared concept. Only
    /// these join the sources for a bare field name; the rest are the
    /// plugin's own and are read through their full path.
    ///
    /// `String` rather than `&str` because these come from a manifest and from
    /// the database as owned strings; borrowing `&str` would put a conversion
    /// at every call site.
    pub shared: &'a [String],
}

impl<'a> Mount<'a> {
    /// A mount contributing nothing to shared fields.
    pub fn isolated(namespace: &'a str, instance: u32) -> Self {
        Self { namespace, instance, shared: &[] }
    }

    fn shares(&self, field: &str) -> bool {
        self.shared.iter().any(|name| name == field)
    }
}

/// Where a value came from.
///
/// Carried through so the UI can show that a title came from a shop rather
/// than from the user, and so change review can scope a diff to
/// `booth#1/price` rather than to the whole object.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin<'a> {
    /// A bare field, entered directly.
    Bare,
    /// A field belonging to one mounted property instance.
    Mounted { namespace: &'a str, instance: u32 },
}

/// One source for a field, with where it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Source<'a> {
    pub value: &'a str,
    pub origin: Origin<'a>,
}

/// A stored value that resolution could not place.
///
/// Skipping is not the same as absence, and the caller has to be able to tell
/// them apart. An unmounted property is expected — an object may carry values
/// written by a plugin that is not installed right now. An unparseable path is
/// not: it means something wrote a malformed path, and the write side cannot
/// rule that out while the import contract and plugins both write that column.
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
    /// A pin naming a source that is not mounted. The field falls through to
    /// mount order; the pin is kept, so reinstalling the plugin restores it.
    PinNotMounted,
    /// A pin on a field no mounted plugin shares. A field with a single source
    /// has no ordering to override, so the pin can never take effect — and a
    /// write that is accepted, stored and then ignored has to be visible.
    PinOnUnsharedField,
}

/// Which mounted property instance a private field belongs to.
pub type MountKey<'a> = (&'a str, u32);

/// The sources for every field of one object, best first.
///
/// Shared fields and plugin-private fields are held apart rather than sharing
/// a key space. The framework's object page renders the two differently — a
/// shared field is one row with its sources listed, a private field belongs
/// inside its plugin's region — and deciding which is which by looking for a
/// `/` in a string would be this module handing back a job it already did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FlatView<'a> {
    shared: HashMap<&'a str, Vec<Source<'a>>>,
    private: HashMap<MountKey<'a>, HashMap<&'a str, &'a str>>,
    skipped: Vec<Skipped<'a>>,
}

impl<'a> FlatView<'a> {
    /// The value shown first for a shared field, which is what search, sort
    /// and export read.
    pub fn value(&self, field: &str) -> Option<&'a str> {
        self.primary(field).map(|source| source.value)
    }

    /// The first source of a shared field, with its origin.
    pub fn primary(&self, field: &str) -> Option<&Source<'a>> {
        self.sources(field).first()
    }

    /// Every source for a shared field, best first. Empty when it has none.
    pub fn sources(&self, field: &str) -> &[Source<'a>] {
        self.shared.get(field).map_or(&[], Vec::as_slice)
    }

    /// Every shared field that resolved to at least one source.
    pub fn fields(&self) -> impl Iterator<Item = &'a str> + '_ {
        self.shared.keys().copied()
    }

    /// One plugin-private field. These never join a bare name, so they are
    /// addressed by the mount that owns them.
    pub fn plugin_value(&self, mount: MountKey<'a>, field: &str) -> Option<&'a str> {
        self.private.get(&mount)?.get(field).copied()
    }

    /// Every private field of one mount, for rendering that plugin's region.
    pub fn plugin_fields(
        &self,
        mount: MountKey<'a>,
    ) -> impl Iterator<Item = (&'a str, &'a str)> + '_ {
        self.private
            .get(&mount)
            .into_iter()
            .flat_map(|fields| fields.iter().map(|(name, value)| (*name, *value)))
    }

    /// Mounts that contributed at least one private field.
    pub fn plugin_mounts(&self) -> impl Iterator<Item = MountKey<'a>> + '_ {
        self.private.keys().copied()
    }

    /// Values that could not be placed. `Malformed`, `PinNotMounted` and
    /// `PinOnUnsharedField` are defects worth surfacing; `NotMounted` is
    /// routine.
    pub fn skipped(&self) -> &[Skipped<'a>] {
        &self.skipped
    }

    /// True when nothing resolved, shared or private.
    pub fn is_empty(&self) -> bool {
        self.shared.is_empty() && self.private.is_empty()
    }
}

/// Resolve one object's values into the sources for each field.
///
/// Empty values are dropped rather than ranked: a blank is the absence of a
/// value, not a source that happens to be short.
pub fn flatten<'a>(values: &'a [StoredValue], mounts: &[Mount<'a>]) -> FlatView<'a> {
    // Ranks are PINNED < BARE < mounts, and no two may share a value: a tie
    // hands the decision to whatever order the database returned rows in,
    // which is not a decision anyone made.
    let mounted: HashMap<MountKey<'a>, (usize, &Mount<'a>)> = mounts
        .iter()
        .enumerate()
        .map(|(position, mount)| {
            ((mount.namespace, mount.instance), (FIRST_MOUNT + position, mount))
        })
        .collect();

    let mut parsed = Vec::with_capacity(values.len());
    let mut pins: HashMap<&'a str, MountKey<'a>> = HashMap::new();
    let mut skipped = Vec::new();

    // One pass to parse, splitting pins from values. Parsing in both this and
    // a separate pin pass would leave two places deciding what a pin is.
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

        if path.namespace == Some(PIN_NAMESPACE) {
            // A pin's value names a source, not a value path: `gumroad#1`.
            match MountRef::parse(&stored.value) {
                Ok(target) => {
                    pins.insert(path.field, (target.namespace, target.instance));
                }
                Err(error) => skipped.push(Skipped {
                    path: &stored.path,
                    reason: SkipReason::Malformed(error),
                }),
            }
            continue;
        }
        parsed.push((stored, path));
    }

    let mut shared: HashMap<&'a str, Vec<(usize, Source<'a>)>> = HashMap::new();
    let mut private: HashMap<MountKey<'a>, HashMap<&'a str, &'a str>> = HashMap::new();
    let mut pins_landed: Vec<&'a str> = Vec::new();

    for (stored, path) in parsed {
        let (namespace, instance) = match (path.namespace, path.instance) {
            (None, _) => {
                shared
                    .entry(path.field)
                    .or_default()
                    .push((BARE, Source { value: &stored.value, origin: Origin::Bare }));
                continue;
            }
            (Some(namespace), Some(instance)) => (namespace, instance),
            // `parse` never yields a namespace without an instance.
            (Some(_), None) => continue,
        };

        let Some(&(rank, mount)) = mounted.get(&(namespace, instance)) else {
            skipped.push(Skipped { path: &stored.path, reason: SkipReason::NotMounted });
            continue;
        };

        if !mount.shares(path.field) {
            // Private to this plugin: never joins the sources for a bare name.
            private.entry((namespace, instance)).or_default().insert(path.field, &stored.value);
            continue;
        }

        let rank = match pins.get(path.field) {
            Some(&pinned) if pinned == (namespace, instance) => {
                pins_landed.push(path.field);
                PINNED
            }
            _ => rank,
        };
        shared.entry(path.field).or_default().push((
            rank,
            Source { value: &stored.value, origin: Origin::Mounted { namespace, instance } },
        ));
    }

    report_ineffective_pins(&pins, &pins_landed, &mounted, values, &mut skipped);

    let shared = shared
        .into_iter()
        .map(|(field, mut sources)| {
            // Stable, so equal ranks keep storage order rather than swapping
            // between runs. Under the (object_id, field_path) primary key two
            // values cannot tie, so this is defence rather than a live case.
            sources.sort_by_key(|(rank, _)| *rank);
            (field, sources.into_iter().map(|(_, source)| source).collect())
        })
        .collect();

    FlatView { shared, private, skipped }
}

/// Report pins that were stored but could not act.
///
/// A pin is a write the user made deliberately. Accepting it, storing it, and
/// then ignoring it without a word is the failure this module already fixed
/// once for malformed paths; the two reasons a pin can miss get the same
/// treatment. Neither is deleted, so the choice comes back if the plugin
/// returns or the field becomes shared.
fn report_ineffective_pins<'a>(
    pins: &HashMap<&'a str, MountKey<'a>>,
    landed: &[&'a str],
    mounted: &HashMap<MountKey<'a>, (usize, &Mount<'a>)>,
    values: &'a [StoredValue],
    skipped: &mut Vec<Skipped<'a>>,
) {
    for (&field, target) in pins {
        if landed.contains(&field) {
            continue;
        }
        // Why it missed depends only on the source it named: either that
        // source is gone, or it is present but does not contribute to this
        // field. Whether the field has other sources is beside the point.
        let reason = if mounted.contains_key(target) {
            SkipReason::PinOnUnsharedField
        } else {
            SkipReason::PinNotMounted
        };
        if let Some(stored) = pin_row(values, field) {
            skipped.push(Skipped { path: &stored.path, reason });
        }
    }
}

/// The stored row a pin came from, so the report can name its real path.
fn pin_row<'a>(values: &'a [StoredValue], field: &str) -> Option<&'a StoredValue> {
    values.iter().find(|stored| {
        ValuePath::parse(&stored.path)
            .is_ok_and(|path| path.namespace == Some(PIN_NAMESPACE) && path.field == field)
    })
}

/// A pinned source outranks everything, including a bare field: it is an
/// explicit choice about this object rather than a default.
const PINNED: usize = 0;

/// A bare field outranks every mount, but not a pin.
const BARE: usize = 1;

/// The first mount ranks below the bare field, and each later mount below the
/// one before it.
const FIRST_MOUNT: usize = 2;

#[cfg(test)]
mod tests {
    use super::*;

    fn stored(path: &str, value: &str) -> StoredValue {
        StoredValue { path: path.to_string(), value: value.to_string() }
    }

    /// Fields a shop plugin declares as shared, as a `'static` slice.
    ///
    /// Leaked rather than owned by the caller so the thirty-odd call sites
    /// below stay two arguments wide. A test process exits before a few dozen
    /// leaked bytes matter.
    fn shared_fields(names: &[&str]) -> &'static [String] {
        Box::leak(names.iter().map(|name| name.to_string()).collect::<Vec<_>>().into_boxed_slice())
    }

    /// A mount sharing what a shop plugin shares.
    fn shop(namespace: &str, instance: u32) -> Mount<'_> {
        Mount { namespace, instance, shared: shared_fields(&["title", "price", "url", "cover"]) }
    }

    fn value<'a>(flat: &FlatView<'a>, field: &str) -> &'a str {
        flat.value(field).unwrap_or_else(|| panic!("{field} should be present"))
    }

    // --- the ranking rule ------------------------------------------------

    #[test]
    fn a_bare_field_comes_before_a_shop() {
        let values = [
            stored("title", "BE NATURAL (Lapwing)"),
            stored("booth#1/title", "> BE NATURAL <"),
        ];
        let flat = flatten(&values, &[shop("booth", 1)]);
        assert_eq!(value(&flat, "title"), "BE NATURAL (Lapwing)");
        assert_eq!(flat.primary("title").unwrap().origin, Origin::Bare);
    }

    #[test]
    fn a_bare_field_comes_first_regardless_of_storage_order() {
        // The bare field and the first mount must not tie: if they did, the
        // order would be whichever row the database returned first, which is
        // not a decision anyone made.
        let mounts = [shop("booth", 1)];
        let shop_first = [stored("booth#1/title", "shop"), stored("title", "mine")];
        let bare_first = [stored("title", "mine"), stored("booth#1/title", "shop")];

        assert_eq!(value(&flatten(&shop_first, &mounts), "title"), "mine");
        assert_eq!(value(&flatten(&bare_first, &mounts), "title"), "mine");
    }

    #[test]
    fn an_empty_bare_field_falls_through() {
        let values = [stored("title", ""), stored("booth#1/title", "> BE NATURAL <")];
        let flat = flatten(&values, &[shop("booth", 1)]);
        assert_eq!(value(&flat, "title"), "> BE NATURAL <");
        assert_eq!(
            flat.primary("title").unwrap().origin,
            Origin::Mounted { namespace: "booth", instance: 1 }
        );
    }

    #[test]
    fn a_missing_bare_field_falls_through() {
        let values = [stored("booth#1/price", "2900")];
        let flat = flatten(&values, &[shop("booth", 1)]);
        assert_eq!(value(&flat, "price"), "2900");
    }

    #[test]
    fn mount_order_decides_between_two_shops() {
        let values = [stored("booth#1/price", "2900"), stored("gumroad#1/price", "2400")];

        let booth_first = [shop("booth", 1), shop("gumroad", 1)];
        assert_eq!(value(&flatten(&values, &booth_first), "price"), "2900");

        let gumroad_first = [shop("gumroad", 1), shop("booth", 1)];
        assert_eq!(value(&flatten(&values, &gumroad_first), "price"), "2400");
    }

    #[test]
    fn mount_order_ranks_instances_not_property_names() {
        let values = [stored("booth#1/price", "2900"), stored("booth#2/price", "2400")];
        let second_first = [shop("booth", 2), shop("booth", 1)];
        assert_eq!(value(&flatten(&values, &second_first), "price"), "2400");
    }

    #[test]
    fn an_empty_value_is_never_a_source() {
        // A blank is the absence of a value, not a short source.
        let values = [stored("booth#1/price", ""), stored("gumroad#1/price", "2400")];
        let mounts = [shop("booth", 1), shop("gumroad", 1)];
        let flat = flatten(&values, &mounts);
        assert_eq!(value(&flat, "price"), "2400");
        assert_eq!(flat.sources("price").len(), 1);
    }

    // --- sources ---------------------------------------------------------

    #[test]
    fn every_source_is_kept_in_rank_order() {
        // Three titles, all true. The detail page shows the local one large
        // with the shop titles underneath, and cannot do that from the first
        // alone.
        let values = [
            stored("title", "BE NATURAL (Lapwing)"),
            stored("booth#1/title", "> BE NATURAL <"),
            stored("gumroad#1/title", "BE NATURAL fullset"),
        ];
        let flat = flatten(&values, &[shop("booth", 1), shop("gumroad", 1)]);

        let titles: Vec<&str> = flat.sources("title").iter().map(|s| s.value).collect();
        assert_eq!(
            titles,
            ["BE NATURAL (Lapwing)", "> BE NATURAL <", "BE NATURAL fullset"]
        );
    }

    #[test]
    fn sources_carry_their_origin() {
        // "whichever of two prices is lower" needs to know which shop each is.
        let values = [stored("booth#1/price", "2900"), stored("gumroad#1/price", "2400")];
        let flat = flatten(&values, &[shop("booth", 1), shop("gumroad", 1)]);

        let origins: Vec<Origin> = flat.sources("price").iter().map(|s| s.origin).collect();
        assert_eq!(
            origins,
            [
                Origin::Mounted { namespace: "booth", instance: 1 },
                Origin::Mounted { namespace: "gumroad", instance: 1 },
            ]
        );
    }

    #[test]
    fn the_primary_is_the_first_source() {
        let values = [stored("booth#1/price", "2900"), stored("gumroad#1/price", "2400")];
        let flat = flatten(&values, &[shop("gumroad", 1), shop("booth", 1)]);
        assert_eq!(flat.value("price"), Some(flat.sources("price")[0].value));
        assert_eq!(flat.value("price"), Some("2400"));
    }

    #[test]
    fn an_absent_field_has_no_sources() {
        let flat = flatten(&[], &[]);
        assert_eq!(flat.value("title"), None);
        assert!(flat.sources("title").is_empty());
    }

    #[test]
    fn fields_are_independent() {
        let values = [
            stored("title", "BE NATURAL (Lapwing)"),
            stored("booth#1/title", "> BE NATURAL <"),
            stored("booth#1/price", "2900"),
        ];
        let flat = flatten(&values, &[shop("booth", 1)]);
        assert_eq!(value(&flat, "title"), "BE NATURAL (Lapwing)");
        assert_eq!(value(&flat, "price"), "2900");
    }

    // --- sharing ---------------------------------------------------------

    #[test]
    fn an_undeclared_field_does_not_join_the_bare_name() {
        // item_id is Booth's own. Installing Booth must not put a value into
        // a field called `item_id` that anything else might read.
        let values = [stored("booth#1/item_id", "8264237")];
        let flat = flatten(&values, &[shop("booth", 1)]);

        assert_eq!(flat.value("item_id"), None);
        assert_eq!(flat.plugin_value(("booth", 1), "item_id"), Some("8264237"));
    }

    #[test]
    fn an_undeclared_field_does_not_shadow_a_bare_one() {
        // The failure isolation exists to prevent: a plugin quietly changing
        // a value the user is already looking at.
        let values = [stored("note", "mine"), stored("booth#1/note", "theirs")];
        let flat = flatten(&values, &[shop("booth", 1)]);

        assert_eq!(value(&flat, "note"), "mine");
        assert_eq!(flat.sources("note").len(), 1);
        assert_eq!(flat.plugin_value(("booth", 1), "note"), Some("theirs"));
    }

    #[test]
    fn two_plugins_sharing_a_name_group_implicitly() {
        // No central registry: declaring the same string is what joins them.
        let values = [stored("booth#1/price", "2900"), stored("gumroad#1/price", "2400")];
        let flat = flatten(&values, &[shop("booth", 1), shop("gumroad", 1)]);
        assert_eq!(flat.sources("price").len(), 2);
    }

    #[test]
    fn one_plugin_can_share_some_fields_and_not_others() {
        let values = [stored("booth#1/price", "2900"), stored("booth#1/shop_id", "77")];
        let flat = flatten(&values, &[shop("booth", 1)]);

        assert_eq!(flat.value("price"), Some("2900"));
        assert_eq!(flat.value("shop_id"), None);
        assert_eq!(flat.plugin_value(("booth", 1), "shop_id"), Some("77"));
    }

    #[test]
    fn a_mount_sharing_nothing_keeps_every_field_to_itself() {
        let values = [stored("pdf#1/pages", "12")];
        let flat = flatten(&values, &[Mount::isolated("pdf", 1)]);

        assert_eq!(flat.value("pages"), None);
        assert_eq!(flat.plugin_value(("pdf", 1), "pages"), Some("12"));
    }

    // --- pins ------------------------------------------------------------

    #[test]
    fn a_pin_overrides_mount_order() {
        // Booth ranks first library-wide, but this object's Booth cover is
        // poor and the user pinned the Gumroad one.
        let values = [
            stored("booth#1/cover", "booth.jpg"),
            stored("gumroad#1/cover", "gumroad.jpg"),
            stored("@pin/cover", "gumroad#1"),
        ];
        let flat = flatten(&values, &[shop("booth", 1), shop("gumroad", 1)]);
        assert_eq!(value(&flat, "cover"), "gumroad.jpg");
    }

    #[test]
    fn a_pin_outranks_a_bare_field() {
        // A pin is an explicit choice about this object; a bare field is only
        // the default.
        let values = [
            stored("title", "mine"),
            stored("booth#1/title", "shop"),
            stored("@pin/title", "booth#1"),
        ];
        let flat = flatten(&values, &[shop("booth", 1)]);
        assert_eq!(value(&flat, "title"), "shop");
    }

    #[test]
    fn a_pin_reorders_rather_than_discards() {
        // The other sources stay visible; the detail page still shows both.
        let values = [
            stored("booth#1/cover", "booth.jpg"),
            stored("gumroad#1/cover", "gumroad.jpg"),
            stored("@pin/cover", "gumroad#1"),
        ];
        let flat = flatten(&values, &[shop("booth", 1), shop("gumroad", 1)]);

        let covers: Vec<&str> = flat.sources("cover").iter().map(|s| s.value).collect();
        assert_eq!(covers, ["gumroad.jpg", "booth.jpg"]);
    }

    #[test]
    fn a_pin_affects_only_the_field_it_names() {
        let values = [
            stored("booth#1/cover", "booth.jpg"),
            stored("booth#1/price", "2900"),
            stored("gumroad#1/cover", "gumroad.jpg"),
            stored("gumroad#1/price", "2400"),
            stored("@pin/cover", "gumroad#1"),
        ];
        let flat = flatten(&values, &[shop("booth", 1), shop("gumroad", 1)]);

        assert_eq!(value(&flat, "cover"), "gumroad.jpg");
        assert_eq!(value(&flat, "price"), "2900");
    }

    #[test]
    fn a_pin_is_not_itself_a_field() {
        let values = [stored("booth#1/cover", "booth.jpg"), stored("@pin/cover", "booth#1")];
        let flat = flatten(&values, &[shop("booth", 1)]);

        let fields: Vec<&str> = flat.fields().collect();
        assert_eq!(fields, ["cover"]);
    }

    // --- skipped ---------------------------------------------------------

    #[test]
    fn a_malformed_path_is_reported_not_swallowed() {
        // Corruption has to reach someone: the import contract and plugins
        // both write this column.
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
        let flat = flatten(&values, &[shop("booth", 1)]);
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
    fn an_unmounted_property_is_not_read() {
        let values = [stored("booth#1/title", "shop")];
        let flat = flatten(&values, &[]);
        assert!(flat.is_empty());
        assert_eq!(flat.value("title"), None);
    }

    #[test]
    fn an_unmounted_property_does_not_shadow_a_mounted_one() {
        let values = [stored("booth#1/price", "2900"), stored("gumroad#1/price", "2400")];
        let flat = flatten(&values, &[shop("gumroad", 1)]);
        assert_eq!(value(&flat, "price"), "2400");
    }

    #[test]
    fn nothing_is_skipped_when_everything_resolves() {
        let values = [stored("title", "mine"), stored("booth#1/price", "2900")];
        assert!(flatten(&values, &[shop("booth", 1)]).skipped().is_empty());
    }

    #[test]
    fn an_empty_value_is_not_reported_as_skipped() {
        let values = [stored("title", "")];
        assert!(flatten(&values, &[]).skipped().is_empty());
    }

    // --- the worked example ----------------------------------------------

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
        let vrchat = Mount { namespace: "vrchat", instance: 1, shared: &[] };
        let flat = flatten(&values, &[shop("booth", 1), vrchat]);

        assert_eq!(value(&flat, "title"), "BE NATURAL (Lapwing)");
        assert_eq!(value(&flat, "note"), "bought the fullset");
        assert_eq!(value(&flat, "url"), "https://booth.pm/ja/items/8264237");
        assert_eq!(value(&flat, "price"), "2900");
        // category is vrchat's own, not shared with anyone.
        assert_eq!(flat.plugin_value(("vrchat", 1), "category"), Some("clothing"));
    }

    // --- pins that cannot act --------------------------------------------

    #[test]
    fn a_pin_to_an_unmounted_source_is_reported() {
        // The plugin was uninstalled. The field falls through, and the user
        // hears about it rather than wondering why their choice stopped
        // working.
        let values = [
            stored("booth#1/cover", "booth.jpg"),
            stored("@pin/cover", "gumroad#1"),
        ];
        let flat = flatten(&values, &[shop("booth", 1)]);

        assert_eq!(value(&flat, "cover"), "booth.jpg");
        assert_eq!(
            flat.skipped(),
            [Skipped { path: "@pin/cover", reason: SkipReason::PinNotMounted }]
        );
    }

    #[test]
    fn a_pin_on_a_field_nobody_shares_is_reported() {
        // item_id is Booth's own, so there is no ordering for a pin to
        // override. Accepting the write and ignoring it forever is the
        // failure this reporting exists to prevent.
        let values = [
            stored("booth#1/item_id", "111"),
            stored("gumroad#1/item_id", "222"),
            stored("@pin/item_id", "gumroad#1"),
        ];
        let flat = flatten(&values, &[shop("booth", 1), shop("gumroad", 1)]);

        assert_eq!(flat.plugin_value(("booth", 1), "item_id"), Some("111"));
        assert_eq!(flat.plugin_value(("gumroad", 1), "item_id"), Some("222"));
        assert_eq!(
            flat.skipped(),
            [Skipped { path: "@pin/item_id", reason: SkipReason::PinOnUnsharedField }]
        );
    }

    #[test]
    fn a_pin_to_a_source_that_does_not_share_the_field_is_reported() {
        // booth shares title; vrchat is mounted but shares nothing. Pinning
        // title to vrchat can never take effect.
        let values = [
            stored("booth#1/title", "booth title"),
            stored("vrchat#1/title", "vrc title"),
            stored("@pin/title", "vrchat#1"),
        ];
        let flat = flatten(&values, &[shop("booth", 1), Mount::isolated("vrchat", 1)]);

        assert_eq!(value(&flat, "title"), "booth title");
        assert_eq!(
            flat.skipped(),
            [Skipped { path: "@pin/title", reason: SkipReason::PinOnUnsharedField }]
        );
    }

    #[test]
    fn a_pin_that_lands_is_not_reported() {
        let values = [
            stored("booth#1/cover", "booth.jpg"),
            stored("gumroad#1/cover", "gumroad.jpg"),
            stored("@pin/cover", "gumroad#1"),
        ];
        let flat = flatten(&values, &[shop("booth", 1), shop("gumroad", 1)]);

        assert_eq!(value(&flat, "cover"), "gumroad.jpg");
        assert!(flat.skipped().is_empty());
    }

    #[test]
    fn a_malformed_pin_target_is_reported_as_corruption() {
        let values = [
            stored("booth#1/cover", "booth.jpg"),
            stored("@pin/cover", "not a mount ref"),
        ];
        let flat = flatten(&values, &[shop("booth", 1)]);

        assert_eq!(value(&flat, "cover"), "booth.jpg");
        assert_eq!(flat.skipped().len(), 1);
        assert!(matches!(flat.skipped()[0].reason, SkipReason::Malformed(_)));
    }

    // --- the two key spaces ----------------------------------------------

    #[test]
    fn shared_and_private_fields_do_not_share_a_key_space() {
        // The object page renders the two differently, so telling them apart
        // must not require parsing a string.
        let values = [
            stored("title", "mine"),
            stored("booth#1/title", "shop"),
            stored("booth#1/item_id", "8264237"),
        ];
        let flat = flatten(&values, &[shop("booth", 1)]);

        let shared: Vec<&str> = flat.fields().collect();
        assert_eq!(shared, ["title"]);

        let mounts: Vec<MountKey> = flat.plugin_mounts().collect();
        assert_eq!(mounts, [("booth", 1)]);

        let private: Vec<(&str, &str)> = flat.plugin_fields(("booth", 1)).collect();
        assert_eq!(private, [("item_id", "8264237")]);
    }

    #[test]
    fn a_mount_with_no_private_fields_is_not_listed() {
        let values = [stored("booth#1/title", "shop")];
        let flat = flatten(&values, &[shop("booth", 1)]);
        assert_eq!(flat.plugin_mounts().count(), 0);
    }

    #[test]
    fn private_fields_of_two_instances_stay_apart() {
        let values = [
            stored("booth#1/item_id", "111"),
            stored("booth#2/item_id", "222"),
        ];
        let flat = flatten(&values, &[shop("booth", 1), shop("booth", 2)]);

        assert_eq!(flat.plugin_value(("booth", 1), "item_id"), Some("111"));
        assert_eq!(flat.plugin_value(("booth", 2), "item_id"), Some("222"));
    }

    #[test]
    fn an_object_with_only_private_fields_is_not_empty() {
        let values = [stored("pdf#1/pages", "12")];
        let flat = flatten(&values, &[Mount::isolated("pdf", 1)]);

        assert!(!flat.is_empty());
        assert_eq!(flat.fields().count(), 0);
    }

}
