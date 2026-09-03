/**
 * Scanning, as a plugin does it.
 *
 * The core walks and the core reviews; this is the part in between, which is
 * the part that is a judgement. `docs.yml` says the core knows nothing about
 * what it stores, and "what counts as an object" is exactly that.
 *
 * The answer here is the plainest one: every file and every folder is an
 * object. That is right for a library of loose documents and wrong for a
 * VRChat library, where a product folder is the object and its forty contents
 * are not. Being wrong for some libraries is the point — the library that
 * disagrees installs a different plugin, and the core never had an opinion to
 * change.
 */

import type { LibraryActionProps, ActionResult } from "../../src/plugin-host/panel.js";
import { documentFor, planFrom } from "./folder.js";

export async function runLibraryAction({
  api,
  action,
}: LibraryActionProps): Promise<ActionResult> {
  if (action !== "scan") {
    return { summary: `${action} is not something this plugin does`, changed: false };
  }

  const plan = await planFrom(api, null);
  if (plan.proposed.length === 0) {
    return { summary: "nothing on disk", changed: false };
  }

  // Through import.propose like any other source. What fits into empty fields
  // is written; anything that would overwrite a decision waits for a person.
  // A scan gets no shortcut around that, which is what keeps a plugin from
  // quietly replacing values somebody set.
  const outcome = await api.importPropose("folder scan", documentFor(plan));

  const parts = [`${outcome.objects_created} added`];
  if (outcome.unchanged > 0) parts.push(`${outcome.unchanged} unchanged`);
  if (outcome.pending !== null) parts.push("some need review");

  return {
    summary: parts.join(", "),
    changed: outcome.objects_created > 0 || outcome.written > 0,
  };
}
