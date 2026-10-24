/**
 * How a plugin asks the core to do something.
 *
 * The Rust side holds one array of allowed commands and one bridge function
 * per row. This is the calling end: a plugin receives an {@link Api} and calls
 * methods on it, rather than assembling command names itself.
 *
 * # Invocation is injected
 *
 * {@link apiFor} takes an {@link Invoke} rather than importing Tauri. Same
 * reason the loader takes a resolver: a panel that imports `@tauri-apps/api`
 * can only be tested inside Tauri, and a plugin whose failure paths are never
 * exercised fails in front of the user instead.
 *
 * # Names are derived, not written down again
 *
 * `archive.list` becomes `archiveList` by rule. Rust derives `archive_list`
 * from the same string by its own rule. Neither side holds a table mapping one
 * spelling to another, so there is no third place to keep in step — a command
 * renamed on the list is renamed everywhere or fails to resolve, rather than
 * quietly calling something that no longer exists.
 */

import type { Manifest } from "./types.js";

/** How a command name and its arguments reach the core. */
export type Invoke = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/** One entry inside an archive. */
export interface ArchiveMember {
  readonly path: string;
  readonly size: number;
  readonly compressed_size: number;
  readonly is_dir: boolean;
  /** The stored name escapes the archive root. Nothing is extracted, so this
   * cannot overwrite anything; it is reported because the name reaches a
   * screen. */
  readonly escapes_root: boolean;
}

/** One asset inside a Unity package. */
export interface UnityAsset {
  readonly guid: string;
  /** The path inside the Unity project, with `/` separators. */
  readonly path: string;
  /** Absent for a folder asset. */
  readonly size: number | null;
  readonly has_preview: boolean;
}

/** One stored value on an object. */
export interface StoredValue {
  readonly path: string;
  readonly value: string;
}

/**
 * One object, as a plugin reads it.
 *
 * The id is a string. Object ids are 62 bits — time in the high bits,
 * randomness in the low — and a JavaScript number holds 53, so
 * `3750587936530965241` would arrive as `3750587936530965000` and every
 * lookup with it would fail. Keeping them as text is what makes them
 * survive the crossing.
 */
export interface ObjectRecord {
  readonly id: ObjectId;
  readonly values: readonly StoredValue[];
}

/** One source for a shared field, with where it came from. */
export interface Source {
  readonly value: string;
  /** `null` for a bare field entered directly, else the property instance. */
  readonly from: string | null;
}

/** One plugin's region: its property instance and the fields it owns. */
export interface Region {
  readonly property: string;
  readonly instance: number;
  readonly fields: Readonly<Record<string, string>>;
}

/** A value resolution could not place, worth surfacing. */
export interface Skipped {
  readonly path: string;
  readonly reason: string;
}

/**
 * One object resolved into what to show.
 *
 * Shared and private fields arrive apart, because the page renders them
 * differently: a shared field is one row with its sources listed, a private
 * field belongs inside its plugin's region.
 */
export interface FlatObject {
  readonly id: ObjectId;
  readonly shared: Readonly<Record<string, readonly Source[]>>;
  readonly regions: readonly Region[];
  readonly skipped: readonly Skipped[];
  /**
   * Every property instance the object carries, filled in or not.
   *
   * Panel visibility keys off this rather than off `regions`: a `.zip` is an
   * archive before any plugin writes a thing about it, so keying on regions
   * would show a plugin's panel only after that plugin had already written
   * something.
   */
  readonly carries: readonly string[];
  /** Field name to the source it is pinned to: `cover` → `gumroad#1`. */
  readonly pins?: Readonly<Record<string, string>>;
  /** Where it sits on disk. Empty for a grouping. */
  readonly locations: readonly Location[];
}

/** One place an object sits. */
export interface Location {
  /** Relative to the library root, with `/` separators on every platform. */
  readonly path: string;
  readonly kind: "file" | "folder";
  /** Size in bytes. Absent for a folder. */
  readonly size: number | null;
}

/**
 * An object id.
 *
 * A string, not a number: see {@link ObjectRecord}.
 */
export type ObjectId = string;

/** A page of object ids, and how many there are in total. */
export interface ObjectIds {
  readonly ids: readonly ObjectId[];
  /** Every object in the library, so a caller knows whether it has them all. */
  readonly total: number;
}

/**
 * One mounted property instance.
 *
 * No `shared` list: which fields are shared comes from the manifests, which
 * `pluginList` already returned. Sending it twice would give the frontend two
 * answers to keep in step.
 */
export interface MountRow {
  readonly namespace: string;
  readonly instance: number;
}

/**
 * One row in a list.
 *
 * A name and a path, and nothing else. Resolving each object fully would read
 * every value and every mount for a row showing one line of text.
 */
export interface Summary {
  readonly id: ObjectId;
  /** The title, the filename, or nothing for an unnamed grouping. */
  readonly name: string | null;
  /** Its first location. Absent for a grouping. */
  readonly path: string | null;
  readonly kind: "file" | "folder" | null;
}

/** One entry on disk. */
export interface Entry {
  /** Relative to the walk root, with `/` separators on every platform. */
  readonly path: string;
  readonly kind: "file" | "folder";
  /** Size in bytes. Absent for a folder. */
  readonly size: number | null;
  /** Seconds since the Unix epoch, when the filesystem reports one. */
  readonly mtime: number | null;
}

/**
 * One path the library holds an object at.
 *
 * What a disk browser lines a listing up against: the path says a row is
 * already recorded, and the object is what to open instead of offering to add
 * it a second time.
 */
export interface KnownPath {
  /** Relative to the library root, with `/` separators. */
  readonly path: string;
  readonly object: ObjectId;
}

/**
 * One set awaiting review, with enough to list it.
 *
 * Set and entry ids are row ids, small enough to cross as numbers. Object ids
 * are not, which is why {@link ChangeEntry.object} is a string like every other
 * object id.
 */
export interface ChangeSetSummary {
  readonly id: number;
  /** Where it came from, for the person reading the list. */
  readonly label: string;
  /** Milliseconds since the Unix epoch. */
  readonly created: number;
  readonly additions: number;
  readonly modifications: number;
  /** How many entries are currently accepted, of either kind. */
  readonly accepted: number;
}

/** One proposed write. */
export interface ChangeEntry {
  readonly id: number;
  readonly object: ObjectId;
  /** The stored path: `title`, `booth#1/price`. */
  readonly field: string;
  /** What the field held when the set was built. `null` for an addition. */
  readonly old: string | null;
  /** What is proposed. `null` proposes clearing the field. */
  readonly new: string | null;
  readonly reason: string | null;
  readonly accepted: boolean;
  readonly kind: "addition" | "modification";
}

/**
 * Where a cover's bytes come from.
 *
 * A file in the library, an image inside a zip, or the preview of one asset
 * in a package (on disk, or inside a zip via `member`). The core reads the
 * bytes; a plugin never does.
 */
export type CoverSource =
  | { readonly from: "file"; readonly path: string }
  | { readonly from: "member"; readonly path: string; readonly member: string }
  | { readonly from: "preview"; readonly path: string; readonly member?: string; readonly guid: string };

/** One setting the library holds. */
export interface SettingRow {
  readonly key: string;
  readonly value: string;
}

/** One installed plugin, and whether this library runs it. */
export interface PluginRow {
  readonly id: string;
  readonly directory: string;
  /** Named in the library's list, or the list is absent and everything runs. */
  readonly enabled: boolean;
  /** Loaded in this session. Differs from `enabled` until the next open. */
  readonly running: boolean;
}

/** The library, as a settings page describes it. */
export interface LibraryInfo {
  readonly root: string;
  readonly plugins: readonly PluginRow[];
  /** Whether the library has chosen; `false` means everything installed runs. */
  readonly chosen: boolean;
  readonly skipped: readonly (readonly [string, string])[];
}

/** One possible move a rescan could not prove. */
export interface Candidate {
  readonly object: ObjectId;
  readonly from: string;
  readonly to: string;
  readonly kind: "file" | "folder";
}

/** What a rescan found and did. */
export interface Rescanned {
  readonly moved: number;
  readonly touched: number;
  readonly removed: number;
  /** Paths on disk nothing claims. A plugin's scan decides about them. */
  readonly added: readonly string[];
  readonly candidates: readonly Candidate[];
  readonly unreadable: readonly string[];
}

/** What applying a set did. */
export interface Applied {
  readonly changed: number;
  readonly already_matched: number;
  readonly declined: number;
}

/**
 * What an edge points at.
 *
 * Tagged the way the bridge sends it, and the same shape `objectEdgeAdd`
 * takes back, so a panel that read an edge can hand it over unchanged.
 */
export type EdgeTarget =
  | { readonly target: "object"; readonly id: ObjectId }
  | { readonly target: "term"; readonly vocab: string; readonly term: string };

/** One edge leaving an object: `supports → avatar:manuka`. */
export type Edge = { readonly kind: string } & EdgeTarget;

/** What setting a value did. */
export type Written = "added" | "replaced" | "cleared" | "unchanged";

/** One object pointing at a term, and how. */
export interface Pointer {
  readonly object: ObjectId;
  /** `supports`, `owned`, whatever the edge said. */
  readonly kind: string;
}

/** One vocabulary term. */
export interface Term {
  readonly vocab: string;
  readonly id: string;
  readonly label: string;
}

/** One history entry. */
export interface HistoryEntry {
  readonly field: string;
  readonly old: string | null;
  readonly new: string | null;
  /** Milliseconds since the Unix epoch. */
  readonly at: number;
}

/** What an import did. */
export interface Proposal {
  readonly written: number;
  readonly unchanged: number;
  readonly objects_created: number;
  readonly terms: number;
  readonly edges: number;
  /** The change set holding what needs a person, or null if nothing does. */
  readonly pending: number | null;
}

/**
 * Why a command failed.
 *
 * Mirrors `bridge::error::BridgeError`, which is serialised with the variant
 * in `kind`. A plugin switching on `kind` gets a decision it can act on —
 * "the file is not an archive" — rather than a message it has to match against.
 */
export interface CommandError {
  readonly kind: string;
  readonly detail?: string;
}

/** Everything a plugin may ask for. */
export interface Api {
  objectGet(id: ObjectId): Promise<ObjectRecord>;
  objectList(ids: readonly ObjectId[]): Promise<ObjectRecord[]>;
  objectFlat(id: ObjectId): Promise<FlatObject>;
  /**
   * A page of object ids, from the top of the tree or inside one object.
   *
   * `within` names an object and returns what it contains; without it the
   * page is the top level, meaning objects nothing contains. A library of
   * 1518 files is a handful of top folders and everything under them.
   */
  objectIds(
    after: ObjectId | null,
    limit: number,
    within?: ObjectId | null,
  ): Promise<ObjectIds>;
  objectSummaries(ids: readonly ObjectId[]): Promise<Summary[]>;
  pluginList(): Promise<Manifest[]>;
  mountOrder(): Promise<MountRow[]>;
  objectEdges(id: ObjectId): Promise<Edge[]>;
  termResolve(vocab: string, surface: string): Promise<string | null>;
  termList(vocab: string): Promise<Term[]>;
  /**
   * One of the library's settings, or `null`.
   *
   * A plugin reads its own keys: `vrchat.grouping_depth`. The core keeps the
   * string and reads none of them.
   */
  settingGet(key: string): Promise<string | null>;
  /** Every vocabulary the library holds a term in. From the terms, not the manifests. */
  termVocabularies(): Promise<string[]>;
  /**
   * Every object pointing at a term, with the kind of each edge.
   *
   * The reverse lookup: what fits Manuka, answered from what is owned. An
   * object with two kinds of edge to the term appears twice.
   */
  termObjects(vocab: string, term: string): Promise<Pointer[]>;
  archiveList(path: string): Promise<ArchiveMember[]>;
  /**
   * What a Unity package holds, without unpacking it.
   *
   * `member` names an entry of the zip at `path`, as `archiveList` spelled
   * it; without it `path` is the package. A plugin never holds the bytes, so
   * reading inside one is the core's to do.
   */
  unitypackageList(path: string, member?: string | null): Promise<UnityAsset[]>;
  /**
   * A URL a viewer can render, for one file.
   *
   * Not the bytes. The data goes from disk into a `<canvas>` or `<img>`
   * without passing through plugin JavaScript, so a plugin that can render a
   * file still cannot read it — which matters because a plugin that can read
   * and can also call `importPropose` can encode what it read into what it
   * proposes.
   */
  /**
   * What is on disk, as facts.
   *
   * Where an entry is, whether it is a file or a folder, how big. Nothing
   * about what any of it means: deciding what counts as an object is domain
   * knowledge, and a plugin submits its conclusion through
   * {@link Api.importPropose} like any other source.
   */
  /**
   * What is on disk, as facts.
   *
   * Paths come back relative to `under`: walking `Clothing` reports
   * `outfit.zip`, not `Clothing/outfit.zip`.
   *
   * `depth` stops the walk rather than filtering its result — one directory in
   * the seed library holds 281 entries, and rendering ten should not read the
   * other 271. Omitting it reads the whole tree, which is what a scanning
   * plugin needs and a browser does not.
   */
  fsWalk(under: string | null, depth?: number | null): Promise<Entry[]>;
  /**
   * Every path the library holds an object at, sorted.
   *
   * The whole library rather than one directory: a browser steps through
   * directories faster than it changes the library, so one read held for the
   * session costs less than a query per step. Refetch when the library
   * changes, not when the directory does.
   */
  pathList(): Promise<KnownPath[]>;
  fileUrl(path: string): Promise<string>;
  hashOf(path: string): Promise<string>;
  historyOf(id: ObjectId): Promise<HistoryEntry[]>;
  importPropose(label: string, document: string): Promise<Proposal>;
  /**
   * Every set awaiting review, oldest first.
   *
   * Readable by a plugin so a panel can say that a proposal is waiting on
   * what it draws. Deciding one is the application's alone.
   */
  changesPending(): Promise<ChangeSetSummary[]>;
  /** What one set proposes, in a stable order. */
  changesEntries(set: number): Promise<ChangeEntry[]>;
}

/**
 * The Tauri handler name for a listed command.
 *
 * `archive.list` is invoked as `archive_list`, matching
 * `bridge::handler_name`. Both are a `replace` on the same string rather than
 * a lookup, so the two cannot disagree about a name neither of them stores.
 */
export function handlerName(listed: string): string {
  return listed.replaceAll(".", "_");
}

/**
 * The method name for a listed command.
 *
 * `archive.list` is `archiveList`. The rule is the same shape as
 * {@link handlerName} — derived from the command name, not written down beside
 * it.
 */
export function methodName(listed: string): string {
  const [head, ...rest] = listed.split(".");
  return (
    (head ?? "") +
    rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("")
  );
}

/** One place an object sits, as the person adding it names it. */
export interface PathAt {
  readonly path: string;
  readonly kind: "file" | "folder";
}

/**
 * What a new object is made of.
 *
 * `properties` is a list because an object is what its properties say it is,
 * plural: a PDF can be a paper and a VRChat asset at once. `paths` may be empty,
 * which makes a grouping.
 *
 * `values` is nested by property so the core writes `paper#1/doi` itself. A flat
 * map would put that spelling here, and a form returning a bare `doi` would land
 * in the shared field space — which is what property namespaces prevent.
 * `shared` is for fields belonging to no property, like `title`.
 */
export interface NewObject {
  readonly paths?: readonly PathAt[];
  readonly properties?: readonly string[];
  readonly values?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly shared?: Readonly<Record<string, string>>;
}

/**
 * What only the application may ask for.
 *
 * The writing a person does. A plugin proposing objects goes through
 * `importPropose`, where what it proposes is reviewed; handing it a direct write
 * would route around the review that exists for that reason. `plugin::commands`
 * draws the same line with a second list rather than more rows in the first.
 */
export interface AppApi {
  /** Make an object. Returns its id. */
  objectCreate(object: NewObject): Promise<ObjectId>;
  /** Remove an object and everything hung on it. Files on disk are untouched. */
  objectForget(id: ObjectId): Promise<void>;
  /**
   * Write one field on an existing object, whatever it held.
   *
   * The person is the review, so this overwrites where an import would have
   * proposed, and records the change in history as theirs. An empty value
   * clears. A bare path (`title`) outranks every source; a namespaced one
   * (`paper#1/doi`) lands in that property's region.
   */
  objectValueSet(id: ObjectId, field: string, value: string): Promise<Written>;
  /** Say an object is something, after it was made. */
  objectPropertyAdd(id: ObjectId, property: string): Promise<void>;
  /** Unsay it. Values under the property stay, and read back if it returns. */
  objectPropertyRemove(id: ObjectId, property: string): Promise<void>;
  /** Point an object at a term or another object. The target has to exist. */
  objectEdgeAdd(id: ObjectId, kind: string, target: EdgeTarget): Promise<void>;
  /** Stop pointing. Removing an edge that is not there is not an error. */
  objectEdgeRemove(id: ObjectId, kind: string, target: EdgeTarget): Promise<void>;
  /** Give an object another place it sits. The path has to be there and free. */
  objectPathAdd(id: ObjectId, at: PathAt): Promise<void>;
  /** Take a place away. Only from the object that holds it. */
  objectPathRemove(id: ObjectId, path: string): Promise<void>;
  /** Every setting the library holds. */
  settingAll(): Promise<SettingRow[]>;
  /** Set a setting. Empty clears. */
  settingSet(key: string, value: string): Promise<void>;
  /** What is installed, what this library runs, and where it is. */
  libraryInfo(): Promise<LibraryInfo>;
  /** Which plugins the library runs; `null` means everything installed. Takes effect at the next open. */
  pluginsEnable(ids: readonly string[] | null): Promise<void>;
  /** Put the mounts in a new order. Every mount has to be named. */
  mountOrderSet(order: readonly { readonly namespace: string; readonly instance: number }[]): Promise<void>;
  /**
   * Store an image, scaled to fit 512 pixels, and make it the object's cover.
   *
   * Written to the bare `cover` field, as the person's own choice. Returns
   * the stored path, which `fileUrl` can serve.
   */
  coverSet(id: ObjectId, source: CoverSource): Promise<string>;
  /**
   * Bring the library's locations back in line with the disk.
   *
   * Moves proven by hash, touches and removals are applied. Paths nothing
   * claims are reported for a plugin's scan to decide about; a removal and an
   * addition sharing a basename are a candidate for the person to confirm.
   */
  libraryReconcile(): Promise<Rescanned>;
  /**
   * Accept or decline one proposed entry.
   *
   * The review itself. A plugin that could accept its own proposal would make
   * the review a formality, which is what change sets exist to prevent.
   */
  changesAccept(change: number, accepted: boolean): Promise<void>;
  /** Accept every addition and leave every modification as it is. */
  changesAcceptAdditions(set: number): Promise<number>;
  /** Accept or decline everything in a set. */
  changesAcceptAll(set: number, accepted: boolean): Promise<number>;
  /**
   * Write what was accepted, all of it or none.
   *
   * Refused with `kind: "stale"` when a field moved since the set was built;
   * the detail names the object and field so a screen can point at it.
   */
  changesApply(set: number): Promise<Applied>;
}

/** Build the surface the application's own UI uses. */
export function appApiFor(invoke: Invoke): AppApi {
  return {
    objectCreate: (object) =>
      invoke(handlerName("object.create"), { object }) as Promise<ObjectId>,
    objectForget: (id) =>
      invoke(handlerName("object.forget"), { id }) as Promise<void>,
    objectValueSet: (id, field, value) =>
      invoke(handlerName("object.value.set"), { id, field, value }) as Promise<Written>,
    objectPropertyAdd: (id, property) =>
      invoke(handlerName("object.property.add"), { id, property }) as Promise<void>,
    objectPropertyRemove: (id, property) =>
      invoke(handlerName("object.property.remove"), { id, property }) as Promise<void>,
    objectEdgeAdd: (id, kind, target) =>
      invoke(handlerName("object.edge.add"), { id, kind, target }) as Promise<void>,
    objectEdgeRemove: (id, kind, target) =>
      invoke(handlerName("object.edge.remove"), { id, kind, target }) as Promise<void>,
    objectPathAdd: (id, at) =>
      invoke(handlerName("object.path.add"), { id, at }) as Promise<void>,
    objectPathRemove: (id, path) =>
      invoke(handlerName("object.path.remove"), { id, path }) as Promise<void>,
    settingAll: () => invoke(handlerName("setting.all"), {}) as Promise<SettingRow[]>,
    settingSet: (key, value) => invoke(handlerName("setting.set"), { key, value }) as Promise<void>,
    libraryInfo: () => invoke(handlerName("library.info"), {}) as Promise<LibraryInfo>,
    pluginsEnable: (ids) => invoke(handlerName("plugins.enable"), { ids }) as Promise<void>,
    mountOrderSet: (order) => invoke(handlerName("mount.order.set"), { order }) as Promise<void>,
    coverSet: (id, source) =>
      invoke(handlerName("cover.set"), { id, source }) as Promise<string>,
    libraryReconcile: () =>
      invoke(handlerName("library.reconcile"), {}) as Promise<Rescanned>,
    changesAccept: (change, accepted) =>
      invoke(handlerName("changes.accept"), { change, accepted }) as Promise<void>,
    changesAcceptAdditions: (set) =>
      invoke(handlerName("changes.accept.additions"), { set }) as Promise<number>,
    changesAcceptAll: (set, accepted) =>
      invoke(handlerName("changes.accept.all"), { set, accepted }) as Promise<number>,
    changesApply: (set) =>
      invoke(handlerName("changes.apply"), { set }) as Promise<Applied>,
  };
}

/** Build the API a plugin is handed. */
export function apiFor(invoke: Invoke): Api {
  const call = <T>(listed: string, args: Record<string, unknown>): Promise<T> =>
    invoke(handlerName(listed), args) as Promise<T>;

  return {
    objectGet: (id) => call("object.get", { id }),
    objectList: (ids) => call("object.list", { ids }),
    objectFlat: (id) => call("object.flat", { id }),
    objectIds: (after, limit, within = null) =>
      call("object.ids", { after, limit, within }),
    objectSummaries: (ids) => call("object.summaries", { ids }),
    pluginList: () => call("plugin.list", {}),
    mountOrder: () => call("mount.order", {}),
    objectEdges: (id) => call("object.edges", { id }),
    termResolve: (vocab, surface) => call("term.resolve", { vocab, surface }),
    termList: (vocab) => call("term.list", { vocab }),
    settingGet: (key) => call("setting.get", { key }),
    termVocabularies: () => call("term.vocabularies", {}),
    termObjects: (vocab, term) => call("term.objects", { vocab, term }),
    archiveList: (path) => call("archive.list", { path }),
    unitypackageList: (path, member = null) => call("unitypackage.list", { path, member }),
    fsWalk: (under, depth = null) => call("fs.walk", { under, depth }),
    pathList: () => call("path.list", {}),
    fileUrl: (path) => call("file.url", { path }),
    hashOf: (path) => call("hash.of", { path }),
    historyOf: (id) => call("history.of", { id }),
    importPropose: (label, document) => call("import.propose", { label, document }),
    changesPending: () => call("changes.pending", {}),
    changesEntries: (set) => call("changes.entries", { set }),
  };
}
