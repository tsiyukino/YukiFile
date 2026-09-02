//! Parsing and formatting of value paths.
//!
//! A value hangs on an object under a path. Three shapes occur:
//!
//! ```text
//! title                  a bare field, entered by the user
//! booth#1/title          a field belonging to one mounted property instance
//! vrchat.clothing/parts  a property whose type name contains a dot
//! ```
//!
//! The namespace is what keeps `title` and `booth#1/title` apart: one is what
//! you call the thing, the other is what the shop calls it. Re-fetching a shop
//! page updates the second and never touches the first.
//!
//! This module is only the syntax. Which of two values wins on read is
//! `flatten`'s question, and this module has no opinion about it.

use std::fmt;

/// A parsed value path.
///
/// The lifetime ties the borrowed parts to the input string; nothing here
/// allocates, because paths are parsed on every value read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ValuePath<'a> {
    /// The property this value belongs to, or `None` for a bare field.
    /// `vrchat.clothing` is one namespace, not two.
    pub namespace: Option<&'a str>,
    /// Which mount of that property. `None` for a bare field, `Some(1)` for
    /// `booth#1`. A property mounted without a counter parses as instance 1,
    /// so `booth/title` and `booth#1/title` name the same value.
    pub instance: Option<u32>,
    /// The field name. Never empty.
    pub field: &'a str,
}

/// Why a path string is not a valid value path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    /// The whole path, or one of its two sides, is empty.
    Empty,
    /// More than one `/`. Nested fields are not paths; a property type whose
    /// name contains a dot is one namespace.
    TooManySegments,
    /// The text after `#` is not a positive integer.
    BadInstance,
    /// A `#` appeared in the field rather than in the namespace.
    InstanceOnField,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let msg = match self {
            Self::Empty => "value path has an empty segment",
            Self::TooManySegments => "value path has more than one '/'",
            Self::BadInstance => "instance suffix is not a positive integer",
            Self::InstanceOnField => "instance suffix belongs on the namespace",
        };
        f.write_str(msg)
    }
}

impl std::error::Error for ParseError {}

impl<'a> ValuePath<'a> {
    /// Parse a stored path.
    pub fn parse(path: &'a str) -> Result<Self, ParseError> {
        let mut segments = path.split('/');
        let first = segments.next().unwrap_or_default();

        let (namespace, field) = match segments.next() {
            None => (None, first),
            Some(field) => (Some(first), field),
        };

        if segments.next().is_some() {
            return Err(ParseError::TooManySegments);
        }
        if field.is_empty() {
            return Err(ParseError::Empty);
        }
        if field.contains('#') {
            return Err(ParseError::InstanceOnField);
        }

        let Some(namespace) = namespace else {
            return Ok(Self { namespace: None, instance: None, field });
        };

        let (name, instance) = split_instance(namespace)?;
        Ok(Self { namespace: Some(name), instance: Some(instance), field })
    }

    /// True when no property owns this value.
    pub fn is_bare(&self) -> bool {
        self.namespace.is_none()
    }
}

/// A reference to one mounted property instance: `booth#1`, no field.
///
/// This is what a pin holds — it names a source, not a value — so it is a
/// namespace and an instance with nothing after them. Parsing it through
/// `ValuePath` would fail, since a value path requires a field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MountRef<'a> {
    pub namespace: &'a str,
    pub instance: u32,
}

impl<'a> MountRef<'a> {
    /// Parse `booth#1`, or `booth` for the first instance.
    pub fn parse(reference: &'a str) -> Result<Self, ParseError> {
        if reference.contains('/') {
            return Err(ParseError::TooManySegments);
        }
        let (namespace, instance) = split_instance(reference)?;
        Ok(Self { namespace, instance })
    }
}

impl fmt::Display for MountRef<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}#{}", self.namespace, self.instance)
    }
}

impl fmt::Display for ValuePath<'_> {
    /// Round-trips through `parse`. An instance is always written out, so a
    /// path read as `booth/title` is stored back as `booth#1/title` and the
    /// two spellings stop coexisting in the database.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (self.namespace, self.instance) {
            (Some(namespace), Some(instance)) => {
                write!(f, "{namespace}#{instance}/{}", self.field)
            }
            (Some(namespace), None) => write!(f, "{namespace}/{}", self.field),
            _ => f.write_str(self.field),
        }
    }
}

/// Split `booth#2` into `("booth", 2)`. A namespace with no `#` is instance 1.
fn split_instance(namespace: &str) -> Result<(&str, u32), ParseError> {
    let Some((name, suffix)) = namespace.split_once('#') else {
        return if namespace.is_empty() {
            Err(ParseError::Empty)
        } else {
            Ok((namespace, 1))
        };
    };

    if name.is_empty() {
        return Err(ParseError::Empty);
    }
    match suffix.parse::<u32>() {
        Ok(0) | Err(_) => Err(ParseError::BadInstance),
        Ok(instance) => Ok((name, instance)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(path: &str) -> ValuePath<'_> {
        ValuePath::parse(path).expect("should parse")
    }

    #[test]
    fn bare_field_has_no_namespace() {
        let path = parse("title");
        assert_eq!(path.namespace, None);
        assert_eq!(path.instance, None);
        assert_eq!(path.field, "title");
        assert!(path.is_bare());
    }

    #[test]
    fn namespaced_field_carries_its_instance() {
        let path = parse("booth#1/title");
        assert_eq!(path.namespace, Some("booth"));
        assert_eq!(path.instance, Some(1));
        assert_eq!(path.field, "title");
        assert!(!path.is_bare());
    }

    #[test]
    fn two_shops_stay_apart() {
        let booth = parse("booth#1/price");
        let gumroad = parse("gumroad#1/price");
        assert_ne!(booth, gumroad);
        assert_eq!(booth.field, gumroad.field);
    }

    #[test]
    fn instances_of_one_property_stay_apart() {
        assert_ne!(parse("booth#1/price"), parse("booth#2/price"));
    }

    #[test]
    fn a_dot_stays_inside_the_namespace() {
        // `vrchat.clothing` is one property type whose name contains a dot,
        // not a nested path. Storage needs no change to support it.
        let path = parse("vrchat.clothing/parts");
        assert_eq!(path.namespace, Some("vrchat.clothing"));
        assert_eq!(path.field, "parts");
    }

    #[test]
    fn a_missing_counter_means_the_first_instance() {
        assert_eq!(parse("booth/title"), parse("booth#1/title"));
    }

    #[test]
    fn display_round_trips() {
        // Paths already carrying an explicit instance come back unchanged.
        for path in ["title", "note", "booth#1/title", "booth#2/price", "vrchat#1/category"] {
            assert_eq!(parse(path).to_string(), path);
        }
    }

    #[test]
    fn display_normalises_a_missing_counter() {
        // Both spellings must not coexist in the database.
        assert_eq!(parse("booth/title").to_string(), "booth#1/title");
    }

    #[test]
    fn the_paths_from_the_architecture_doc_all_parse() {
        // The worked example in docs/explanation/architecture.md, with what
        // each path decomposes into. `vrchat/category` is written there
        // without a counter and normalises to instance 1.
        let cases = [
            ("title", None, None, "title"),
            ("note", None, None, "note"),
            ("booth#1/url", Some("booth"), Some(1), "url"),
            ("booth#1/title", Some("booth"), Some(1), "title"),
            ("booth#1/price", Some("booth"), Some(1), "price"),
            ("vrchat/category", Some("vrchat"), Some(1), "category"),
        ];
        for (path, namespace, instance, field) in cases {
            let parsed = parse(path);
            assert_eq!(parsed.namespace, namespace, "namespace of {path}");
            assert_eq!(parsed.instance, instance, "instance of {path}");
            assert_eq!(parsed.field, field, "field of {path}");
        }
    }

    // --- MountRef ---------------------------------------------------------

    #[test]
    fn a_mount_reference_has_no_field() {
        // This is what a pin holds: it names a source, not a value.
        let reference = MountRef::parse("gumroad#1").expect("should parse");
        assert_eq!(reference.namespace, "gumroad");
        assert_eq!(reference.instance, 1);
    }

    #[test]
    fn a_mount_reference_without_a_counter_is_the_first_instance() {
        assert_eq!(MountRef::parse("booth"), MountRef::parse("booth#1"));
    }

    #[test]
    fn a_mount_reference_round_trips() {
        for reference in ["booth#1", "gumroad#2", "vrchat.clothing#1"] {
            assert_eq!(MountRef::parse(reference).unwrap().to_string(), reference);
        }
    }

    #[test]
    fn a_value_path_is_not_a_mount_reference() {
        // The two are different shapes and must not be parsed by one another.
        assert_eq!(MountRef::parse("booth#1/title"), Err(ParseError::TooManySegments));
        assert!(ValuePath::parse("booth#1").is_err());
    }

    #[test]
    fn a_mount_reference_rejects_a_bad_instance() {
        assert_eq!(MountRef::parse("booth#0"), Err(ParseError::BadInstance));
        assert_eq!(MountRef::parse("booth#x"), Err(ParseError::BadInstance));
        assert_eq!(MountRef::parse(""), Err(ParseError::Empty));
    }

    #[test]
    fn rejects_empty_and_malformed() {
        use ParseError::*;
        for (path, expected) in [
            ("", Empty),
            ("booth#1/", Empty),
            ("/title", Empty),
            ("#1/title", Empty),
            ("a/b/c", TooManySegments),
            ("booth#0/title", BadInstance),
            ("booth#x/title", BadInstance),
            ("booth#/title", BadInstance),
            ("booth#-1/title", BadInstance),
            ("booth/ti#tle", InstanceOnField),
        ] {
            assert_eq!(
                ValuePath::parse(path),
                Err(expected.clone()),
                "{path} should be rejected as {expected:?}"
            );
        }
    }
}
