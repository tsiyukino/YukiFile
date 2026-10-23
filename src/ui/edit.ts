/**
 * What an object page may change, and how to say it.
 *
 * Pure, and apart from the components that draw the controls. Which
 * properties a person may take off an object, what a field is called in
 * storage, whether a typed name is one — each is a rule worth checking
 * without a DOM, and each is wrong in a quiet way when it drifts.
 */

import type { Edge, FlatObject, Region, Summary, Term } from "../plugin-host/commands.js";
import { choosable } from "../plugin-host/picker.js";
import { bareName, type Manifest } from "../plugin-host/types.js";

/**
 * The stored path of a field in a region: `paper#1/doi`.
 *
 * Spelled here and nowhere else in the UI, so the one place that knows how a
 * region's field is addressed is the one place that would change.
 */
export function fieldPath(region: Pick<Region, "property" | "instance">, name: string): string {
  return `${region.property}#${region.instance}/${name}`;
}

/**
 * Whether a typed name can be a field.
 *
 * The store's own rule, read from `store::path`: no separator, no instance
 * marker, no whitespace, not empty. Checked before the round trip so the
 * message sits beside the box rather than arriving as a refusal.
 */
export function isFieldName(name: string): boolean {
  return name.length > 0 && !/[\s/#]/.test(name);
}

/**
 * The semantic properties an object carries, as a person could have chosen.
 *
 * Only these can be taken off. A factual one — `pdf` on a `.pdf` — is
 * attached by what the file is, and detaching it would do nothing the next
 * read does not undo.
 */
export function removableProperties(object: FlatObject, plugins: readonly Manifest[]): string[] {
  const semantic = new Set(choosable(plugins).map((choice) => choice.property));
  const carried = new Set(object.carries.map(bareName));
  return [...carried].filter((property) => semantic.has(property)).sort();
}

/** The semantic properties an object does not carry yet. */
export function addableProperties(object: FlatObject, plugins: readonly Manifest[]): string[] {
  const carried = new Set(object.carries.map(bareName));
  return choosable(plugins)
    .map((choice) => choice.property)
    .filter((property) => !carried.has(property));
}

/** Every vocabulary the installed plugins declare, each once, sorted. */
export function vocabulariesOf(plugins: readonly Manifest[]): string[] {
  const found = new Set<string>();
  for (const plugin of plugins) {
    for (const vocab of plugin.contributes?.vocabularies ?? []) found.add(vocab);
  }
  return [...found].sort();
}

/**
 * Edge kinds the architecture names, offered as suggestions.
 *
 * Suggestions, not a list: `kind` is free text in the schema so a plugin can
 * add `cites` without a change here, and the box accepts anything.
 */
export const EDGE_KINDS: readonly string[] = [
  "contains",
  "supports",
  "owned",
  "requires",
  "supersedes",
  "patches",
];

/**
 * What an edge points at, in words.
 *
 * An object by its name when one is known, a term by its label when one is
 * known, and the raw id otherwise — a target nobody can name is still a
 * target, and hiding it would hide the edge.
 */
export function targetWording(
  edge: Edge,
  names: readonly Summary[],
  terms: readonly Term[],
): string {
  if (edge.target === "object") {
    const named = names.find((summary) => summary.id === edge.id)?.name;
    return named ?? `object ${edge.id}`;
  }
  const labelled = terms.find((term) => term.vocab === edge.vocab && term.id === edge.term)?.label;
  return `${edge.vocab}: ${labelled ?? edge.term}`;
}

/** The objects a list of edges points at, each once. */
export function objectTargets(edges: readonly Edge[]): string[] {
  const ids = new Set<string>();
  for (const edge of edges) if (edge.target === "object") ids.add(edge.id);
  return [...ids];
}
