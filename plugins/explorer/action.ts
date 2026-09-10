/**
 * Scanning, as a plugin does it.
 *
 * The core walks and the core reviews; this is the part in between, which is
 * the part that is a judgement. `docs.yml` says the core knows nothing about
 * what it stores, and "what counts as an object" is exactly that.
 *
 * The judgement itself lives in `explorer.ts`: every file and every folder
 * becomes an object. This file only carries it to the core, which is why the
 * two are separate — the rule is worth reading on its own, and submitting it
 * is the same work whatever the rule turns out to be.
 */

import type { LibraryActionProps, ActionResult } from "../../src/plugin-host/panel.js";
import { documentFor, planFrom } from "./explorer.js";

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
  const outcome = await api.importPropose("file explorer scan", documentFor(plan));

  const parts = [`${outcome.objects_created} added`];
  if (outcome.unchanged > 0) parts.push(`${outcome.unchanged} unchanged`);
  if (outcome.pending !== null) parts.push("some need review");

  return {
    summary: parts.join(", "),
    changed: outcome.objects_created > 0 || outcome.written > 0,
  };
}
