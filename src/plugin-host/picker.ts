/**
 * What a new object can be, and who asks for the rest.
 *
 * The picker is where a person says what a thing is. `architecture.md` settles
 * the model: an object is what its properties say, plural and chosen — the
 * software never guesses a semantic property, because it cannot tell a VRChat
 * outfit from a research dataset by looking at extensions.
 *
 * # Choosing runs the other way round
 *
 * Every other arbitration in `slots.ts` starts from what an object carries. At
 * this moment there is no object: the choice is what will decide the
 * properties, not the other way about. That inversion is why this is a module
 * of its own rather than another `collect` over the same three arguments — two
 * of them would be empty by definition.
 *
 * # Nothing here is a new vocabulary
 *
 * A type *is* a semantic property, and a domain *is* the dot already in its
 * name. `vrchat.booth` sits under `vrchat` because
 * `2026-09-01_object-property-model.md` made nested sub-types property names
 * containing a dot, and storage has supported them since. Inventing a `kinds`
 * list with its own `domain` field would be a second way to say what the
 * manifest already says.
 */

import { bareName, type Manifest } from "./types.js";
import type { Contribution, Mount } from "./slots.js";

/** One thing a new object can be. */
export interface Choice {
  /** The property it attaches: `vrchat.booth`. */
  readonly property: string;
  /**
   * The property name split on its dots: `["vrchat", "booth"]`.
   *
   * Precomputed because every caller that groups needs it and splitting a
   * string in a render loop is a decision made in the wrong place. The last
   * element is what a person reads; the ones before it are where it sits.
   */
  readonly path: readonly string[];
}

/**
 * Properties that are attached automatically because they are observably true.
 *
 * Derived rather than declared. A plugin says `"file_types": {"pdf": ["pdf"]}`
 * to mean "a `.pdf` brings the `pdf` property", so anything named on the right
 * of that is factual by construction. A manifest field saying so a second time
 * could disagree with the first.
 */
function factual(plugins: readonly Manifest[]): Set<string> {
  const found = new Set<string>();
  for (const plugin of plugins) {
    for (const properties of Object.values(plugin.contributes?.file_types ?? {})) {
      for (const property of properties) found.add(property);
    }
  }
  return found;
}

/**
 * What a person may choose, sorted by property name.
 *
 * Semantic properties only: `pdf` is not offered, because a file either is a
 * PDF or is not and nobody decides it. Offering it would invite somebody to
 * mark a `.docx` as a pdf and get a viewer that cannot read it.
 *
 * Sorted so the list is stable across runs, and so a dotted name lands next to
 * the name it extends. Mount order is deliberately not used: it ranks what a
 * library already has, and this is the list of what it could have.
 */
export function choosable(plugins: readonly Manifest[]): Choice[] {
  const automatic = factual(plugins);
  const seen = new Set<string>();
  const choices: Choice[] = [];

  for (const plugin of plugins) {
    for (const property of plugin.contributes?.properties ?? []) {
      if (automatic.has(property)) continue;
      // Two plugins declaring one property is refused by the registry before
      // anything reaches here. Collapsing is for a plugin that repeats itself.
      if (seen.has(property)) continue;
      seen.add(property);
      choices.push({ property, path: property.split(".") });
    }
  }

  return choices.sort((left, right) => left.property.localeCompare(right.property));
}

/**
 * The forms to show for what was chosen, in the order to show them.
 *
 * Mount order, which is the same rule every other slot uses. A second priority
 * list would give the user two places to manage one thing, and this one they
 * can already see.
 *
 * A chosen property the library does not mount yet has no rank. It sorts last
 * rather than being dropped: the form is how the person fills in the thing
 * they just asked for, and refusing to draw it because the library has never
 * seen that property before would make every first use silently skip its own
 * second step.
 */
export function formsFor(
  plugins: readonly Manifest[],
  chosen: readonly string[],
  order: readonly Mount[],
): Contribution[] {
  const rank = new Map<string, number>();
  order.forEach((mount, position) => {
    // Instance 1 is what a new object gets: nothing carries a second `booth`
    // page before it carries the first.
    if (mount.instance === 1) rank.set(mount.namespace, position);
  });

  const found: Array<{ contribution: Contribution; at: number }> = [];

  chosen.forEach((property, position) => {
    const name = bareName(property);
    for (const plugin of plugins) {
      const specifier = plugin.contributes?.forms?.[name];
      if (specifier === undefined) continue;

      found.push({
        contribution: { plugin: plugin.id, property: name, instance: 1, value: specifier },
        // Unmounted properties sort after every mounted one, and among
        // themselves in the order they were chosen.
        at: rank.get(name) ?? order.length + position,
      });
    }
  });

  return found.sort((left, right) => left.at - right.at).map(({ contribution }) => contribution);
}
