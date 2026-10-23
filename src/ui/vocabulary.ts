/**
 * A term page as it reads: what points at a term, by how.
 *
 * Pure. The page fetches pointers and names; this groups them so that
 * "owned" and "supports" are two lists rather than one with a column, since
 * the question a person brings to an avatar's page is "what do I have for it"
 * before "what exists for it".
 */

import type { Pointer, Summary } from "../plugin-host/commands.js";

/** The objects pointing at a term by one kind of edge. */
export interface PointersOfKind {
  readonly kind: string;
  readonly objects: readonly Summary[];
}

/**
 * Pointers grouped by kind, kinds in the order they first appear, objects in
 * the order the core gave them.
 *
 * An object the summaries did not cover is kept with no name rather than
 * dropped: it still points at the term, and hiding it would hide the edge.
 */
export function byKind(pointers: readonly Pointer[], names: readonly Summary[]): PointersOfKind[] {
  const named = new Map(names.map((summary) => [summary.id, summary]));
  const groups = new Map<string, Summary[]>();
  for (const pointer of pointers) {
    const summary =
      named.get(pointer.object) ?? { id: pointer.object, name: null, path: null, kind: null };
    const held = groups.get(pointer.kind);
    if (held) held.push(summary);
    else groups.set(pointer.kind, [summary]);
  }
  return [...groups.entries()].map(([kind, objects]) => ({ kind, objects }));
}

/** The objects a list of pointers names, each once. */
export function objectsPointing(pointers: readonly Pointer[]): string[] {
  return [...new Set(pointers.map((pointer) => pointer.object))];
}

/** How many distinct objects point at the term, as one line. */
export function countWording(pointers: readonly Pointer[]): string {
  const count = objectsPointing(pointers).length;
  if (count === 0) return "Nothing points at this yet.";
  return `${count} ${count === 1 ? "object points" : "objects point"} at this.`;
}
