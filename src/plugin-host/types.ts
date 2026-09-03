/**
 * The shape of what a plugin declares.
 *
 * These types describe the JSON the core produces, and nothing more. The
 * checking lives in Rust — `plugin::manifest` refuses a bad id, a reserved
 * property and a contribution scoped to a property the plugin has no
 * relationship with, and `plugin::registry` refuses duplicates, unsatisfied
 * requirements and cycles. A manifest that reaches this side has already been
 * through all of it.
 *
 * Repeating those checks here would put one rule in two languages, and two
 * copies of a rule drift. The day they disagree, the disagreement is silent:
 * one side loads a plugin the other rejected, and the symptom shows up
 * somewhere else entirely. So the host validates nothing and describes
 * everything.
 */

/** A plugin's declaration, as the core hands it over. */
export interface Manifest {
  /** `yukifile.vrc`, `com.example.epub`. Unique among loaded plugins. */
  readonly id: string;

  /**
   * The directory it was read from, relative to `plugins/`.
   *
   * Filled in by discovery, not declared. A manifest's `./panel` is relative
   * to this, not to whatever file is doing the importing — resolving it
   * against the importer is a 404 for a file that exists.
   */
  readonly directory?: string;
  readonly contributes?: Contributes;
  readonly requires?: Requires;
}

/** What a plugin adds. */
export interface Contributes {
  /** Semantic properties this plugin defines: `vrchat`, `booth`. */
  readonly properties?: readonly string[];

  /**
   * Fields that contribute to a shared concept rather than staying this
   * plugin's own. Empty means isolation.
   */
  readonly shared?: readonly string[];

  /** Controlled name lists: `avatar`, `author`. */
  readonly vocabularies?: readonly string[];

  /** Extension to the factual properties it brings, without the dot. */
  readonly file_types?: Readonly<Record<string, readonly string[]>>;

  /** Property to the panel module rendered in its region. */
  readonly panels?: Readonly<Record<string, string>>;

  /** Property to the actions offered on objects carrying it. */
  readonly actions?: Readonly<Record<string, readonly string[]>>;

  /** Property to the full-screen viewer module. */
  readonly viewers?: Readonly<Record<string, string>>;

  /** Property to the list columns it offers. */
  readonly columns?: Readonly<Record<string, readonly string[]>>;
}

/**
 * What a plugin needs from whoever provides it.
 *
 * Properties only. There is deliberately no field for a plugin id, matching
 * the Rust side: naming one would tie a plugin to an implementation rather
 * than to the contract it depends on.
 */
export interface Requires {
  readonly properties?: readonly string[];
}

/**
 * A property instance as it appears on an object: `booth`, `booth#1`.
 *
 * Contributions are keyed by the bare name; an object carries instances. The
 * two are matched by {@link bareName}.
 */
export type PropertyInstance = string;

/**
 * The property name an instance belongs to.
 *
 * `booth#1` and `booth#2` are two Booth pages on one object, and a plugin
 * contributing to `booth` speaks for both. Splitting on the instance counter
 * is what lets one manifest entry cover an object that carries the same
 * property twice.
 */
export function bareName(instance: PropertyInstance): string {
  const hash = instance.indexOf("#");
  return hash === -1 ? instance : instance.slice(0, hash);
}
