//! What a plugin declares.
//!
//! A manifest is the whole of what the core knows about a plugin. There is no
//! registration call, no init hook that reaches into the core, and no way for
//! a plugin to describe itself other than this.
//!
//! # Dependencies name properties, never plugins
//!
//! An AI-summary plugin for VRChat requires the `vrchat` property, and
//! whichever plugin provides it satisfies that. [`Requires`] has no field that
//! could hold a plugin id, so the rule is not one anybody has to remember.
//!
//! # UI contributions are keyed by property
//!
//! A plugin does not say where on screen it wants to be; it says which
//! property it is scoped to, and the core places that property's region. Two
//! plugins can no more collide than two properties can, and ordering falls out
//! of mount order, which already exists.
//!
//! Visibility follows from the same key: a contribution appears when the
//! object carries the property. Panels, actions and columns need no separate
//! rule.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A plugin's declaration.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    /// `yukifile.vrc`, `com.example.epub`. Unique among loaded plugins.
    pub id: String,
    #[serde(default)]
    pub contributes: Contributes,
    #[serde(default)]
    pub requires: Requires,
}

/// What a plugin adds.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Contributes {
    /// Semantic properties this plugin defines: `vrchat`, `booth`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<String>,

    /// Fields that contribute to a shared concept rather than staying this
    /// plugin's own. Empty means isolation, which is the safe default: a
    /// plugin whose fields compete by accident changes values on objects the
    /// user never touched.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shared: Vec<String>,

    /// Controlled name lists: `avatar`, `author`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub vocabularies: Vec<String>,

    /// Extension to the factual properties it brings, so the core holds the
    /// matching and none of the extensions.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub file_types: BTreeMap<String, Vec<String>>,

    /// Property to the panel module rendered in its region.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub panels: BTreeMap<String, String>,

    /// Property to the actions offered on objects carrying it.
    ///
    /// Actions reach the user through the context menu and the command
    /// palette, which sit outside any layout — so a plugin owning an object's
    /// page cannot strand another plugin's actions.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub actions: BTreeMap<String, Vec<String>>,

    /// Property to the full-screen viewer module.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub viewers: BTreeMap<String, String>,

    /// Property to the list columns it offers.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub columns: BTreeMap<String, Vec<String>>,
}

/// What a plugin needs from whoever provides it.
///
/// Properties only. There is deliberately no field for a plugin id: naming one
/// would tie a plugin to an implementation rather than to the contract it
/// actually depends on, and make the two impossible to swap.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Requires {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<String>,
}

/// Why a manifest was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ManifestError {
    Malformed(String),
    /// The id is empty or not a usable name.
    BadId(String),
    /// A contribution is keyed by a property this plugin neither declares nor
    /// requires.
    ///
    /// Contributing into a property's region is how a plugin gets there, and
    /// requiring that property is the ticket. Without the check, a plugin
    /// could put a panel in a region it has no relationship to.
    UnscopedContribution { slot: &'static str, property: String },
    /// A reserved name a plugin may not use.
    Reserved(String),
}

impl std::fmt::Display for ManifestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Malformed(detail) => write!(f, "cannot read manifest: {detail}"),
            Self::BadId(id) => write!(f, "{id:?} is not a usable plugin id"),
            Self::UnscopedContribution { slot, property } => write!(
                f,
                "contributes a {slot} to {property:?}, which this plugin neither \
                 declares nor requires"
            ),
            Self::Reserved(name) => write!(f, "{name:?} is reserved"),
        }
    }
}

impl std::error::Error for ManifestError {}

/// Namespaces the core keeps for itself. A plugin declaring one is refused at
/// load rather than allowed to shadow a core property.
const RESERVED: &[&str] = &["fs", "@pin", "@import"];

impl Manifest {
    /// Read and check a manifest.
    pub fn parse(json: &str) -> Result<Self, ManifestError> {
        let manifest: Self = serde_json::from_str(json)
            .map_err(|error| ManifestError::Malformed(error.to_string()))?;
        manifest.check()?;
        Ok(manifest)
    }

    /// Everything wrong with a manifest, or nothing.
    pub fn check(&self) -> Result<(), ManifestError> {
        if self.id.trim().is_empty() || self.id.contains(char::is_whitespace) {
            return Err(ManifestError::BadId(self.id.clone()));
        }

        for property in &self.contributes.properties {
            if RESERVED.contains(&property.as_str()) {
                return Err(ManifestError::Reserved(property.clone()));
            }
        }
        for extension in self.contributes.file_types.keys() {
            if extension.starts_with('.') {
                return Err(ManifestError::Malformed(format!(
                    "file type {extension:?} should be an extension without a dot"
                )));
            }
        }

        // Every UI contribution has to be scoped to a property this plugin has
        // a relationship with.
        let scoped: Vec<&str> = self
            .contributes
            .properties
            .iter()
            .chain(&self.requires.properties)
            .map(String::as_str)
            .collect();

        let keyed: [(&'static str, Vec<&String>); 4] = [
            ("panel", self.contributes.panels.keys().collect()),
            ("action", self.contributes.actions.keys().collect()),
            ("viewer", self.contributes.viewers.keys().collect()),
            ("column", self.contributes.columns.keys().collect()),
        ];

        for (slot, properties) in keyed {
            for property in properties {
                if !scoped.contains(&property.as_str()) {
                    return Err(ManifestError::UnscopedContribution {
                        slot,
                        property: property.clone(),
                    });
                }
            }
        }
        Ok(())
    }

    /// Properties this plugin is scoped to, whether it defines them or depends
    /// on them.
    pub fn scope(&self) -> impl Iterator<Item = &str> {
        self.contributes
            .properties
            .iter()
            .chain(&self.requires.properties)
            .map(String::as_str)
    }
}
