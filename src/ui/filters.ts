/**
 * What the grid is narrowed to, and how a sidebar click changes it.
 *
 * Pure. The sidebar draws what `object.facets` counted; the chips above the
 * grid draw what is chosen; both change the filter only through these, so a
 * click in one and a remove in the other cannot disagree about what a choice
 * is.
 */

import type { Filter, ObjectId } from "../plugin-host/commands.js";
import type { Manifest } from "../plugin-host/types.js";

/** A filter with every part spelled out, which is what the shell holds. */
export interface Narrowing {
  readonly text: string;
  readonly properties: readonly string[];
  readonly fields: readonly { readonly field: string; readonly value: string | null }[];
  readonly terms: readonly { readonly vocab: string; readonly term: string }[];
}

export const NOTHING: Narrowing = { text: "", properties: [], fields: [], terms: [] };

/** True when the narrowing narrows something. */
export function isNarrowed(narrowing: Narrowing): boolean {
  return (
    narrowing.text.trim() !== "" ||
    narrowing.properties.length > 0 ||
    narrowing.fields.length > 0 ||
    narrowing.terms.length > 0
  );
}

/**
 * What to ask the bridge for.
 *
 * A narrowed grid is flat, across the whole library. One that is not is a
 * level of the tree a plugin built: the top, or inside whatever was opened.
 */
export function filterFor(narrowing: Narrowing, inside: ObjectId | null): Filter {
  if (isNarrowed(narrowing)) {
    return {
      text: narrowing.text.trim(),
      properties: narrowing.properties,
      fields: narrowing.fields,
      terms: narrowing.terms,
    };
  }
  return inside === null ? { top: true } : { within: inside };
}

export function withText(narrowing: Narrowing, text: string): Narrowing {
  return { ...narrowing, text };
}

export function hasProperty(narrowing: Narrowing, property: string): boolean {
  return narrowing.properties.includes(property);
}

export function toggleProperty(narrowing: Narrowing, property: string): Narrowing {
  return {
    ...narrowing,
    properties: hasProperty(narrowing, property)
      ? narrowing.properties.filter((p) => p !== property)
      : [...narrowing.properties, property],
  };
}

export function hasField(narrowing: Narrowing, field: string, value: string | null): boolean {
  return narrowing.fields.some((clause) => clause.field === field && clause.value === value);
}

export function toggleField(narrowing: Narrowing, field: string, value: string | null): Narrowing {
  return {
    ...narrowing,
    fields: hasField(narrowing, field, value)
      ? narrowing.fields.filter((clause) => !(clause.field === field && clause.value === value))
      : [...narrowing.fields, { field, value }],
  };
}

export function hasTerm(narrowing: Narrowing, vocab: string, term: string): boolean {
  return narrowing.terms.some((clause) => clause.vocab === vocab && clause.term === term);
}

export function toggleTerm(narrowing: Narrowing, vocab: string, term: string): Narrowing {
  return {
    ...narrowing,
    terms: hasTerm(narrowing, vocab, term)
      ? narrowing.terms.filter((clause) => !(clause.vocab === vocab && clause.term === term))
      : [...narrowing.terms, { vocab, term }],
  };
}

/** Only this term, as following a link to it from an object page means. */
export function onlyTerm(vocab: string, term: string): Narrowing {
  return { ...NOTHING, terms: [{ vocab, term }] };
}

/** Only this field value. */
export function onlyField(field: string, value: string | null): Narrowing {
  return { ...NOTHING, fields: [{ field, value }] };
}

/** What the sidebar offers: every plugin's facets and vocabularies, once each. */
export function facetsOf(plugins: readonly Manifest[]): { fields: string[]; vocabularies: string[] } {
  const fields: string[] = [];
  const vocabularies: string[] = [];
  for (const plugin of plugins) {
    for (const field of plugin.contributes?.facets ?? []) {
      if (!fields.includes(field)) fields.push(field);
    }
    for (const vocab of plugin.contributes?.vocabularies ?? []) {
      if (!vocabularies.includes(vocab)) vocabularies.push(vocab);
    }
  }
  return { fields, vocabularies };
}

/** `category` as a heading: `Category`. */
export function headingFor(name: string): string {
  if (name === "") return name;
  return name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, " ");
}

/** A field value as the sidebar shows it. `null` is the objects showing none. */
export function valueLabel(value: string | null): string {
  return value ?? "Not set";
}

/** One chosen thing, as a removable chip above the grid. */
export interface Chip {
  readonly key: string;
  readonly label: string;
  readonly remove: (narrowing: Narrowing) => Narrowing;
}

/**
 * Every choice in the narrowing, in the order the sidebar draws its groups.
 *
 * `labels` turns a term id into what the sidebar showed for it; a term the
 * counts did not mention keeps its id rather than disappearing from the
 * chips, since it is still narrowing the grid.
 */
export function chipsOf(narrowing: Narrowing, labels: ReadonlyMap<string, string>): Chip[] {
  const chips: Chip[] = [];
  const text = narrowing.text.trim();
  if (text !== "") {
    chips.push({ key: "text", label: `“${text}”`, remove: (n) => withText(n, "") });
  }
  for (const property of narrowing.properties) {
    chips.push({
      key: `property:${property}`,
      label: `Type: ${property}`,
      remove: (n) => toggleProperty(n, property),
    });
  }
  for (const { field, value } of narrowing.fields) {
    chips.push({
      key: `field:${field}:${value ?? "\u0000"}`,
      label: `${headingFor(field)}: ${valueLabel(value)}`,
      remove: (n) => toggleField(n, field, value),
    });
  }
  for (const { vocab, term } of narrowing.terms) {
    chips.push({
      key: `term:${vocab}:${term}`,
      label: `${headingFor(vocab)}: ${labels.get(`${vocab}:${term}`) ?? term}`,
      remove: (n) => toggleTerm(n, vocab, term),
    });
  }
  return chips;
}
