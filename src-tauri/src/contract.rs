//! The shape of everything that crosses the library's edge.
//!
//! One contract serves three cases: exporting a library for an AI to read,
//! importing what it suggests, and moving between machines. A future MCP
//! server is a protocol wrapper over this rather than a second way into the
//! data — which only holds if the three really are one shape, so they are.
//!
//! # Fields are carried, not enumerated
//!
//! The seed library's own export shows why. Of 179 source records, `note`
//! appears on 38, `same_product_as` on 7, `reclassify` on 3. A struct with a
//! field per key would be mostly `Option::None`, and every plugin adding a
//! property would mean editing it.
//!
//! So a record carries value paths and values — the same pairs the `values_`
//! table holds. The core moves them without knowing what any of them mean,
//! exactly as it does everywhere else.
//!
//! # Imports are matched on path and are idempotent
//!
//! Importing the same export twice changes nothing the second time. That is
//! what makes an import safe to retry after a failure, and what lets an
//! exported-and-reimported library be a test of the round trip rather than a
//! source of spurious changes.
//!
//! # Every suggestion carries a reason
//!
//! Not decoration. During the manual cleanup a classifier repeatedly filed
//! outfits as editor tools because they bundled lilToon, and the mistake was
//! only obvious once the reasoning was visible. A suggestion whose reason
//! reads "contains Editor/*.cs" is one a person can reject on sight; the same
//! suggestion without it is one they have to investigate.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// The format version. Bumped when a change would make an older reader
/// misunderstand a document rather than merely miss part of it.
pub const VERSION: u32 = 1;

/// A whole library, or a batch of suggestions about one.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Document {
    pub version: u32,
    /// Where the objects came from, when it is worth recording — an export
    /// from another machine, a model's name, a shop.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub objects: Vec<ObjectRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub terms: Vec<TermRecord>,
}

impl Document {
    pub fn new() -> Self {
        Self { version: VERSION, ..Self::default() }
    }

    /// Read a document, refusing one this build cannot understand.
    ///
    /// A newer version is refused rather than read partially: a document from
    /// a later build may mean something different by a field this one knows,
    /// and silently importing three quarters of it is worse than declining.
    pub fn parse(json: &str) -> Result<Self, ContractError> {
        let document: Self =
            serde_json::from_str(json).map_err(|error| ContractError::Malformed(error.to_string()))?;

        if document.version > VERSION {
            return Err(ContractError::TooNew { found: document.version, understood: VERSION });
        }
        Ok(document)
    }

    pub fn to_json(&self) -> Result<String, ContractError> {
        serde_json::to_string_pretty(self)
            .map_err(|error| ContractError::Malformed(error.to_string()))
    }
}

/// One object: where it sits, what is hung on it, and what it points at.
///
/// Matched on `paths` first, then on `id`. A record naming a path the library
/// already has is that object; one naming a path it does not have is matched
/// by identifier, so importing the same document twice does not make two.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObjectRecord {
    /// Locations, relative to the library root. Empty for a grouping.
    ///
    /// Plain strings, and a location whose kind matters says so in
    /// [`Self::folders`]. Two fields rather than a list of structs because a
    /// path is what matching reads and the overwhelming majority of documents
    /// name files: making every writer spell out a kind to say the ordinary
    /// thing is a tax on the common case.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,

    /// Which of [`Self::paths`] are folders.
    ///
    /// An import can name a path that is not on disk yet, so the core cannot
    /// look to find out — and it is a claim rather than an observation either
    /// way. Whoever wrote the document knows: a plugin that walked the disk
    /// saw it, and an export is repeating what the library already recorded.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub folders: Vec<String>,
    /// A stable name for this object across imports.
    ///
    /// Paths are the first thing matched on, but an import can name an object
    /// that is not on disk yet — a product recorded before it is downloaded,
    /// or a grouping, which has no path at all. Without an identifier those
    /// match nothing on a second import and get created again, which is the
    /// idempotence the contract promises going quietly wrong.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Value paths to values: `title`, `booth#1/price`, `@pin/cover`. The same
    /// pairs the `values_` table holds.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub values: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edges: Vec<EdgeRecord>,
    /// Why this record says what it says. Required on anything a machine
    /// suggested; a plain export leaves it out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Something this object points at.
///
/// The two target forms are exclusive, as they are in the edge table. A record
/// naming both or neither is a defect in whatever wrote it, and
/// [`is_well_formed`](EdgeRecord::is_well_formed) reports that rather than
/// resolving it to a guess.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EdgeRecord {
    pub kind: String,
    /// A path, for an edge to another object.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object: Option<String>,
    /// `avatar:manuka`, for an edge to a vocabulary term.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub term: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl EdgeRecord {
    pub fn to_object(kind: &str, path: &str) -> Self {
        Self { kind: kind.to_string(), object: Some(path.to_string()), term: None, reason: None }
    }

    pub fn to_term(kind: &str, vocab: &str, term: &str) -> Self {
        Self {
            kind: kind.to_string(),
            object: None,
            term: Some(format!("{vocab}:{term}")),
            reason: None,
        }
    }

    /// The vocabulary and term this edge names, if it names one.
    pub fn term_parts(&self) -> Option<(&str, &str)> {
        self.term.as_deref()?.split_once(':')
    }

    /// True when exactly one target is named.
    pub fn is_well_formed(&self) -> bool {
        self.object.is_some() != self.term.is_some()
    }
}

/// One vocabulary term and its spellings.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TermRecord {
    pub vocab: String,
    pub id: String,
    pub label: String,
    /// Surface forms: `桔梗`, `Kikyo`, `Kikyou`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
}

/// Why a document could not be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContractError {
    /// Not valid JSON, or not this shape.
    Malformed(String),
    /// Written by a later build.
    TooNew { found: u32, understood: u32 },
}

impl std::fmt::Display for ContractError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Malformed(detail) => write!(f, "cannot read document: {detail}"),
            Self::TooNew { found, understood } => write!(
                f,
                "document is version {found}, this build understands {understood}"
            ),
        }
    }
}

impl std::error::Error for ContractError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn object(paths: &[&str], values: &[(&str, &str)]) -> ObjectRecord {
        ObjectRecord {
            paths: paths.iter().map(|p| p.to_string()).collect(),
            values: values
                .iter()
                .map(|(path, value)| (path.to_string(), value.to_string()))
                .collect(),
            ..ObjectRecord::default()
        }
    }

    // --- round trip -------------------------------------------------------

    #[test]
    fn a_document_survives_a_round_trip() {
        // Moving between machines is one of the three cases this serves; a
        // lossy round trip would silently drop values on every transfer.
        let mut document = Document::new();
        document.source = Some("another machine".into());
        document.objects.push(object(
            &["Clothing/BE NATURAL"],
            &[("title", "BE NATURAL (Lapwing)"), ("booth#1/price", "2900")],
        ));

        let json = document.to_json().expect("serialise");
        assert_eq!(Document::parse(&json).expect("parse"), document);
    }

    #[test]
    fn an_empty_document_round_trips() {
        let document = Document::new();
        assert_eq!(Document::parse(&document.to_json().expect("json")).expect("parse"), document);
    }

    #[test]
    fn absent_fields_stay_absent_in_the_json() {
        // A document that is mostly nulls is one a person cannot read, and
        // most fields are absent on most records.
        let mut document = Document::new();
        document.objects.push(object(&["a.zip"], &[("title", "thing")]));

        let json = document.to_json().expect("json");
        assert!(!json.contains("null"), "got: {json}");
        assert!(!json.contains("\"terms\""), "an empty list was written out");
        assert!(!json.contains("\"reason\""));
    }

    #[test]
    fn values_are_written_in_a_stable_order() {
        // Two exports of one library should diff cleanly, and "stable" has to
        // mean across runs rather than within one -- a hash map is consistent
        // inside a process and reshuffles between them, which would make every
        // export differ from the last for no reason.
        //
        // Inserted in reverse, so a map preserving insertion order fails too.
        // Eight keys rather than three: with three, an unordered map lands on
        // sorted order one run in six, and a test that only usually fails is
        // one that gets ignored.
        let mut document = Document::new();
        document.objects.push(object(
            &["a.zip"],
            &[
                ("hhh", "8"), ("ggg", "7"), ("fff", "6"), ("eee", "5"),
                ("ddd", "4"), ("ccc", "3"), ("bbb", "2"), ("aaa", "1"),
            ],
        ));

        let json = document.to_json().expect("json");
        let values = &json[json.find("\"values\"").expect("values block")..];

        let order: Vec<usize> = [
            "\"aaa\"", "\"bbb\"", "\"ccc\"", "\"ddd\"",
            "\"eee\"", "\"fff\"", "\"ggg\"", "\"hhh\"",
        ]
            .iter()
            .map(|key| values.find(key).unwrap_or_else(|| panic!("{key} missing")))
            .collect();

        assert!(
            order.windows(2).all(|pair| pair[0] < pair[1]),
            "values were not written in sorted order: {values}"
        );
    }

    // --- versioning -------------------------------------------------------

    #[test]
    fn a_newer_document_is_refused() {
        // A later build may mean something different by a field this one
        // knows, so importing three quarters of it is worse than declining.
        let json = format!(r#"{{"version": {}, "objects": []}}"#, VERSION + 1);

        assert_eq!(
            Document::parse(&json),
            Err(ContractError::TooNew { found: VERSION + 1, understood: VERSION })
        );
    }

    #[test]
    fn a_document_of_this_version_is_read() {
        let json = format!(r#"{{"version": {VERSION}, "objects": []}}"#);
        assert!(Document::parse(&json).is_ok());
    }

    #[test]
    fn an_unknown_field_does_not_stop_a_read() {
        // A later build adding a field a reader ignores is a compatible
        // change; refusing it would make every addition breaking.
        let json = format!(
            r#"{{"version": {VERSION}, "objects": [], "something_new": 42}}"#
        );
        assert!(Document::parse(&json).is_ok());
    }

    #[test]
    fn malformed_json_says_so() {
        assert!(matches!(Document::parse("{not json"), Err(ContractError::Malformed(_))));
    }

    #[test]
    fn an_error_reads_as_something_a_person_can_act_on() {
        let json = format!(r#"{{"version": {}, "objects": []}}"#, VERSION + 5);
        let message = Document::parse(&json).unwrap_err().to_string();

        assert!(message.contains("version"), "got: {message}");
        assert!(message.contains(&(VERSION + 5).to_string()));
    }

    // --- edges ------------------------------------------------------------

    #[test]
    fn an_edge_names_an_object_or_a_term() {
        let to_object = EdgeRecord::to_object("contains", "Clothing/outfit");
        let to_term = EdgeRecord::to_term("supports", "avatar", "manuka");

        assert!(to_object.is_well_formed());
        assert!(to_term.is_well_formed());
        assert_eq!(to_term.term_parts(), Some(("avatar", "manuka")));
        assert_eq!(to_object.term_parts(), None);
    }

    #[test]
    fn an_edge_naming_both_is_not_well_formed() {
        // The edge table refuses this; the contract reports it rather than
        // picking one.
        let confused = EdgeRecord {
            kind: "supports".into(),
            object: Some("a.zip".into()),
            term: Some("avatar:manuka".into()),
            reason: None,
        };
        assert!(!confused.is_well_formed());
    }

    #[test]
    fn an_edge_naming_neither_is_not_well_formed() {
        let empty = EdgeRecord {
            kind: "supports".into(),
            object: None,
            term: None,
            reason: None,
        };
        assert!(!empty.is_well_formed());
    }

    #[test]
    fn edges_survive_a_round_trip() {
        let mut document = Document::new();
        let mut record = object(&["outfit.zip"], &[]);
        record.edges.push(EdgeRecord::to_term("supports", "avatar", "manuka"));
        record.edges.push(EdgeRecord::to_object("requires", "mochifitter.zip"));
        document.objects.push(record);

        let parsed = Document::parse(&document.to_json().expect("json")).expect("parse");
        assert_eq!(parsed, document);
    }

    // --- reasons ----------------------------------------------------------

    #[test]
    fn a_suggestion_can_carry_why() {
        // A classifier filed outfits as editor tools because they bundled
        // lilToon. The mistake was only obvious once the reasoning showed.
        let mut record = object(&["Santa Outfit.zip"], &[("vrchat#1/category", "tool")]);
        record.reason = Some("contains Assets/**/Editor/*.cs".into());

        let mut document = Document::new();
        document.objects.push(record);

        let parsed = Document::parse(&document.to_json().expect("json")).expect("parse");
        assert_eq!(
            parsed.objects[0].reason.as_deref(),
            Some("contains Assets/**/Editor/*.cs")
        );
    }

    #[test]
    fn an_export_needs_no_reason() {
        // Reasons belong to suggestions. A plain export of what the library
        // already holds is not suggesting anything.
        let document = Document::new();
        assert!(!document.to_json().expect("json").contains("reason"));
    }

    // --- groupings --------------------------------------------------------

    #[test]
    fn an_object_with_no_path_carries_an_id_instead() {
        // A playlist or a collection has nothing on disk to match it by, so a
        // second import of one document must find it again by name.
        let mut record = ObjectRecord {
            id: Some("my-textures".into()),
            ..ObjectRecord::default()
        };
        record.values.insert("title".into(), "My texture collection".into());
        record.edges.push(EdgeRecord::to_object("contains", "Textures/skin.png"));

        let mut document = Document::new();
        document.objects.push(record);

        let parsed = Document::parse(&document.to_json().expect("json")).expect("parse");
        assert!(parsed.objects[0].paths.is_empty());
        assert_eq!(parsed.objects[0].id.as_deref(), Some("my-textures"));
    }

    // --- vocabularies -----------------------------------------------------

    #[test]
    fn a_term_carries_its_spellings() {
        let mut document = Document::new();
        document.terms.push(TermRecord {
            vocab: "avatar".into(),
            id: "kikyo".into(),
            label: "桔梗".into(),
            aliases: ["Kikyo", "Kikyou", "桔梗"].map(String::from).to_vec(),
        });

        let parsed = Document::parse(&document.to_json().expect("json")).expect("parse");
        assert_eq!(parsed.terms[0].aliases.len(), 3);
        assert_eq!(parsed.terms[0].label, "桔梗");
    }

    // --- the real data ----------------------------------------------------

    #[test]
    fn the_seed_librarys_shape_fits_the_contract() {
        // The point of defining this before the UI: the 174 real objects have
        // to be expressible, and their fields are uneven -- note appears on
        // 38 of 179 source records, same_product_as on 7, reclassify on 3. A
        // struct with a field per key would be mostly empty.
        let mut document = Document::new();
        document.source = Some("seed/sources.json".into());

        // A confirmed product with a shop page.
        document.objects.push(object(
            &[".AASHAREE/HAIR/Wolf Float"],
            &[
                ("booth#1/title", "【23アバター対応】Wolf Float Hair"),
                ("booth#1/vendor", "Pirouette"),
                ("booth#1/url", "https://booth.pm/ja/items/6467347"),
                ("booth#1/price", "1200"),
            ],
        ));

        // One whose source was never found: five of the 174. Recording it as
        // unknown is correct; inventing a plausible source is not.
        let mut unknown = object(&[".AASHAREE/CLOTHS/mystery"], &[("title", "mystery")]);
        unknown.reason = Some("no vendor path, no license pdf, no promo image".into());
        document.objects.push(unknown);

        // A product spanning a folder and the zip it came from: 43 of these.
        document.objects.push(object(
            &[
                ".AASHAREE/CLOTHS/AW KLASSIK MAID",
                ".AASHAREE/CLOTHS/AW KLASSIK MAID.zip",
            ],
            &[("title", "AW KLASSIK MAID")],
        ));

        let parsed = Document::parse(&document.to_json().expect("json")).expect("parse");
        assert_eq!(parsed, document);
        assert_eq!(parsed.objects[2].paths.len(), 2, "a spanning object lost a path");
    }

    #[test]
    fn a_product_on_two_shops_keeps_both() {
        // Flat storage cannot represent this at all, which is why values are
        // carried as paths rather than as named fields.
        let record = object(
            &["Clothing/BE NATURAL"],
            &[
                ("title", "BE NATURAL (Lapwing)"),
                ("booth#1/title", "▸ BE NATURAL ◂"),
                ("booth#1/price", "2900"),
                ("gumroad#1/title", "BE NATURAL fullset"),
                ("gumroad#1/price", "2400"),
                ("@pin/cover", "gumroad#1"),
            ],
        );

        let mut document = Document::new();
        document.objects.push(record);

        let parsed = Document::parse(&document.to_json().expect("json")).expect("parse");
        assert_eq!(parsed.objects[0].values.len(), 6);
        assert_eq!(parsed.objects[0].values.get("@pin/cover").map(String::as_str), Some("gumroad#1"));
    }
}
