//! Finding objects by what they hold, and counting what there is to find.
//!
//! The grid's sidebar narrows the library by what an object *is* (a
//! property), what it *says* under a field a plugin named as a facet, and what
//! it *points at* in a vocabulary. Typed text narrows it further. None of that
//! is domain knowledge: the core counts values, properties and edges, and the
//! plugins say which fields are worth counting.
//!
//! # One pass over the whole library
//!
//! A filter has to look at every object before it can say how many match, and
//! a facet count is the same pass asked a different question. So both read
//! the library in five queries -- ids, values, locations, decided properties,
//! term edges -- and do the rest in memory. The seed library is 173 objects;
//! a library ten times that is still a few thousand rows, read in
//! milliseconds, which is less than a keystroke is worth.
//!
//! # A field means the value an object shows
//!
//! `category` is filtered by the value the object page would show under that
//! name: a pinned source, else the person's own, else the first mount's. For
//! a field no mounted plugin shares, the first mount (in mount order) holding
//! a private value of that name. A facet on a namespaced path would tie the
//! sidebar to one plugin's instance numbering, which is a detail the person
//! browsing never chose.
//!
//! # Within a group, any; across groups, all
//!
//! Choosing two categories shows things in either; choosing a category and an
//! avatar shows things that are both. That is what a person ticking boxes in a
//! sidebar expects, and the counts follow it: the numbers beside one group are
//! computed with that group's own choices set aside, so they say what ticking
//! another box *there* would add rather than collapsing to the one already
//! ticked.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::bridge::{BridgeError, Library};
use crate::plugin::registry::Registry;
use crate::scan::reconcile::Known;
use crate::store::flatten::{self, StoredValue};
use crate::store::{carried, edges, paths, values, vocab};

/// What to narrow the library to. Every part is optional; an empty filter
/// matches everything.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct Filter {
    /// Words that must all appear, ignoring case, somewhere in the object's
    /// values, locations or the names of the terms it points at.
    pub text: String,
    /// Properties the object carries: any of them.
    pub properties: Vec<String>,
    /// Field values. Several for one field mean any of them; several fields
    /// mean all of them.
    pub fields: Vec<FieldIs>,
    /// Terms pointed at. Several in one vocabulary mean any of them; several
    /// vocabularies mean all of them.
    pub terms: Vec<TermIs>,
    /// Only what this object contains, one level down. An id, as ids cross.
    pub within: Option<String>,
    /// Only what nothing contains: the top of the tree a plugin built.
    pub top: bool,
}

/// One field value to match. `value: None` matches objects that show nothing
/// under the field, which is how a person finds what still needs sorting.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct FieldIs {
    pub field: String,
    #[serde(default)]
    pub value: Option<String>,
}

/// One term to match.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct TermIs {
    pub vocab: String,
    pub term: String,
}

impl Filter {
    /// True when the filter narrows nothing.
    pub fn is_empty(&self) -> bool {
        self.text.trim().is_empty()
            && self.properties.is_empty()
            && self.fields.is_empty()
            && self.terms.is_empty()
    }

    /// The container asked for, if any.
    fn container(&self) -> Result<Option<i64>, BridgeError> {
        self.within
            .as_deref()
            .map(|id| {
                id.parse::<i64>()
                    .map_err(|_| BridgeError::BadRequest(format!("{id:?} is not an object id")))
            })
            .transpose()
    }
}

/// How the matches are ordered.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sort {
    /// By the name a card shows, ignoring case. What a person scanning a
    /// grid for a thing they can name expects.
    #[default]
    Name,
    /// Most recently made first. Ids carry the millisecond an object was
    /// made in, so this is creation order to the millisecond; two made in
    /// the same one are in no promised order.
    Newest,
    /// Oldest first, the order the library was filled in, to the same
    /// precision.
    Oldest,
}

/// One object as a filter sees it.
#[derive(Debug, Clone, Default)]
struct Record {
    id: i64,
    /// The name a card shows, for sorting.
    name: String,
    /// Everything text can match, lowercased and joined.
    haystack: String,
    /// Property names, without instance numbers.
    properties: BTreeSet<String>,
    /// The value shown under each field asked about.
    fields: HashMap<String, Option<String>>,
    /// (vocab, term) pairs pointed at.
    terms: HashSet<(String, String)>,
    /// What contains this object.
    parents: Vec<i64>,
}

/// Which group's own choices to set aside when counting it.
#[derive(Debug, Clone, Copy)]
enum Except<'a> {
    Nothing,
    Properties,
    Field(&'a str),
    Vocab(&'a str),
}

/// The words a text filter asks for.
fn words(text: &str) -> Vec<String> {
    text.split_whitespace().map(str::to_lowercase).collect()
}

fn matches(
    record: &Record,
    filter: &Filter,
    container: Option<i64>,
    needles: &[String],
    except: Except<'_>,
) -> bool {
    if let Some(container) = container {
        if !record.parents.contains(&container) {
            return false;
        }
    }
    if filter.top && !record.parents.is_empty() {
        return false;
    }

    if !needles.iter().all(|needle| record.haystack.contains(needle.as_str())) {
        return false;
    }

    if !matches!(except, Except::Properties)
        && !filter.properties.is_empty()
        && !filter.properties.iter().any(|p| record.properties.contains(p))
    {
        return false;
    }

    // Grouped by field, so two values for one field are alternatives.
    let mut by_field: BTreeMap<&str, Vec<&Option<String>>> = BTreeMap::new();
    for clause in &filter.fields {
        by_field.entry(clause.field.as_str()).or_default().push(&clause.value);
    }
    for (field, wanted) in by_field {
        if matches!(except, Except::Field(skipped) if skipped == field) {
            continue;
        }
        let shown = record.fields.get(field).cloned().flatten();
        if !wanted.iter().any(|value| **value == shown) {
            return false;
        }
    }

    let mut by_vocab: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for clause in &filter.terms {
        by_vocab.entry(clause.vocab.as_str()).or_default().push(clause.term.as_str());
    }
    for (vocab, wanted) in by_vocab {
        if matches!(except, Except::Vocab(skipped) if skipped == vocab) {
            continue;
        }
        if !wanted.iter().any(|term| record.terms.contains(&(vocab.to_string(), term.to_string()))) {
            return false;
        }
    }

    true
}

/// Read the library into records, resolving the fields named.
fn records(
    connection: &Connection,
    registry: Option<&Registry>,
    wanted_fields: &BTreeSet<String>,
) -> Result<Vec<Record>, BridgeError> {
    let ids = values::all_object_ids(connection)?;
    let mut rows = values::all_rows(connection)?;
    let mut located = paths::all_located(connection)?;
    let mut decided = carried::all(connection)?;

    let mut labels: HashMap<(String, String), String> = HashMap::new();
    let mut parents: HashMap<i64, Vec<i64>> = HashMap::new();
    for (container, contained) in edges::all_contains(connection)? {
        parents.entry(contained).or_default().push(container);
    }

    let mut pointed: HashMap<i64, Vec<(String, String)>> = HashMap::new();
    for (src, vocabulary, term) in edges::all_to_terms(connection)? {
        if !labels.contains_key(&(vocabulary.clone(), term.clone())) {
            let label = vocab::term(connection, &vocabulary, &term)?
                .map(|found| found.label)
                .unwrap_or_else(|| term.clone());
            labels.insert((vocabulary.clone(), term.clone()), label);
        }
        pointed.entry(src).or_default().push((vocabulary, term));
    }

    let order = resolved_order(connection, registry)?;
    let mounts = values::mounts(&order);
    let mount_names: Vec<String> =
        order.iter().map(|m| format!("{}#{}", m.namespace, m.instance)).collect();
    let rules = crate::bridge::commands::rules_from(registry);

    let mut built = Vec::with_capacity(ids.len());
    for id in ids {
        let held: Vec<StoredValue> = rows.remove(&id).unwrap_or_default();
        let at: Vec<Known> = located.remove(&id).unwrap_or_default();
        let chosen = decided.remove(&id).unwrap_or_default();
        let terms = pointed.remove(&id).unwrap_or_default();

        let view = flatten::flatten(&held, &mounts);
        let carries = crate::bridge::commands::carries_of(&view, &at, &rules, &chosen);

        let mut fields = HashMap::new();
        for field in wanted_fields {
            fields.insert(field.clone(), shown(&view, &order, field));
        }

        let name = crate::bridge::commands::card_field(&held, "title", &mount_names)
            .or_else(|| at.first().and_then(|k| k.path.rsplit('/').next()).map(str::to_string))
            .unwrap_or_default();

        let mut haystack = String::new();
        for value in &held {
            if value.path.starts_with('@') {
                continue;
            }
            haystack.push_str(&value.value.to_lowercase());
            haystack.push('\n');
        }
        for known in &at {
            haystack.push_str(&known.path.to_lowercase());
            haystack.push('\n');
        }
        for key in &terms {
            if let Some(label) = labels.get(key) {
                haystack.push_str(&label.to_lowercase());
                haystack.push('\n');
            }
            haystack.push_str(&key.1.to_lowercase());
            haystack.push('\n');
        }

        built.push(Record {
            id,
            name,
            haystack,
            properties: carries
                .iter()
                .map(|carried| carried.split('#').next().unwrap_or(carried).to_string())
                .collect(),
            fields,
            terms: terms.into_iter().collect(),
            parents: parents.remove(&id).unwrap_or_default(),
        });
    }

    Ok(built)
}

/// The library's mount order, with each mount told which fields its plugin
/// shares. What flattening needs to resolve a field the way a page does.
pub(crate) fn resolved_order(
    connection: &Connection,
    registry: Option<&Registry>,
) -> Result<Vec<values::MountRow>, BridgeError> {
    let mut order = values::mount_order(connection)?;
    if let Some(registry) = registry {
        let shared = registry.shared_fields();
        for row in &mut order {
            if let Some(fields) = shared.get(row.namespace.as_str()) {
                row.shared = fields.to_vec();
            }
        }
    }
    // The application's own finds are a source of the cover and nothing
    // else; no manifest says so, because no plugin owns them.
    for row in &mut order {
        if row.namespace == crate::store::path::FOUND {
            row.shared = vec!["cover".to_string()];
        }
    }
    Ok(order)
}

/// The value an object shows under `field`: the shared value if a mounted
/// plugin shares it, else the first mount's private value of that name.
pub(crate) fn shown(view: &flatten::FlatView<'_>, order: &[values::MountRow], field: &str) -> Option<String> {
    view.value(field).map(str::to_string).or_else(|| {
        view.plugin_mounts()
            .filter_map(|mount| {
                let rank = order
                    .iter()
                    .position(|m| m.namespace == mount.0 && m.instance == mount.1)?;
                Some((rank, view.plugin_value(mount, field)?))
            })
            .min_by_key(|(rank, _)| *rank)
            .map(|(_, value)| value.to_string())
    })
}

/// Fields a filter mentions.
fn fields_in(filter: &Filter) -> BTreeSet<String> {
    filter.fields.iter().map(|clause| clause.field.clone()).collect()
}

/// A page of the objects a filter matches, and how many match in all.
pub fn object_query_in(
    library: &Library,
    registry: Option<&Registry>,
    filter: Filter,
    sort: Sort,
    offset: u32,
    limit: u32,
) -> Result<QueryView, BridgeError> {
    // The same cap `object.ids` keeps, for the same reason: a caller asking
    // for everything gets a page.
    let limit = limit.clamp(1, 500) as usize;
    let needles = words(&filter.text);
    let container = filter.container()?;

    library.with_connection(|connection| {
        let mut found: Vec<Record> = records(connection, registry, &fields_in(&filter))?
            .into_iter()
            .filter(|record| matches(record, &filter, container, &needles, Except::Nothing))
            .collect();

        match sort {
            Sort::Name => found.sort_by(|a, b| {
                a.name.to_lowercase().cmp(&b.name.to_lowercase()).then(a.id.cmp(&b.id))
            }),
            Sort::Newest => found.sort_by(|a, b| b.id.cmp(&a.id)),
            Sort::Oldest => found.sort_by(|a, b| a.id.cmp(&b.id)),
        }

        let total = found.len() as i64;
        let ids = found.into_iter().skip(offset as usize).take(limit).map(|r| r.id).collect();
        Ok(QueryView { ids, total })
    })
}

/// A page of matches.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct QueryView {
    #[serde(serialize_with = "crate::bridge::views::ids_as_strings::serialize")]
    pub ids: Vec<i64>,
    /// How many objects match, across every page.
    pub total: i64,
}

/// What there is to choose from in each group, counted against the filter.
pub fn object_facets_in(
    library: &Library,
    registry: Option<&Registry>,
    filter: Filter,
    fields: Vec<String>,
    vocabularies: Vec<String>,
) -> Result<FacetsView, BridgeError> {
    let needles = words(&filter.text);
    let container = filter.container()?;
    let mut wanted = fields_in(&filter);
    wanted.extend(fields.iter().cloned());

    library.with_connection(|connection| {
        let all = records(connection, registry, &wanted)?;

        let total = all
            .iter()
            .filter(|record| matches(record, &filter, container, &needles, Except::Nothing))
            .count() as i64;

        let mut properties: BTreeMap<String, i64> = BTreeMap::new();
        for record in all.iter().filter(|r| matches(r, &filter, container, &needles, Except::Properties)) {
            for property in &record.properties {
                *properties.entry(property.clone()).or_default() += 1;
            }
        }

        let mut field_facets = Vec::with_capacity(fields.len());
        for field in &fields {
            let mut counts: BTreeMap<Option<String>, i64> = BTreeMap::new();
            for record in all.iter().filter(|r| matches(r, &filter, container, &needles, Except::Field(field))) {
                let shown = record.fields.get(field).cloned().flatten();
                *counts.entry(shown).or_default() += 1;
            }
            field_facets.push(FieldFacet { field: field.clone(), values: ranked(counts) });
        }

        let mut vocab_facets = Vec::with_capacity(vocabularies.len());
        for vocabulary in &vocabularies {
            let mut counts: BTreeMap<String, i64> = BTreeMap::new();
            for record in all.iter().filter(|r| matches(r, &filter, container, &needles, Except::Vocab(vocabulary))) {
                for (v, term) in &record.terms {
                    if v == vocabulary {
                        *counts.entry(term.clone()).or_default() += 1;
                    }
                }
            }
            let mut terms = Vec::with_capacity(counts.len());
            for (term, count) in counts {
                let label = vocab::term(connection, vocabulary, &term)?
                    .map(|found| found.label)
                    .unwrap_or_else(|| term.clone());
                terms.push(TermCount { id: term, label, count });
            }
            terms.sort_by(|a, b| b.count.cmp(&a.count).then(a.label.to_lowercase().cmp(&b.label.to_lowercase())));
            vocab_facets.push(VocabFacet { vocab: vocabulary.clone(), terms });
        }

        let mut properties: Vec<PropertyCount> = properties
            .into_iter()
            .map(|(property, count)| PropertyCount { property, count })
            .collect();
        properties.sort_by(|a, b| b.count.cmp(&a.count).then(a.property.cmp(&b.property)));

        Ok(FacetsView { total, properties, fields: field_facets, vocabularies: vocab_facets })
    })
}

/// Most common first, then alphabetical; the empty bucket last, since it is
/// a remainder rather than a value.
fn ranked(counts: BTreeMap<Option<String>, i64>) -> Vec<ValueCount> {
    let mut values: Vec<ValueCount> = counts
        .into_iter()
        .map(|(value, count)| ValueCount { value, count })
        .collect();
    values.sort_by(|a, b| {
        a.value
            .is_none()
            .cmp(&b.value.is_none())
            .then(b.count.cmp(&a.count))
            .then(a.value.cmp(&b.value))
    });
    values
}

/// Counts for every group the sidebar draws.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FacetsView {
    /// How many objects the whole filter matches.
    pub total: i64,
    pub properties: Vec<PropertyCount>,
    pub fields: Vec<FieldFacet>,
    pub vocabularies: Vec<VocabFacet>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PropertyCount {
    pub property: String,
    pub count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FieldFacet {
    pub field: String,
    pub values: Vec<ValueCount>,
}

/// One value of a field and how many objects show it. `None` counts the
/// objects showing nothing under the field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ValueCount {
    pub value: Option<String>,
    pub count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VocabFacet {
    pub vocab: String,
    /// Only terms something points at, most pointed at first.
    pub terms: Vec<TermCount>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TermCount {
    pub id: String,
    pub label: String,
    pub count: i64,
}

#[tauri::command]
pub async fn object_query(
    library: tauri::State<'_, Library>,
    registry: tauri::State<'_, Registry>,
    filter: Option<Filter>,
    sort: Option<Sort>,
    offset: Option<u32>,
    limit: u32,
) -> Result<QueryView, BridgeError> {
    object_query_in(
        &library,
        Some(&registry),
        filter.unwrap_or_default(),
        sort.unwrap_or_default(),
        offset.unwrap_or(0),
        limit,
    )
}

#[tauri::command]
pub async fn object_facets(
    library: tauri::State<'_, Library>,
    registry: tauri::State<'_, Registry>,
    filter: Option<Filter>,
    fields: Vec<String>,
    vocabularies: Vec<String>,
) -> Result<FacetsView, BridgeError> {
    object_facets_in(&library, Some(&registry), filter.unwrap_or_default(), fields, vocabularies)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: i64) -> Record {
        Record { id, ..Default::default() }
    }

    #[test]
    fn every_word_has_to_appear() {
        let mut r = record(1);
        r.haystack = "cross maid\nclothing/cross_maid\n".into();
        let filter = Filter { text: "MAID cross".into(), ..Default::default() };
        assert!(matches(&r, &filter, None, &words(&filter.text), Except::Nothing));
        let filter = Filter { text: "maid hair".into(), ..Default::default() };
        assert!(!matches(&r, &filter, None, &words(&filter.text), Except::Nothing));
    }

    #[test]
    fn two_values_of_one_field_are_alternatives_and_two_fields_are_both() {
        let mut r = record(1);
        r.fields.insert("category".into(), Some("Hair".into()));
        r.fields.insert("vendor".into(), Some("Yuki".into()));

        let either = Filter {
            fields: vec![
                FieldIs { field: "category".into(), value: Some("Clothing".into()) },
                FieldIs { field: "category".into(), value: Some("Hair".into()) },
            ],
            ..Default::default()
        };
        assert!(matches(&r, &either, None, &[], Except::Nothing));

        let both = Filter {
            fields: vec![
                FieldIs { field: "category".into(), value: Some("Hair".into()) },
                FieldIs { field: "vendor".into(), value: Some("Someone else".into()) },
            ],
            ..Default::default()
        };
        assert!(!matches(&r, &both, None, &[], Except::Nothing));
        // Counting vendors sets the vendor choice aside, so this object still
        // counts toward its own vendor.
        assert!(matches(&r, &both, None, &[], Except::Field("vendor")));
    }

    #[test]
    fn nothing_under_a_field_is_a_value_that_can_be_chosen() {
        let r = record(1);
        let unsorted = Filter {
            fields: vec![FieldIs { field: "category".into(), value: None }],
            ..Default::default()
        };
        assert!(matches(&r, &unsorted, None, &[], Except::Nothing));
    }

    #[test]
    fn terms_in_one_vocabulary_are_alternatives() {
        let mut r = record(1);
        r.terms.insert(("avatar".into(), "airi".into()));
        let filter = Filter {
            terms: vec![
                TermIs { vocab: "avatar".into(), term: "manuka".into() },
                TermIs { vocab: "avatar".into(), term: "airi".into() },
            ],
            ..Default::default()
        };
        assert!(matches(&r, &filter, None, &[], Except::Nothing));
    }

    #[test]
    fn the_empty_bucket_ranks_last_however_large() {
        let mut counts = BTreeMap::new();
        counts.insert(None, 50);
        counts.insert(Some("Hair".to_string()), 3);
        counts.insert(Some("Clothing".to_string()), 9);
        let ranked = ranked(counts);
        let order: Vec<Option<&str>> = ranked.iter().map(|v| v.value.as_deref()).collect();
        assert_eq!(order, [Some("Clothing"), Some("Hair"), None]);
    }
}
