//! The commands themselves.
//!
//! Every function here is one row of [`crate::plugin::commands::ALLOWED`] made
//! callable. They are thin on purpose: parse what the plugin sent, call the
//! core function that already does the work, convert the result into something
//! serialisable. No logic of its own, because the logic is in `store`,
//! `commands` and `changes` already, and a second copy behind an IPC boundary
//! is a copy that drifts where nobody is testing it.
//!
//! # Naming is mechanical
//!
//! `object.get` on the list is `object_get` here. The mapping is a `replace`,
//! not a table somebody maintains, so a command cannot be on the list under
//! one name and implemented under another.
//!
//! # Every path goes through the library
//!
//! Commands never touch a path a plugin sent. They call
//! [`Library::resolve`], which refuses anything landing outside the library
//! root. Without that, `hash.of` — a read-only command whose stated reason is
//! finding duplicates — would hash any file on the machine.

use std::collections::BTreeMap;

use tauri::State;

use crate::bridge::error::BridgeError;
use crate::bridge::views::{
    EdgeView, FlatObjectView, LocationView, HistoryView, ObjectView, RegionView, SkippedView,
    SourceView, TermView, ValueView,
};
use crate::bridge::Library;
use crate::changes;
use crate::commands::{archive, hash, scan};
use crate::scan::factual::Rules;
use crate::plugin::manifest::Manifest;
use crate::plugin::registry::Registry;
use crate::store::{edges, flatten, history, values, vocab};

/// One object's stored values.
#[tauri::command]
pub fn object_get(
    library: State<'_, Library>,
    id: String,
) -> Result<ObjectView, BridgeError> {
    object_get_in(&library, parse_id(&id)?)
}

/// One object's stored values.
pub fn object_get_in(library: &Library, id: i64) -> Result<ObjectView, BridgeError> {
    library.with_connection(|connection| {
        let store = values::Values::new();
        let rows = store
            .rows(connection, id)
            .map_err(|error| BridgeError::Storage(error.to_string()))?;

        // An object with no values is not the same as no object. Telling them
        // apart matters to a panel deciding between "nothing here yet" and
        // "this id is wrong".
        if rows.is_empty() && !object_exists(connection, id)? {
            return Err(BridgeError::NoSuchObject(id.to_string()));
        }

        Ok(ObjectView { id, values: rows.iter().map(ValueView::from).collect() })
    })
}

/// One object resolved into what to show.
///
/// `object.get` returns values under their stored paths; this returns them
/// resolved -- shared fields with every source ranked, private fields grouped
/// by the region that owns them.
///
/// Resolution runs here rather than in TypeScript because search, sort and
/// export all need the same answer, and two implementations of one rule drift
/// apart. The object page is only the first caller.
///
/// # Which fields are shared comes from the manifests
///
/// `values::mount_order` reads the mounts table, which holds no opinion about
/// sharing -- it predates the plugin host. The registry does hold that opinion,
/// because each manifest declares it. Joining the two here is what makes
/// `booth#1/title` a source for `title` instead of a field Booth keeps to
/// itself.
///
/// Without a registry every field stays private, which is the safe reading of
/// "no manifest has said otherwise" rather than a degraded mode: a library
/// running no plugins has nothing that could be sharing a name.
pub fn object_flat_in(
    library: &Library,
    registry: Option<&Registry>,
    id: i64,
) -> Result<FlatObjectView, BridgeError> {
    library.with_connection(|connection| {
        log::debug!("resolving object {id}");
        let store = values::Values::new();
        let rows = store
            .rows(connection, id)
            .map_err(|error| BridgeError::Storage(error.to_string()))?;

        if rows.is_empty() && !object_exists(connection, id)? {
            return Err(BridgeError::NoSuchObject(id.to_string()));
        }

        let mut order = values::mount_order(connection)?;
        if let Some(registry) = registry {
            let shared = registry.shared_fields();
            for row in &mut order {
                if let Some(fields) = shared.get(row.namespace.as_str()) {
                    row.shared = fields.to_vec();
                }
            }
        }

        let mounts = values::mounts(&order);
        let view = flatten::flatten(&rows, &mounts);

        let located = crate::store::paths::located(connection, id)?;
        let locations = located
            .iter()
            .cloned()
            .map(|known| LocationView {
                path: known.path,
                kind: match known.kind {
                    crate::scan::walk::Kind::Folder => "folder".to_string(),
                    crate::scan::walk::Kind::File => "file".to_string(),
                },
                size: known.size,
            })
            .collect();

        // What the object carries comes from the properties its locations
        // bring, plus anything values already mention. The first is what a
        // scan knows; the second is what a plugin has written.
        let rules = rules_from(registry);
        let mut carries: std::collections::BTreeSet<String> = view
            .plugin_mounts()
            .map(|(namespace, instance)| format!("{namespace}#{instance}"))
            .collect();

        for known in &located {
            let entry = crate::scan::walk::Entry {
                path: known.path.clone(),
                kind: known.kind,
                size: known.size,
                mtime: known.mtime,
            };
            for property in rules.properties(&entry) {
                carries.insert(format!("{property}#1"));
            }
        }

        Ok(FlatObjectView {
            locations,
            carries: carries.into_iter().collect(),
            ..as_flat_view(id, &view)
        })
    })
}

/// Turn a resolved view into what crosses the boundary.
fn as_flat_view(id: i64, view: &flatten::FlatView<'_>) -> FlatObjectView {
    let mut shared: BTreeMap<String, Vec<SourceView>> = BTreeMap::new();
    for field in view.fields() {
        let sources = view
            .sources(field)
            .iter()
            .map(|source| SourceView {
                value: source.value.to_string(),
                from: match source.origin {
                    flatten::Origin::Bare => None,
                    flatten::Origin::Mounted { namespace, instance } => {
                        Some(format!("{namespace}#{instance}"))
                    }
                },
            })
            .collect();
        shared.insert(field.to_string(), sources);
    }

    // Sorted, so two reads of one object agree about region order beyond what
    // mount order already fixes. A HashMap would hand back a different order
    // per run and make a diff of two pages meaningless.
    let mut regions: Vec<RegionView> = view
        .plugin_mounts()
        .map(|mount| RegionView {
            property: mount.0.to_string(),
            instance: mount.1,
            fields: view
                .plugin_fields(mount)
                .map(|(name, value)| (name.to_string(), value.to_string()))
                .collect(),
        })
        .collect();
    regions.sort_by(|a, b| (&a.property, a.instance).cmp(&(&b.property, b.instance)));

    let skipped = view
        .skipped()
        .iter()
        .filter_map(|skipped| {
            // NotMounted is routine: an object may carry values written by a
            // plugin that is not installed, and they wait in storage until it
            // is. Reporting it would put a permanent warning on healthy
            // objects, and a warning that is always there is one nobody reads.
            let reason = match &skipped.reason {
                flatten::SkipReason::NotMounted => return None,
                flatten::SkipReason::Malformed(error) => format!("malformed path: {error}"),
                flatten::SkipReason::PinNotMounted => {
                    "pinned to a source this library does not mount".to_string()
                }
                flatten::SkipReason::PinOnUnsharedField => {
                    "pinned on a field no mounted plugin shares".to_string()
                }
            };
            Some(SkippedView { path: skipped.path.to_string(), reason })
        })
        .collect();

    FlatObjectView {
        id,
        shared,
        regions,
        skipped,
        carries: Vec::new(),
        locations: Vec::new(),
    }
}

/// A page of object ids, lowest first.
///
/// `after` is the last id the caller saw, so paging is by cursor rather than
/// by page number -- a number drifts as objects are added, and a grid that
/// skipped an object because one arrived mid-scroll would be wrong in a way
/// nobody reports.
pub fn object_ids_in(
    library: &Library,
    after: Option<i64>,
    limit: u32,
) -> Result<ObjectIdsView, BridgeError> {
    // A caller asking for everything gets a page anyway. The cap is here and
    // not in the store because it is a boundary decision: the store is free to
    // read what it likes, a plugin is not.
    let limit = limit.clamp(1, 500);

    library.with_connection(|connection| {
        Ok(ObjectIdsView {
            ids: values::object_ids(connection, after, limit)?,
            total: values::object_count(connection)?,
        })
    })
}

/// A page of ids, and how many there are in total.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ObjectIdsView {
    #[serde(serialize_with = "crate::bridge::views::ids_as_strings::serialize")]
    pub ids: Vec<i64>,
    /// Every object in the library, so a caller knows whether it has them all.
    pub total: i64,
}

/// The manifests of every loaded plugin.
///
/// Slot arbitration runs in the frontend and needs them; they are read from
/// disk in Rust at startup. This is the only way across.
pub fn plugin_list_in(registry: Option<&Registry>) -> Vec<Manifest> {
    registry.map(|r| r.plugins().to_vec()).unwrap_or_default()
}

/// This library's mount order, lowest position first.
pub fn mount_order_in(library: &Library) -> Result<Vec<MountView>, BridgeError> {
    library.with_connection(|connection| {
        Ok(values::mount_order(connection)?
            .into_iter()
            .map(|row| MountView { namespace: row.namespace, instance: row.instance })
            .collect())
    })
}

/// One mounted property instance.
///
/// The `shared` list is deliberately absent: which fields are shared comes
/// from the manifests, which the caller already has from `plugin.list`.
/// Sending it twice would give the frontend two answers to keep in step.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct MountView {
    pub namespace: String,
    pub instance: u32,
}


/// Bring the library up to date with the disk.
///
/// On [`crate::plugin::commands::APP_ONLY`] rather than the plugin list: this
/// writes directly, and a plugin that could do that is what change sets exist
/// to prevent. A person pressing a button is a different thing from a plugin
/// deciding to.
///
/// The whole scan runs in one transaction. Half a scan is a library whose
/// paths describe a disk that never existed.
pub fn library_scan_in(
    library: &Library,
    registry: Option<&Registry>,
) -> Result<ScanView, BridgeError> {
    // Which extensions bring which properties comes from the manifests. With
    // no plugins loaded every file is a `file` and nothing more, which is what
    // a scan should report rather than guessing on its own.
    let rules = rules_from(registry);

    let root = library.root().to_path_buf();

    library.with_connection_mut(|connection| {
        crate::store::schema::in_transaction(connection, |transaction| {
            let mut store = values::Values::new();
            let outcome = scan::run(transaction, &mut store, &root, &rules)
                .map_err(|error| BridgeError::Storage(error.to_string()))?;

            // What a scan did, in one line. This is the line worth having when
            // somebody reports that a folder did not show up: it says whether
            // the scan saw it at all.
            log::info!(
                "scanned {}: {} added, {} removed, {} moved, {} touched, {} candidates",
                root.display(),
                outcome.added,
                outcome.removed,
                outcome.moved,
                outcome.touched,
                outcome.candidates
            );
            for path in &outcome.unreadable {
                log::warn!("could not read {path}");
            }

            Ok(ScanView {
                added: outcome.added,
                removed: outcome.removed,
                moved: outcome.moved,
                touched: outcome.touched,
                objects_created: outcome.objects_created,
                candidates: outcome.candidates,
                unreadable: outcome.unreadable,
            })
        })
    })
}

/// The file-type rules the loaded plugins declare.
fn rules_from(registry: Option<&Registry>) -> Rules {
    let mut rules = Rules::new();
    let Some(registry) = registry else { return rules };

    for plugin in registry.plugins() {
        for (extension, properties) in &plugin.contributes.file_types {
            for property in properties {
                rules.add(extension, property);
            }
        }
    }
    rules
}

/// What a scan did.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ScanView {
    pub added: usize,
    pub removed: usize,
    pub moved: usize,
    pub touched: usize,
    pub objects_created: usize,
    /// Paths that might be moves, waiting on a hash to say.
    pub candidates: usize,
    /// Paths that could not be read. Reported rather than dropped: a folder
    /// the scan could not open is a hole in the library, not an absence.
    pub unreadable: Vec<String>,
}


/// A name and a path for each of a page of objects.
///
/// What a list needs, and only that. Resolving each object fully would read
/// every value and every mount for a row that shows one line of text.
///
/// The name is the object's title if it has one, and its filename otherwise.
/// Most objects have no title — a scan records where things are before anybody
/// names them — so the filename is the common case rather than the fallback.
pub fn object_summaries_in(
    library: &Library,
    ids: Vec<i64>,
) -> Result<Vec<SummaryView>, BridgeError> {
    library.with_connection(|connection| {
        let store = values::Values::new();
        let located = crate::store::paths::first_of_each(connection, &ids)?;

        let mut summaries = Vec::with_capacity(ids.len());
        for id in ids {
            // The bare `title` only. A shop's title is a source for it, and
            // ranking sources means resolving the object, which is what this
            // command exists not to do.
            let title = store
                .get(connection, id, "title")
                .map_err(|error| BridgeError::Storage(error.to_string()))?;

            let (path, kind) = match located.get(&id) {
                Some((path, kind)) => (Some(path.clone()), Some(kind.clone())),
                None => (None, None),
            };

            let name = title.clone().or_else(|| {
                path.as_deref()
                    .and_then(|p| p.rsplit('/').next())
                    .map(str::to_string)
            });

            summaries.push(SummaryView { id, name, path, kind });
        }

        Ok(summaries)
    })
}

/// One row in a list.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct SummaryView {
    #[serde(with = "crate::bridge::views::id_as_string")]
    pub id: i64,
    /// The title, or the filename, or nothing for an unnamed grouping.
    pub name: Option<String>,
    /// Its first location. Absent for a grouping.
    pub path: Option<String>,
    /// `file` or `folder`, when it has a location.
    pub kind: Option<String>,
}


/// Several objects at once, for a column rendering across a page.
///
/// Missing ids are left out rather than failing the call: a grid asking for
/// forty objects while one is being deleted should draw thirty-nine, not
/// nothing.
pub fn object_list_in(
    library: &Library,
    ids: Vec<i64>,
) -> Result<Vec<ObjectView>, BridgeError> {
    library.with_connection(|connection| {
        let store = values::Values::new();
        let mut found = Vec::new();

        for id in ids {
            let rows = store
                .rows(connection, id)
                .map_err(|error| BridgeError::Storage(error.to_string()))?;
            if rows.is_empty() && !object_exists(connection, id)? {
                continue;
            }
            found.push(ObjectView { id, values: rows.iter().map(ValueView::from).collect() });
        }

        Ok(found)
    })
}

/// What an object requires, supports or contains.
pub fn object_edges_in(
    library: &Library,
    id: i64,
) -> Result<Vec<EdgeView>, BridgeError> {
    library.with_connection(|connection| {
        let found = edges::from(connection, id, None)?;
        Ok(found.iter().map(EdgeView::from).collect())
    })
}

/// Map a spelling to a term.
///
/// `桔梗`, `Kikyo` and `Kikyou` are one avatar, and a plugin reading filenames
/// needs the same answer the rest of the library uses.
pub fn term_resolve_in(
    library: &Library,
    vocab: String,
    surface: String,
) -> Result<Option<String>, BridgeError> {
    library.with_connection(|connection| Ok(vocab::resolve(connection, &vocab, &surface)?))
}

/// Everything one vocabulary holds.
pub fn term_list_in(
    library: &Library,
    vocab: String,
) -> Result<Vec<TermView>, BridgeError> {
    library.with_connection(|connection| {
        let found = vocab::terms(connection, &vocab)?;
        Ok(found.iter().map(TermView::from).collect())
    })
}

/// List an archive without unpacking it.
pub fn archive_list_in(
    library: &Library,
    path: String,
) -> Result<Vec<ArchiveMemberView>, BridgeError> {
    let resolved = library.resolve(&path)?;
    let listing =
        archive::list(&resolved).map_err(|error| BridgeError::from_archive(error, &path))?;

    Ok(listing.members.iter().map(ArchiveMemberView::from).collect())
}

/// One entry inside an archive, as a plugin reads it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ArchiveMemberView {
    pub path: String,
    pub size: u64,
    pub compressed_size: u64,
    pub is_dir: bool,
    /// The stored name escapes the archive root. Nothing is extracted here, so
    /// it cannot overwrite anything today; it is reported because the name
    /// still reaches a screen.
    pub escapes_root: bool,
}

impl From<&archive::Member> for ArchiveMemberView {
    fn from(member: &archive::Member) -> Self {
        Self {
            path: member.path.clone(),
            size: member.size,
            compressed_size: member.compressed_size,
            is_dir: member.is_dir,
            escapes_root: member.escapes_root,
        }
    }
}

/// Hash a file or folder with the same function the core uses.
///
/// A plugin finding duplicates has to agree with the scanner about what a
/// duplicate is, which it cannot do by hashing things its own way.
pub fn hash_of_in(
    library: &Library,
        path: String,
) -> Result<String, BridgeError> {
    let resolved = library.resolve(&path)?;
    hash::of_path(&resolved).map_err(|error| BridgeError::from_io(error, &path))
}

/// What changed on an object, and when.
pub fn history_of_in(
    library: &Library,
    id: i64,
) -> Result<Vec<HistoryView>, BridgeError> {
    library.with_connection(|connection| {
        let records = history::of_object(connection, id)?;
        Ok(records.iter().map(HistoryView::from).collect())
    })
}

/// Submit a document.
///
/// The only command that changes anything. What fits into empty fields is
/// written; anything that would overwrite an existing value becomes a change
/// set for a person to review. That split is `changes::build::import`'s, not
/// this function's — a plugin gets the same treatment as an AI import or
/// another machine's export, because they are the same kind of thing.
///
/// The whole import runs in one transaction. Half an import is a library
/// describing something that never existed.
pub fn import_propose_in(
    library: &Library,
    label: String,
    document: String,
) -> Result<ProposalView, BridgeError> {
    let parsed: crate::contract::Document = serde_json::from_str(&document)
        .map_err(|error| BridgeError::BadRequest(format!("cannot read document: {error}")))?;

    library.with_connection_mut(|connection| {
        crate::store::schema::in_transaction(connection, |transaction| {
            let mut store = values::Values::new();
            let outcome = changes::build::import(transaction, &mut store, &parsed, &label)
                .map_err(|error| BridgeError::BadRequest(error.to_string()))?;

            Ok(ProposalView {
                written: outcome.written,
                unchanged: outcome.unchanged,
                objects_created: outcome.objects_created,
                terms: outcome.terms,
                edges: outcome.edges,
                pending: outcome.pending,
            })
        })
    })
}

/// What an import did.
///
/// `pending` is the change set holding whatever could not be written without
/// overwriting a decision. `None` means nothing needs a person.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct ProposalView {
    pub written: usize,
    pub unchanged: usize,
    pub objects_created: usize,
    pub terms: usize,
    pub edges: usize,
    pub pending: Option<i64>,
}

// --- the Tauri surface -------------------------------------------------
//
// Each of these unwraps `State` and calls the function above it. The split
// exists so the work is reachable from a test: a `State` cannot be built
// outside a running Tauri app, and a command that can only run inside one is
// a command whose failure paths are never exercised until a user finds them.

/// One object resolved into what to show.
#[tauri::command]
pub fn object_flat(
    library: State<'_, Library>,
    registry: State<'_, Registry>,
    id: String,
) -> Result<FlatObjectView, BridgeError> {
    object_flat_in(&library, Some(&registry), parse_id(&id)?)
}

/// A page of object ids.
#[tauri::command]
pub fn object_ids(
    library: State<'_, Library>,
    after: Option<String>,
    limit: u32,
) -> Result<ObjectIdsView, BridgeError> {
    let after = after.map(|id| parse_id(&id)).transpose()?;
    object_ids_in(&library, after, limit)
}

/// The manifests of every loaded plugin.
#[tauri::command]
pub fn plugin_list(registry: State<'_, Registry>) -> Vec<Manifest> {
    plugin_list_in(Some(&registry))
}

/// This library's mount order.
#[tauri::command]
pub fn mount_order(library: State<'_, Library>) -> Result<Vec<MountView>, BridgeError> {
    mount_order_in(&library)
}


/// Bring the library up to date with the disk.
#[tauri::command]
pub fn library_scan(
    library: State<'_, Library>,
    registry: State<'_, Registry>,
) -> Result<ScanView, BridgeError> {
    library_scan_in(&library, Some(&registry))
}


/// A name and a path for each of a page of objects.
#[tauri::command]
pub fn object_summaries(
    library: State<'_, Library>,
    ids: Vec<String>,
) -> Result<Vec<SummaryView>, BridgeError> {
    let parsed = ids.iter().map(|id| parse_id(id)).collect::<Result<Vec<_>, _>>()?;
    object_summaries_in(&library, parsed)
}


/// A URL a viewer can render, for one file.
///
/// The plugin never sees the bytes. It is handed a URL the webview knows how
/// to fetch, and the data goes straight from disk into a `<canvas>`, an
/// `<img>` or a PDF renderer without passing through plugin JavaScript.
///
/// That distinction is the whole reason this is not `file.bytes`. A command
/// returning contents would let any installed plugin read every file in the
/// library, and a plugin that can read and can also call `import.propose` can
/// encode what it read into what it proposes. Reading plus any outbound
/// channel is an exfiltration channel.
///
/// # One file at a time
///
/// The asset protocol starts with an empty scope, and this grants exactly the
/// file asked for. A plugin cannot guess a URL for a file it never asked
/// about, because an ungranted path is refused by the protocol itself.
///
/// The grants accumulate for the life of the process: Tauri's scope has no
/// revoke, so a file viewed once stays reachable until the application
/// restarts. That is a real limit rather than a detail, and it is written
/// here instead of being left for somebody to discover.
#[tauri::command]
pub fn file_url(
    app: tauri::AppHandle,
    library: State<'_, Library>,
    path: String,
) -> Result<String, BridgeError> {
    use tauri::Manager;

    // The same confinement every other path goes through. Without it the
    // asset protocol would happily serve whatever the plugin named.
    let resolved = library.resolve(&path)?;

    app.asset_protocol_scope()
        .allow_file(&resolved)
        .map_err(|error| BridgeError::Unreadable(error.to_string()))?;

    log::debug!("granted asset access to {}", resolved.display());
    Ok(asset_url(&resolved))
}

/// The URL the webview fetches an allowed file from.
///
/// Split out so the two halves can be told apart: granting needs a running
/// app, spelling a URL does not. The spelling is what a viewer receives, so
/// it is the half worth a test.
pub fn asset_url(resolved: &std::path::Path) -> String {
    // Percent-encoded whole, separators included. A library path holds
    // spaces, `#` and `?` -- `.AASHAREE/CLOTHS/Cross Maid #2.pdf` is an
    // ordinary name -- and a `#` left raw truncates the URL at the fragment,
    // so the viewer would ask for a file whose name stops early.
    let encoded: String = resolved
        .display()
        .to_string()
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                (byte as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect();

    format!("asset://localhost/{encoded}")
}


/// Several objects at once, for a column rendering across a page.
#[tauri::command]
pub fn object_list(
    library: State<'_, Library>,
    ids: Vec<String>,
) -> Result<Vec<ObjectView>, BridgeError> {
    let parsed = ids.iter().map(|id| parse_id(id)).collect::<Result<Vec<_>, _>>()?;
    object_list_in(&library, parsed)
}

/// What an object requires, supports or contains.
#[tauri::command]
pub fn object_edges(
    library: State<'_, Library>,
    id: String,
) -> Result<Vec<EdgeView>, BridgeError> {
    object_edges_in(&library, parse_id(&id)?)
}

/// Map a spelling to a term.
#[tauri::command]
pub fn term_resolve(
    library: State<'_, Library>,
    vocab: String,
    surface: String,
) -> Result<Option<String>, BridgeError> {
    term_resolve_in(&library, vocab, surface)
}

/// Everything one vocabulary holds.
#[tauri::command]
pub fn term_list(
    library: State<'_, Library>,
    vocab: String,
) -> Result<Vec<TermView>, BridgeError> {
    term_list_in(&library, vocab)
}

/// List an archive without unpacking it.
#[tauri::command]
pub fn archive_list(
    library: State<'_, Library>,
    path: String,
) -> Result<Vec<ArchiveMemberView>, BridgeError> {
    archive_list_in(&library, path)
}

/// Hash a file or folder with the same function the core uses.
#[tauri::command]
pub fn hash_of(library: State<'_, Library>, path: String) -> Result<String, BridgeError> {
    hash_of_in(&library, path)
}

/// What changed on an object, and when.
#[tauri::command]
pub fn history_of(
    library: State<'_, Library>,
    id: String,
) -> Result<Vec<HistoryView>, BridgeError> {
    history_of_in(&library, parse_id(&id)?)
}

/// Submit a document.
#[tauri::command]
pub fn import_propose(
    library: State<'_, Library>,
    label: String,
    document: String,
) -> Result<ProposalView, BridgeError> {
    import_propose_in(&library, label, document)
}

/// Read an object id sent as a string.
///
/// Ids are 62 bits and JavaScript numbers hold 53, so they cross as text in
/// both directions. Parsing here rather than taking an `i64` parameter is the
/// point: an `i64` would arrive already rounded, and the lookup would fail
/// with "no such object" for a reason nothing in the message explains.
fn parse_id(id: &str) -> Result<i64, BridgeError> {
    id.parse()
        .map_err(|_| BridgeError::BadRequest(format!("{id:?} is not an object id")))
}

/// Whether an object row exists at all.
fn object_exists(
    connection: &rusqlite::Connection,
    id: i64,
) -> Result<bool, BridgeError> {
    let count: i64 = connection
        .query_row("SELECT count(*) FROM objects WHERE id = ?1", [id], |row| row.get(0))?;
    Ok(count > 0)
}
