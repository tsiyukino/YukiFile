/**
 * Scanning a VRChat library, as this plugin does it.
 *
 * The rule is in `vrchat.ts`; this carries it to the core. Through
 * `import.propose` like any other source: what fits into empty fields is
 * written, and a category proposed over one a person chose waits for review.
 */

import type { ActionResult, LibraryActionProps } from "../../src/plugin-host/panel.js";
import { documentFor, planFrom } from "./vrchat.js";

export async function runLibraryAction({ api, action }: LibraryActionProps): Promise<ActionResult> {
  if (action !== "scan products") {
    return { summary: `${action} is not something this plugin does`, changed: false };
  }

  const proposed = await planFrom(api);
  if (proposed.length === 0) {
    return { summary: "nothing on disk", changed: false };
  }

  const outcome = await api.importPropose("vrchat scan", documentFor(proposed));

  const parts = [`${outcome.objects_created} added`];
  if (outcome.unchanged > 0) parts.push(`${outcome.unchanged} unchanged`);
  if (outcome.pending !== null) parts.push("some need review");

  return {
    summary: parts.join(", "),
    changed: outcome.objects_created > 0 || outcome.written > 0,
  };
}
