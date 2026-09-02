//! Loading plugins and working out what order they can start in.
//!
//! The core is an arbiter. It reads what each plugin declares, checks that
//! everything required is provided by something, and hands back a load order.
//! It never asks a plugin to identify itself beyond its manifest, and it has
//! no branch anywhere that names a specific plugin — a test enforces that.
//!
//! # Resolution is by property, so providers are interchangeable
//!
//! A plugin requiring `vrchat` is satisfied by whichever plugin contributes
//! `vrchat`. The resolver never sees a plugin id on the requiring side, so
//! swapping one provider for another is not a migration.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::plugin::manifest::{Manifest, ManifestError};

/// The plugins a library has loaded.
#[derive(Debug, Default)]
pub struct Registry {
    plugins: Vec<Manifest>,
}

/// Why a set of plugins could not be loaded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegistryError {
    /// Two plugins claim one id.
    DuplicateId(String),
    /// Two plugins define one property. Not arbitrated: a property is a
    /// contract, and two definitions of one contract means one of them is
    /// about to surprise somebody.
    DuplicateProperty { property: String, first: String, second: String },
    /// Something requires a property nothing provides.
    Unsatisfied { plugin: String, property: String },
    /// Plugins require each other, directly or through a chain, so no order
    /// starts them all.
    Circular(Vec<String>),
    Manifest { plugin: String, error: ManifestError },
}

impl std::fmt::Display for RegistryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DuplicateId(id) => write!(f, "two plugins claim the id {id:?}"),
            Self::DuplicateProperty { property, first, second } => write!(
                f,
                "{first:?} and {second:?} both define the property {property:?}"
            ),
            Self::Unsatisfied { plugin, property } => {
                write!(f, "{plugin:?} requires {property:?}, which nothing provides")
            }
            Self::Circular(chain) => {
                write!(f, "these plugins require each other: {}", chain.join(" -> "))
            }
            Self::Manifest { plugin, error } => write!(f, "{plugin:?}: {error}"),
        }
    }
}

impl std::error::Error for RegistryError {}

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Load a set of manifests, or explain why they cannot be.
    ///
    /// All or nothing. A partly loaded set is a library where some objects
    /// have panels and others do not for reasons nobody can see.
    pub fn load(manifests: Vec<Manifest>) -> Result<Self, RegistryError> {
        for manifest in &manifests {
            manifest.check().map_err(|error| RegistryError::Manifest {
                plugin: manifest.id.clone(),
                error,
            })?;
        }

        let mut seen_ids: BTreeSet<&str> = BTreeSet::new();
        for manifest in &manifests {
            if !seen_ids.insert(&manifest.id) {
                return Err(RegistryError::DuplicateId(manifest.id.clone()));
            }
        }

        let providers = providers_of(&manifests)?;

        for manifest in &manifests {
            for property in &manifest.requires.properties {
                if !providers.contains_key(property.as_str()) {
                    return Err(RegistryError::Unsatisfied {
                        plugin: manifest.id.clone(),
                        property: property.clone(),
                    });
                }
            }
        }

        let ordered = order(&manifests, &providers)?;
        Ok(Self { plugins: ordered })
    }

    /// Plugins in an order where everything required is already loaded.
    pub fn plugins(&self) -> &[Manifest] {
        &self.plugins
    }

    /// The plugin defining a property, if one does.
    pub fn provider_of(&self, property: &str) -> Option<&Manifest> {
        self.plugins
            .iter()
            .find(|plugin| plugin.contributes.properties.iter().any(|p| p == property))
    }

    /// Every plugin scoped to a property, in load order.
    ///
    /// This is what a region asks: who has something to show for `booth`? A
    /// plugin that requires the property is included, because requiring it is
    /// what buys the right to contribute into its region.
    pub fn scoped_to<'a>(&'a self, property: &'a str) -> impl Iterator<Item = &'a Manifest> {
        self.plugins.iter().filter(move |plugin| plugin.scope().any(|p| p == property))
    }

    /// Fields declared shared, by the property instance that declares them.
    ///
    /// What `flatten` needs to know which fields compete for a bare name.
    pub fn shared_fields(&self) -> BTreeMap<&str, &[String]> {
        self.plugins
            .iter()
            .flat_map(|plugin| {
                plugin
                    .contributes
                    .properties
                    .iter()
                    .map(move |property| (property.as_str(), plugin.contributes.shared.as_slice()))
            })
            .collect()
    }
}

/// Which plugin defines each property.
fn providers_of(manifests: &[Manifest]) -> Result<HashMap<&str, &str>, RegistryError> {
    let mut providers: HashMap<&str, &str> = HashMap::new();

    for manifest in manifests {
        for property in &manifest.contributes.properties {
            if let Some(first) = providers.insert(property, &manifest.id) {
                return Err(RegistryError::DuplicateProperty {
                    property: property.clone(),
                    first: first.to_string(),
                    second: manifest.id.clone(),
                });
            }
        }
    }
    Ok(providers)
}

/// Sort so that everything a plugin requires loads before it.
///
/// Depth-first, reporting a cycle rather than looping. Two plugins requiring
/// each other's properties have no valid order, and saying so names both.
fn order(
    manifests: &[Manifest],
    providers: &HashMap<&str, &str>,
) -> Result<Vec<Manifest>, RegistryError> {
    let by_id: HashMap<&str, &Manifest> =
        manifests.iter().map(|m| (m.id.as_str(), m)).collect();

    let mut ordered: Vec<Manifest> = Vec::with_capacity(manifests.len());
    let mut done: BTreeSet<String> = BTreeSet::new();
    let mut visiting: Vec<String> = Vec::new();

    for manifest in manifests {
        visit(&manifest.id, &by_id, providers, &mut done, &mut visiting, &mut ordered)?;
    }
    Ok(ordered)
}

fn visit(
    id: &str,
    by_id: &HashMap<&str, &Manifest>,
    providers: &HashMap<&str, &str>,
    done: &mut BTreeSet<String>,
    visiting: &mut Vec<String>,
    ordered: &mut Vec<Manifest>,
) -> Result<(), RegistryError> {
    if done.contains(id) {
        return Ok(());
    }
    if let Some(at) = visiting.iter().position(|seen| seen == id) {
        let mut chain: Vec<String> = visiting[at..].to_vec();
        chain.push(id.to_string());
        return Err(RegistryError::Circular(chain));
    }

    let Some(manifest) = by_id.get(id).copied() else {
        return Ok(());
    };

    // Owned rather than borrowed: the recursion is single digits deep, and
    // a few string clones cost less than threading a lifetime through it.
    visiting.push(id.to_string());

    for property in &manifest.requires.properties {
        if let Some(provider) = providers.get(property.as_str()) {
            visit(provider, by_id, providers, done, visiting, ordered)?;
        }
    }

    visiting.pop();
    done.insert(id.to_string());
    ordered.push(manifest.clone());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin::manifest::{Contributes, Requires};

    fn plugin(id: &str) -> Manifest {
        Manifest { id: id.to_string(), ..Manifest::default() }
    }

    fn provides(id: &str, properties: &[&str]) -> Manifest {
        Manifest {
            id: id.to_string(),
            contributes: Contributes {
                properties: properties.iter().map(|p| p.to_string()).collect(),
                ..Contributes::default()
            },
            ..Manifest::default()
        }
    }

    fn needs(id: &str, properties: &[&str]) -> Manifest {
        Manifest {
            id: id.to_string(),
            requires: Requires {
                properties: properties.iter().map(|p| p.to_string()).collect(),
            },
            ..Manifest::default()
        }
    }

    fn ids(registry: &Registry) -> Vec<&str> {
        registry.plugins().iter().map(|p| p.id.as_str()).collect()
    }

    // --- reading a manifest -----------------------------------------------

    #[test]
    fn the_manifest_from_the_architecture_doc_parses() {
        // The shape is the one in docs/explanation/architecture.md, with an
        // invented id: the boundary test forbids the core naming a real
        // plugin, and a test is core source like any other.
        let json = r#"{
          "id": "example.assets",
          "contributes": {
            "properties":   ["vrchat", "vrchat.clothing", "booth"],
            "shared":       ["title", "price", "url", "cover"],
            "vocabularies": ["avatar"],
            "actions":      { "booth": ["fetch-booth"], "vrchat": ["export-to-unity"] },
            "panels":       { "vrchat": "./panels/Vrchat", "booth": "./panels/Booth" },
            "viewers":      {}
          },
          "requires": { "properties": [] }
        }"#;

        let manifest = Manifest::parse(json).expect("parse");
        assert_eq!(manifest.id, "example.assets");
        assert_eq!(manifest.contributes.properties.len(), 3);
        assert_eq!(manifest.contributes.panels.get("booth").map(String::as_str),
                   Some("./panels/Booth"));
    }

    #[test]
    fn a_minimal_manifest_is_enough() {
        let manifest = Manifest::parse(r#"{"id": "example.minimal"}"#).expect("parse");
        assert!(manifest.contributes.properties.is_empty());
        assert!(manifest.requires.properties.is_empty());
    }

    #[test]
    fn a_manifest_without_an_id_is_refused() {
        assert!(matches!(
            Manifest::parse(r#"{"id": ""}"#),
            Err(ManifestError::BadId(_))
        ));
        assert!(matches!(
            Manifest::parse(r#"{"id": "two words"}"#),
            Err(ManifestError::BadId(_))
        ));
    }

    #[test]
    fn a_plugin_may_not_claim_a_reserved_namespace() {
        // fs is the core property the scanner needs; @pin and @import are the
        // core's own. A plugin shadowing one would break something it does not
        // know exists.
        for reserved in ["fs", "@pin", "@import"] {
            let json = format!(r#"{{"id": "x", "contributes": {{"properties": ["{reserved}"]}}}}"#);
            assert!(
                matches!(Manifest::parse(&json), Err(ManifestError::Reserved(_))),
                "{reserved} was allowed"
            );
        }
    }

    #[test]
    fn a_file_type_is_an_extension_without_a_dot() {
        let json = r#"{"id": "x", "contributes": {"file_types": {".pdf": ["pdf"]}}}"#;
        assert!(matches!(Manifest::parse(json), Err(ManifestError::Malformed(_))));
    }

    // --- contributions are scoped -----------------------------------------

    #[test]
    fn a_panel_must_be_scoped_to_a_property_the_plugin_relates_to() {
        // Requiring a property is the ticket into its region. Without the
        // check a plugin could put a panel anywhere.
        let json = r#"{
          "id": "intruder",
          "contributes": { "panels": { "booth": "./Panel" } }
        }"#;

        assert!(matches!(
            Manifest::parse(json),
            Err(ManifestError::UnscopedContribution { slot: "panel", .. })
        ));
    }

    #[test]
    fn requiring_a_property_buys_a_place_in_its_region() {
        // The price-comparison case: requires booth and gumroad, so it may
        // put a panel among theirs.
        let json = r#"{
          "id": "price-compare",
          "contributes": { "panels": { "booth": "./Compare" } },
          "requires": { "properties": ["booth", "gumroad"] }
        }"#;

        assert!(Manifest::parse(json).is_ok());
    }

    #[test]
    fn contributing_a_property_also_buys_a_place_in_it() {
        let json = r#"{
          "id": "booth",
          "contributes": {
            "properties": ["booth"],
            "panels": { "booth": "./Panel" },
            "actions": { "booth": ["fetch"] }
          }
        }"#;

        assert!(Manifest::parse(json).is_ok());
    }

    #[test]
    fn every_ui_slot_is_scope_checked() {
        for slot in ["panels", "viewers"] {
            let json = format!(
                r#"{{"id": "x", "contributes": {{"{slot}": {{"booth": "./M"}}}}}}"#
            );
            assert!(Manifest::parse(&json).is_err(), "{slot} was not checked");
        }
        for slot in ["actions", "columns"] {
            let json = format!(
                r#"{{"id": "x", "contributes": {{"{slot}": {{"booth": ["a"]}}}}}}"#
            );
            assert!(Manifest::parse(&json).is_err(), "{slot} was not checked");
        }
    }

    // --- loading a set ----------------------------------------------------

    #[test]
    fn plugins_with_nothing_to_say_about_each_other_all_load() {
        let registry = Registry::load(vec![
            provides("a", &["alpha"]),
            provides("b", &["beta"]),
        ])
        .expect("load");

        assert_eq!(registry.plugins().len(), 2);
    }

    #[test]
    fn a_requirement_is_satisfied_by_whichever_plugin_provides_it() {
        // The resolver never sees a plugin id on the requiring side, so
        // swapping one provider for another is not a migration.
        let with_first = Registry::load(vec![
            needs("summary", &["vrchat"]),
            provides("vrc-classic", &["vrchat"]),
        ])
        .expect("first provider");

        let with_second = Registry::load(vec![
            needs("summary", &["vrchat"]),
            provides("vrc-rewrite", &["vrchat"]),
        ])
        .expect("a different provider");

        assert_eq!(with_first.plugins().len(), with_second.plugins().len());
    }

    #[test]
    fn a_requirement_nothing_provides_is_refused() {
        let result = Registry::load(vec![needs("summary", &["vrchat"])]);

        assert_eq!(
            result.unwrap_err(),
            RegistryError::Unsatisfied {
                plugin: "summary".into(),
                property: "vrchat".into()
            }
        );
    }

    #[test]
    fn two_plugins_claiming_one_id_are_refused() {
        let result = Registry::load(vec![plugin("same"), plugin("same")]);
        assert_eq!(result.unwrap_err(), RegistryError::DuplicateId("same".into()));
    }

    #[test]
    fn two_plugins_defining_one_property_are_refused() {
        // A property is a contract. Two definitions of one contract means one
        // of them is about to surprise somebody.
        let result = Registry::load(vec![
            provides("first", &["booth"]),
            provides("second", &["booth"]),
        ]);

        assert!(matches!(result, Err(RegistryError::DuplicateProperty { .. })));
    }

    #[test]
    fn one_plugin_may_define_several_properties() {
        let registry = Registry::load(vec![provides("vrc", &["vrchat", "booth"])])
            .expect("load");
        assert!(registry.provider_of("vrchat").is_some());
        assert!(registry.provider_of("booth").is_some());
    }

    // --- ordering ---------------------------------------------------------

    #[test]
    fn a_provider_loads_before_what_requires_it() {
        let registry = Registry::load(vec![
            needs("summary", &["vrchat"]),
            provides("vrc", &["vrchat"]),
        ])
        .expect("load");

        assert_eq!(ids(&registry), ["vrc", "summary"]);
    }

    #[test]
    fn a_chain_loads_in_order() {
        let mut middle = provides("middle", &["beta"]);
        middle.requires.properties.push("alpha".into());

        let registry = Registry::load(vec![
            needs("last", &["beta"]),
            middle,
            provides("first", &["alpha"]),
        ])
        .expect("load");

        assert_eq!(ids(&registry), ["first", "middle", "last"]);
    }

    #[test]
    fn plugins_requiring_each_other_are_refused_rather_than_looped() {
        let mut left = provides("left", &["alpha"]);
        left.requires.properties.push("beta".into());
        let mut right = provides("right", &["beta"]);
        right.requires.properties.push("alpha".into());

        let result = Registry::load(vec![left, right]);
        match result {
            Err(RegistryError::Circular(chain)) => {
                assert!(chain.len() >= 2, "a cycle should name what is in it: {chain:?}");
            }
            other => panic!("expected a cycle, got {other:?}"),
        }
    }

    // --- what a region asks -----------------------------------------------

    #[test]
    fn a_region_finds_everyone_scoped_to_its_property() {
        // Both the plugin that defines booth and the one that requires it.
        let mut compare = plugin("price-compare");
        compare.requires.properties.push("booth".into());
        compare.contributes.panels.insert("booth".into(), "./Compare".into());

        let registry = Registry::load(vec![provides("booth", &["booth"]), compare])
            .expect("load");

        let scoped: Vec<&str> =
            registry.scoped_to("booth").map(|p| p.id.as_str()).collect();
        assert_eq!(scoped, ["booth", "price-compare"]);
    }

    #[test]
    fn a_region_is_empty_when_nothing_is_scoped_to_it() {
        let registry = Registry::load(vec![provides("a", &["alpha"])]).expect("load");
        assert_eq!(registry.scoped_to("booth").count(), 0);
    }

    #[test]
    fn shared_fields_come_back_by_property() {
        // What flatten needs to know which fields compete for a bare name.
        let mut booth = provides("booth", &["booth"]);
        booth.contributes.shared = ["title", "price"].map(String::from).to_vec();

        let registry = Registry::load(vec![booth, provides("pdf", &["pdf"])]).expect("load");
        let shared = registry.shared_fields();

        assert_eq!(shared.get("booth").map(|f| f.len()), Some(2));
        assert_eq!(shared.get("pdf").map(|f| f.len()), Some(0), "no manifest, no sharing");
    }

    #[test]
    fn a_plugin_sharing_nothing_keeps_its_fields_to_itself() {
        // Isolation is the default: a plugin whose fields compete by accident
        // changes values on objects the user never touched.
        let registry = Registry::load(vec![provides("pdf", &["pdf"])]).expect("load");
        assert!(registry.shared_fields()["pdf"].is_empty());
    }
}
