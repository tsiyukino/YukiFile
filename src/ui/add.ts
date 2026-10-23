/**
 * Turning what a person chose into an object to create.
 *
 * Pure, and apart from the component that walks them through it. The
 * component's job is sequencing — which form is on screen, what going back
 * means — and this is the part worth checking on its own: that an empty form
 * does not lose the property it was for, and that a form's values land under
 * the property that owns them and nowhere else.
 */

import type { NewObject, PathAt } from "../plugin-host/commands.js";
import type { Choice } from "../plugin-host/picker.js";

/** What the forms handed back, keyed by the property each was scoped to. */
export type Collected = ReadonlyMap<string, Readonly<Record<string, string>>>;

/**
 * The object to create.
 *
 * Every chosen property is listed whether or not its form returned anything:
 * `2026-09-11_choosing-a-type-is-storable.md` is the record of what happened
 * when a blank form dropped the choice. Values are nested under the property
 * they came from, so the core spells `paper#1/doi` itself; a form's bare `doi`
 * never reaches the shared field space.
 *
 * A form that returned nothing contributes no entry rather than an empty one.
 * The core would accept the empty map, but a document that says "values for
 * paper: none" is saying something it does not mean.
 */
export function newObjectFrom(
  at: PathAt | undefined,
  chosen: readonly string[],
  collected: Collected,
): NewObject {
  const values: Record<string, Readonly<Record<string, string>>> = {};
  for (const property of chosen) {
    const fields = collected.get(property);
    if (fields && Object.keys(fields).length > 0) values[property] = fields;
  }

  return {
    paths: at ? [at] : [],
    properties: [...chosen],
    values,
  };
}

/**
 * How a choice reads on screen.
 *
 * `vrchat.booth` is "booth", within "vrchat". The last segment is what a
 * person picks; the ones before it say where it sits, and are shown only when
 * there are any — a bare `paper` sits nowhere in particular.
 */
export function wording(choice: Choice): { readonly name: string; readonly within: string | undefined } {
  const name = choice.path[choice.path.length - 1] ?? choice.property;
  const above = choice.path.slice(0, -1);
  return { name, within: above.length > 0 ? above.join(".") : undefined };
}

/** The last segment of a path: what a person already calls the thing. */
export function nameOf(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}
