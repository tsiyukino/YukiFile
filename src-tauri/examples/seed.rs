//! Turn the seed library's notes into a contract document.
//!
//! ```text
//! cargo run --example seed -- <seed dir> <out.json>
//! cargo run --example import -- <library-root> <out.json> "seed"
//! ```
//!
//! `seed/` holds what organising 174 products by hand produced: a manifest
//! with each product's category, vendor, listing and avatars, and the avatar
//! vocabulary with its spellings. This writes them in the shape
//! `import.propose` reads, so the first real library starts with 160
//! identified products rather than 1518 unnamed files.
//!
//! # What goes where
//!
//! The manifest records where a product *was* and where it was going to be
//! moved. Both paths are written, so the document matches whichever layout
//! the library has. An import records no locations; the paths only match.
//! The `to` path is the stable id.
//!
//! A product with a Booth listing gets its title under `booth#1/title`, where
//! it is a source for the shared title; one without -- including one whose
//! only URL is a shop front -- gets a bare `title`,
//! because it was typed by a person from a license PDF or a promo image and
//! that is what a bare field means. The category and vendor sit under
//! `vrchat#1`. The status of the identification -- confirmed, from the
//! package, not found -- rides along under `vrchat#1/status`, since
//! `vrc-lessons.md` is explicit that recording "unknown" is right and
//! inventing a plausible source is not.
//!
//! Avatars become `supports` edges to `avatar:` terms. The manifest lists what
//! the shop page says fits; what is owned comes from disk and is a later rule.
//! A redundant archive becomes an `archived-as` edge to the zip, in both the
//! old layout and the planned `_Archive/`, and the core skips whichever it
//! does not hold.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::process::ExitCode;

use serde_json::{json, Map, Value};

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(problem) => {
            eprintln!("{problem}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let (Some(seed), Some(out)) = (args.next(), args.next()) else {
        return Err("usage: seed <seed dir> <out.json>".to_string());
    };
    let seed = Path::new(&seed);

    let manifest = read(&seed.join("manifest.json"))?;
    let avatars = read(&seed.join("av.json"))?;
    let aliases = read(&seed.join("alias.json"))?;

    let document = convert(&manifest, &avatars, &aliases)?;
    let text = serde_json::to_string_pretty(&document).map_err(|error| error.to_string())?;
    std::fs::write(&out, text).map_err(|error| format!("cannot write {out}: {error}"))?;

    let objects = document["objects"].as_array().map(Vec::len).unwrap_or(0);
    let terms = document["terms"].as_array().map(Vec::len).unwrap_or(0);
    println!("{objects} objects, {terms} avatar terms, written to {out}");
    Ok(())
}

fn read(path: &Path) -> Result<Value, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    serde_json::from_str(&text).map_err(|error| format!("{} is not JSON: {error}", path.display()))
}

/// The document, from the three seed files.
pub fn convert(manifest: &Value, avatars: &Value, aliases: &Value) -> Result<Value, String> {
    let products = manifest
        .as_array()
        .ok_or("manifest.json is not a list")?;

    // Every avatar the vocabulary names, plus any a product mentions that it
    // does not: nine of the 73 referenced are missing from av.json, and an
    // edge to a term that does not exist would be skipped silently.
    let mut ids: BTreeSet<String> = avatars
        .as_array()
        .ok_or("av.json is not a list")?
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();
    for product in products {
        for avatar in strings(&product["avatars"]) {
            ids.insert(avatar);
        }
    }

    let aliases: BTreeMap<String, Vec<String>> = aliases
        .as_object()
        .ok_or("alias.json is not an object")?
        .iter()
        .map(|(id, spellings)| (id.clone(), strings(spellings)))
        .collect();

    let terms: Vec<Value> = ids
        .iter()
        .map(|id| {
            let spellings = aliases.get(id).cloned().unwrap_or_default();
            // The first spelling is the one written for people; the id is
            // lower-case ASCII and reads like a key.
            let label = spellings.first().cloned().unwrap_or_else(|| capitalise(id));
            json!({ "vocab": "avatar", "id": id, "label": label, "aliases": spellings })
        })
        .collect();

    let objects: Vec<Value> = products.iter().map(object_of).collect::<Result<_, _>>()?;

    Ok(json!({
        "version": 1,
        "source": "seed",
        "terms": terms,
        "objects": objects,
    }))
}

fn object_of(product: &Value) -> Result<Value, String> {
    let from = text(product, "from")?;
    let to = text(product, "to")?;

    let mut paths = vec![to.clone()];
    if from != to {
        paths.push(from.clone());
    }
    // Which of them are folders is what the import needs to mount `archive`
    // on a zip and nothing on a folder. A name with no extension is a folder
    // in this manifest; the two products whose folder names end in a
    // version number still have no dot after the last separator.
    let folders: Vec<String> = paths.iter().filter(|p| !looks_like_file(p)).cloned().collect();

    let mut values: Map<String, Value> = Map::new();
    let title = product["title"].as_str().unwrap_or("").trim();
    let url = product["url"].as_str().map(str::trim).filter(|u| !u.is_empty());
    let vendor = product["vendor"].as_str().unwrap_or("").trim();
    let kind = product["kind"].as_str().unwrap_or("").trim();
    let status = product["status"].as_str().unwrap_or("").trim();

    if !kind.is_empty() {
        values.insert("vrchat#1/category".into(), kind.into());
    }
    if !vendor.is_empty() {
        values.insert("vrchat#1/vendor".into(), vendor.into());
    }
    if !status.is_empty() {
        values.insert("vrchat#1/status".into(), status.into());
    }

    // A listing, not a shop front or a search: 24 of the seed's Booth URLs
    // name the shop that sells a product and not the product, and a `booth`
    // listing without an item is a claim the panel would draw as one.
    match url {
        Some(url) if url.contains("booth.pm") && booth_item(url).is_some() => {
            values.insert("booth#1/url".into(), url.into());
            if let Some(item) = booth_item(url) {
                values.insert("booth#1/item_id".into(), item.into());
            }
            if let Some(price) = product["price"].as_u64() {
                values.insert("booth#1/price".into(), price.to_string().into());
            }
            if !title.is_empty() {
                values.insert("booth#1/title".into(), title.into());
            }
        }
        other => {
            if let Some(url) = other {
                values.insert("vrchat#1/source_url".into(), url.into());
            }
            if let Some(price) = product["price"].as_u64() {
                values.insert("vrchat#1/price".into(), price.to_string().into());
            }
            if !title.is_empty() {
                values.insert("title".into(), title.into());
            }
        }
    }

    let mut edges: Vec<Value> = strings(&product["avatars"])
        .into_iter()
        .map(|avatar| json!({ "kind": "supports", "term": format!("avatar:{avatar}") }))
        .collect();
    for archive in strings(&product["archives"]) {
        edges.push(json!({ "kind": "archived-as", "object": archive }));
        if let Some(name) = archive.rsplit('/').next() {
            edges.push(json!({ "kind": "archived-as", "object": format!("_Archive/{name}") }));
        }
    }

    Ok(json!({
        "paths": paths,
        "folders": folders,
        "id": to,
        "values": values,
        "edges": edges,
    }))
}

fn text(product: &Value, field: &str) -> Result<String, String> {
    product[field]
        .as_str()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("a product has no {field}: {product}"))
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| items.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

/// Whether the last segment carries an extension.
///
/// Short, alphanumeric, and holding at least one letter: `zip`, `7z`, `mp4`.
/// `Endeavor_v1.0.4` and `Airi_Ver1.00` end in digits after a dot and are
/// folders, which `scan.md` already notes for `mochi_bob1.0`.
fn looks_like_file(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    let name = name.trim_start_matches('.');
    name.rsplit_once('.').is_some_and(|(_, ext)| {
        !ext.is_empty()
            && ext.len() <= 12
            && ext.chars().all(|c| c.is_ascii_alphanumeric())
            && ext.chars().any(|c| c.is_ascii_alphabetic())
    })
}

/// The item id in a Booth URL, in any of its spellings.
fn booth_item(url: &str) -> Option<&str> {
    let after = url.split("/items/").nth(1)?;
    let digits: &str = after.split(|c: char| !c.is_ascii_digit()).next()?;
    (!digits.is_empty()).then_some(digits)
}

fn capitalise(id: &str) -> String {
    let mut chars = id.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn product(over: Value) -> Value {
        let mut base = json!({
            "from": ".AASHAREE/CLOTHS/Cross_Maid_Fullset",
            "to": "Clothing/Cross_Maid_Fullset",
            "kind": "Clothing",
            "avatars": ["manuka", "kikyo"],
            "title": "Cross Maid",
            "vendor": "Cross",
            "url": "https://booth.pm/ja/items/4815162",
            "price": 2900,
            "status": "confirmed",
            "archives": [".AASHAREE/CLOTHS/Cross_Maid_Fullset.zip"],
            "variants": []
        });
        for (k, v) in over.as_object().unwrap() {
            base[k] = v.clone();
        }
        base
    }

    #[test]
    fn a_booth_product_puts_its_listing_under_booth_and_the_rest_under_vrchat() {
        let object = object_of(&product(json!({}))).unwrap();

        assert_eq!(object["paths"], json!(["Clothing/Cross_Maid_Fullset", ".AASHAREE/CLOTHS/Cross_Maid_Fullset"]));
        assert_eq!(object["folders"], object["paths"]);
        assert_eq!(object["id"], "Clothing/Cross_Maid_Fullset");
        let values = &object["values"];
        assert_eq!(values["vrchat#1/category"], "Clothing");
        assert_eq!(values["vrchat#1/vendor"], "Cross");
        assert_eq!(values["vrchat#1/status"], "confirmed");
        assert_eq!(values["booth#1/url"], "https://booth.pm/ja/items/4815162");
        assert_eq!(values["booth#1/item_id"], "4815162");
        assert_eq!(values["booth#1/price"], "2900");
        assert_eq!(values["booth#1/title"], "Cross Maid");
        assert!(values.get("title").is_none(), "a shop title is a source, not the bare field");
    }

    #[test]
    fn a_product_without_a_listing_gets_a_bare_title() {
        // Typed by a person from a license PDF or a promo image: that is
        // what a bare field means.
        let object = object_of(&product(json!({ "url": null, "price": null, "status": "vendor-from-package" }))).unwrap();

        assert_eq!(object["values"]["title"], "Cross Maid");
        assert!(object["values"].get("booth#1/url").is_none());
    }

    #[test]
    fn a_non_booth_source_is_kept_without_claiming_to_be_booth() {
        let object = object_of(&product(json!({ "url": "https://gumroad.com/l/x" }))).unwrap();

        assert_eq!(object["values"]["vrchat#1/source_url"], "https://gumroad.com/l/x");
        assert!(object["values"].get("booth#1/url").is_none());
    }

    #[test]
    fn a_booth_shop_front_is_a_source_and_not_a_listing() {
        // 24 of the seed's Booth URLs name the shop, not the product.
        let object = object_of(&product(json!({ "url": "https://ikshop.booth.pm/" }))).unwrap();

        assert_eq!(object["values"]["vrchat#1/source_url"], "https://ikshop.booth.pm/");
        assert_eq!(object["values"]["title"], "Cross Maid");
        assert!(object["values"].get("booth#1/url").is_none());
    }

    #[test]
    fn avatars_become_supports_edges_and_archives_become_archived_as_in_both_layouts() {
        let object = object_of(&product(json!({}))).unwrap();
        let edges = object["edges"].as_array().unwrap();

        assert!(edges.contains(&json!({ "kind": "supports", "term": "avatar:manuka" })));
        assert!(edges.contains(&json!({ "kind": "supports", "term": "avatar:kikyo" })));
        assert!(edges.contains(&json!({ "kind": "archived-as", "object": ".AASHAREE/CLOTHS/Cross_Maid_Fullset.zip" })));
        assert!(edges.contains(&json!({ "kind": "archived-as", "object": "_Archive/Cross_Maid_Fullset.zip" })));
    }

    #[test]
    fn a_file_product_is_not_a_folder() {
        let object = object_of(&product(json!({ "from": "a/x.unitypackage", "to": "Hair/x.unitypackage" }))).unwrap();
        assert_eq!(object["folders"], json!([]));

        // A version number after a dot is not an extension.
        assert!(!looks_like_file("Accessory/Endeavor_v1.0.4"));
        assert!(looks_like_file(".Trinkets/FVeil.unitypackage"));
        assert!(!looks_like_file(".LAPWING"));
    }

    #[test]
    fn every_avatar_a_product_names_gets_a_term_even_if_the_vocabulary_forgot_it() {
        let document = convert(
            &json!([product(json!({ "avatars": ["manuka", "nagi"] }))]),
            &json!(["manuka"]),
            &json!({ "manuka": ["Manuka", "マヌカ"] }),
        )
        .unwrap();

        let terms = document["terms"].as_array().unwrap();
        assert_eq!(terms.len(), 2);
        assert_eq!(terms[0], json!({ "vocab": "avatar", "id": "manuka", "label": "Manuka", "aliases": ["Manuka", "マヌカ"] }));
        assert_eq!(terms[1]["label"], "Nagi");
    }

    #[test]
    fn the_real_seed_converts_whole() {
        let seed = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("seed");
        let document = convert(
            &read(&seed.join("manifest.json")).unwrap(),
            &read(&seed.join("av.json")).unwrap(),
            &read(&seed.join("alias.json")).unwrap(),
        )
        .unwrap();

        assert_eq!(document["objects"].as_array().unwrap().len(), 174);
        // 67 listed plus the 9 only products mention.
        assert_eq!(document["terms"].as_array().unwrap().len(), 76);
        // And the core reads it as a document.
        yukifile::contract::Document::parse(&document.to_string()).expect("a contract document");
    }
}
