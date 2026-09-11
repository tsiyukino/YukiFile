/**
 * What is on disk, lined up against what the library already holds.
 *
 * Pure, and separate from the component that draws it. The comparison is
 * string work over two lists that come from different places and are spelled
 * differently, which is exactly where an off-by-one hides — and a pure module
 * can be checked against the real 441-row library rather than against a
 * fixture somebody invented.
 *
 * # Two spellings of one path
 *
 * `fs.walk` reports paths relative to whatever it was asked to walk, so
 * walking `Clothing` gives `outfit.zip`, not `Clothing/outfit.zip`. The library
 * stores paths relative to its root, so the same file is `Clothing/outfit.zip`
 * there.
 *
 * Comparing them without joining looks like it works: at the root the two
 * spellings are identical, so every test written against the root passes and
 * nothing below the root is ever recognised.
 */

import type { Entry } from "../plugin-host/commands.js";

/** One row of a disk listing. */
export interface DiskRow {
  /** The name as it sits in this directory: `outfit.zip`. */
  readonly name: string;
  /** Where it sits relative to the library root: `Clothing/outfit.zip`. */
  readonly path: string;
  readonly kind: "file" | "folder";
  /** Size in bytes. Absent for a folder. */
  readonly size: number | null;
  /** Whether the library already holds an object at this path. */
  readonly known: boolean;
}

/**
 * Join a directory to a name inside it.
 *
 * The root is the empty string, and joining onto it must not produce a leading
 * slash: `/Clothing` is not a path the library ever stored, so every row under
 * it would read as new and adding one would collide on a path that is already
 * taken.
 */
export function under(directory: string, name: string): string {
  return directory === "" ? name : `${directory}/${name}`;
}

/**
 * What a directory holds, said against what the library knows.
 *
 * `walked` is one level from `fs.walk`, `directory` is where that level sits
 * relative to the root, and `known` is every path the library has an object
 * at.
 *
 * Order comes from the walk, which already sorts. Sorting again here would be
 * a second answer to a settled question.
 */
export function rowsFor(
  walked: readonly Entry[],
  directory: string,
  known: ReadonlySet<string>,
): DiskRow[] {
  return walked.map((entry) => {
    const path = under(directory, entry.path);
    return {
      name: entry.path,
      path,
      kind: entry.kind,
      size: entry.size,
      known: known.has(path),
    };
  });
}

/**
 * The rows to show, given whether the already-recorded ones are wanted.
 *
 * Filtering here rather than in `rowsFor` keeps "what is there" and "what to
 * look at" apart: the toggle is a way of looking, not a fact about the disk,
 * and a caller that wants the count of both has it without walking twice.
 */
export function showing(rows: readonly DiskRow[], hideKnown: boolean): DiskRow[] {
  return hideKnown ? rows.filter((row) => !row.known) : [...rows];
}

/**
 * Where a trail of names points, relative to the root.
 *
 * `["Clothing", "AW KLASSIK"]` is `Clothing/AW KLASSIK`. An empty trail is the
 * root, which is
 * the empty string rather than `/` — see {@link under}.
 */
export function pathOf(trail: readonly string[]): string {
  return trail.join("/");
}
