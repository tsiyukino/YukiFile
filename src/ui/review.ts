/**
 * A change set as a review screen reads it.
 *
 * Pure, and apart from the components. The screen's job is fetching and
 * buttons; this is the part worth checking on its own — that entries are
 * grouped by the object they touch, that an entry says what it would do in
 * words, and that the counts a person reads add up to the set.
 *
 * # Shaped like a pull request
 *
 * `2026-09-01_ui-primer-not-github-clone.md` says to copy GitHub's review
 * interaction and nothing else of it: a list of diffs, each accepted or
 * declined on its own, with "accept additions" as the one bulk action that is
 * always safe. A file in a diff is an object here, and a hunk is a field.
 */

import type { ChangeEntry, ChangeSetSummary, ObjectId, Summary } from "../plugin-host/commands.js";

/** Every entry touching one object, under what the object is called. */
export interface ObjectChanges {
  readonly object: ObjectId;
  /** A title, a filename, or nothing for an unnamed grouping. */
  readonly name: string | null;
  readonly entries: readonly ChangeEntry[];
}

/**
 * Entries grouped by object, in the order the first entry of each appears.
 *
 * The core already orders entries by object then field, so grouping keeps a
 * stable order without sorting again. Names come from `object.summaries`, the
 * same call the list uses; an object the summaries did not cover is still
 * shown, unnamed, rather than dropped — a proposal about an object nobody can
 * name is still a proposal.
 */
export function byObject(
  entries: readonly ChangeEntry[],
  names: readonly Summary[],
): ObjectChanges[] {
  const named = new Map(names.map((summary) => [summary.id, summary.name]));
  const groups = new Map<ObjectId, ChangeEntry[]>();

  for (const entry of entries) {
    const held = groups.get(entry.object);
    if (held) {
      held.push(entry);
    } else {
      groups.set(entry.object, [entry]);
    }
  }

  return [...groups.entries()].map(([object, held]) => ({
    object,
    name: named.get(object) ?? null,
    entries: held,
  }));
}

/** The objects a set touches, for fetching their names in one call. */
export function objectsOf(entries: readonly ChangeEntry[]): ObjectId[] {
  return [...new Set(entries.map((entry) => entry.object))];
}

/**
 * What one entry would do, in words.
 *
 * An addition fills a blank; a modification replaces; a proposal of `null`
 * clears. Said as a sentence rather than drawn as `old → new` because an
 * arrow between two empty strings says nothing, and clearing a field is the
 * case most worth being explicit about.
 */
export function wording(entry: ChangeEntry): string {
  if (entry.new === null) {
    return entry.old === null ? "would leave it empty" : `would clear "${entry.old}"`;
  }
  if (entry.old === null) {
    return `would set "${entry.new}"`;
  }
  return `would replace "${entry.old}" with "${entry.new}"`;
}

/**
 * A set's counts as one line.
 *
 * "3 additions and 1 modification, 3 accepted". Written here so the pane list
 * and the page say it the same way.
 */
export function countsOf(set: ChangeSetSummary): string {
  const parts: string[] = [];
  if (set.additions > 0) parts.push(plural(set.additions, "addition"));
  if (set.modifications > 0) parts.push(plural(set.modifications, "modification"));
  const what = parts.length > 0 ? parts.join(" and ") : "nothing";
  return `${what}, ${set.accepted} accepted`;
}

/** The counts of a set, recomputed from entries after a decision changed. */
export function recount(set: ChangeSetSummary, entries: readonly ChangeEntry[]): ChangeSetSummary {
  return {
    ...set,
    additions: entries.filter((entry) => entry.kind === "addition").length,
    modifications: entries.filter((entry) => entry.kind === "modification").length,
    accepted: entries.filter((entry) => entry.accepted).length,
  };
}

/** One entry with its acceptance flipped, the rest untouched. */
export function decided(
  entries: readonly ChangeEntry[],
  change: number,
  accepted: boolean,
): ChangeEntry[] {
  return entries.map((entry) => (entry.id === change ? { ...entry, accepted } : entry));
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
