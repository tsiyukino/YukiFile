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

/** One stored value on an object. */
export interface StoredValue {
  readonly path: string;
  readonly value: string;
}

/** One object, as a plugin reads it. */
export interface ObjectRecord {
  readonly id: number;
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
  readonly id: number;
  readonly shared: Readonly<Record<string, readonly Source[]>>;
  readonly regions: readonly Region[];
  readonly skipped: readonly Skipped[];
}

/** A page of object ids, and how many there are in total. */
export interface ObjectIds {
  readonly ids: readonly number[];
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
  objectGet(id: number): Promise<ObjectRecord>;
  objectList(ids: readonly number[]): Promise<ObjectRecord[]>;
  objectFlat(id: number): Promise<FlatObject>;
  objectIds(after: number | null, limit: number): Promise<ObjectIds>;
  pluginList(): Promise<Manifest[]>;
  mountOrder(): Promise<MountRow[]>;
  objectEdges(id: number): Promise<unknown[]>;
  termResolve(vocab: string, surface: string): Promise<string | null>;
  termList(vocab: string): Promise<Term[]>;
  archiveList(path: string): Promise<ArchiveMember[]>;
  hashOf(path: string): Promise<string>;
  historyOf(id: number): Promise<HistoryEntry[]>;
  importPropose(label: string, document: string): Promise<Proposal>;
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

/** Build the API a plugin is handed. */
export function apiFor(invoke: Invoke): Api {
  const call = <T>(listed: string, args: Record<string, unknown>): Promise<T> =>
    invoke(handlerName(listed), args) as Promise<T>;

  return {
    objectGet: (id) => call("object.get", { id }),
    objectList: (ids) => call("object.list", { ids }),
    objectFlat: (id) => call("object.flat", { id }),
    objectIds: (after, limit) => call("object.ids", { after, limit }),
    pluginList: () => call("plugin.list", {}),
    mountOrder: () => call("mount.order", {}),
    objectEdges: (id) => call("object.edges", { id }),
    termResolve: (vocab, surface) => call("term.resolve", { vocab, surface }),
    termList: (vocab) => call("term.list", { vocab }),
    archiveList: (path) => call("archive.list", { path }),
    hashOf: (path) => call("hash.of", { path }),
    historyOf: (id) => call("history.of", { id }),
    importPropose: (label, document) => call("import.propose", { label, document }),
  };
}
