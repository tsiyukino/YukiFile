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

    /// The directory this manifest was read from, relative to `plugins/`.
    ///
    /// Filled in by discovery rather than declared: a manifest saying where
    /// it lives could say something false, and the loader needs the truth to
    /// resolve `./panel` against the right place.
    ///
    /// Empty for a manifest built in memory, which is what tests do.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub directory: String,
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

    /// Actions that belong to the library rather than to any object.
    ///
    /// Scanning, importing and exporting are the shape: they act on the
    /// library as a whole, and there is no object to hang them on. A fresh
    /// library has no objects at all, so an action keyed to a property would
    /// be unreachable exactly when it is most needed.
    ///
    /// Deliberately not keyed by property, which means it skips the scoping
    /// check every other contribution goes through. That check asks "does this
    /// plugin have a relationship with the region it wants to draw in", and a
    /// library action draws in no region — there is nothing to be scoped to.
    /// The permission question it answers instead is whether the plugin is
    /// installed at all.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub library_actions: Vec<String>,

    /// The module holding this plugin's library actions.
    ///
    /// One module for all of them rather than one per action: they share
    /// whatever the plugin knows, and a scan and an export of the same library
    /// are two entry points into one body of knowledge.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub library_action_module: String,
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
    /// A module specifier carries a file extension.
    ///
    /// Which extension a module has on disk is the resolver's business. A
    /// manifest naming `./panel.js` is a manifest that has to change when the
    /// build output changes, and the two have no reason to be coupled.
    ExtensionInSpecifier { slot: &'static str, specifier: String },
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
            Self::ExtensionInSpecifier { slot, specifier } => write!(
                f,
                "the {slot} module {specifier:?} names a file extension; leave it \
                 off and let the loader resolve it"
            ),
        }
    }
}

impl std::error::Error for ManifestError {}

/// Namespaces the core keeps for itself. A plugin declaring one is refused at
/// load rather than allowed to shadow a core property.
const RESERVED: &[&str] = &["fs", "@pin", "@import"];

/// Whether a specifier's last segment carries a file extension.
///
/// Only the last segment is examined, and only after the leading `./` or
/// `../` is stepped over: `./panels/v1.2/Booth` has a dot in a directory name
/// and names no extension, while `../panel` is dots that are path syntax. What
/// this refuses is `panel.js` -- a trailing dot followed by something that
/// looks like an extension rather than part of a name.
fn names_an_extension(specifier: &str) -> bool {
    let last = specifier.rsplit('/').next().unwrap_or(specifier);

    // `.`, `..` and a leading dot are path syntax or a hidden-file convention,
    // not an extension.
    let name = last.trim_start_matches('.');
    let Some((_, extension)) = name.rsplit_once('.') else {
        return false;
    };

    // A version fragment (`Panel.v2`) is part of the name. An extension is
    // short and alphanumeric, which is what distinguishes `.js` from `.v2`
    // only imperfectly -- so the test is narrower: an extension the loader
    // could plausibly be resolving.
    matches!(
        extension.to_ascii_lowercase().as_str(),
        "js" | "mjs" | "cjs" | "jsx" | "ts" | "mts" | "cts" | "tsx" | "json" | "wasm"
    )
}

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

        // Module specifiers name a module, not a file. What extension it has
        // on disk belongs to whoever resolves it -- `.ts` in development,
        // `.js` after a build, a hashed name after bundling -- and a manifest
        // that spells one of those out has to be edited when the build
        // changes.
        if names_an_extension(&self.contributes.library_action_module) {
            return Err(ManifestError::ExtensionInSpecifier {
                slot: "library action",
                specifier: self.contributes.library_action_module.clone(),
            });
        }

        for (slot, modules) in [
            ("panel", &self.contributes.panels),
            ("viewer", &self.contributes.viewers),
        ] {
            for specifier in modules.values() {
                if names_an_extension(specifier) {
                    return Err(ManifestError::ExtensionInSpecifier {
                        slot,
                        specifier: specifier.clone(),
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

#[cfg(test)]
mod tests {
    use super::*;


    fn with_panel(specifier: &str) -> Manifest {
        let mut manifest = Manifest { id: "test.plugin".into(), ..Default::default() };
        manifest.contributes.properties.push("thing".into());
        manifest.contributes.panels.insert("thing".into(), specifier.into());
        manifest
    }

    #[test]
    fn a_specifier_without_an_extension_is_fine() {
        assert!(with_panel("./panel").check().is_ok());
        assert!(with_panel("./panels/Booth").check().is_ok());
        assert!(with_panel("../shared/Panel").check().is_ok());
    }

    #[test]
    fn a_specifier_naming_a_build_output_is_refused() {
        for bad in ["./panel.js", "./panel.ts", "./dist/panel.mjs", "panel.tsx"] {
            assert!(
                matches!(
                    with_panel(bad).check(),
                    Err(ManifestError::ExtensionInSpecifier { .. })
                ),
                "{bad} was accepted"
            );
        }
    }

    #[test]
    fn a_dot_that_is_not_an_extension_is_left_alone() {
        // A version fragment in a directory or a name is part of the name.
        // Refusing these would make the rule about dots rather than about
        // build outputs.
        assert!(with_panel("./panels/v1.2/Booth").check().is_ok());
        assert!(with_panel("./Panel.v2").check().is_ok());
    }

    #[test]
    fn a_viewer_is_held_to_the_same_rule() {
        let mut manifest = Manifest { id: "test.plugin".into(), ..Default::default() };
        manifest.contributes.properties.push("thing".into());
        manifest.contributes.viewers.insert("thing".into(), "./viewer.js".into());

        assert!(matches!(
            manifest.check(),
            Err(ManifestError::ExtensionInSpecifier { slot: "viewer", .. })
        ));
    }
}
