/**
 * Scanning a VRChat library, as this plugin does it.
 *
 * The rule is in `vrchat.ts`; this carries it to the core. Through
 * `import.propose` like any other source: what fits into empty fields is
 * written, and a category proposed over one a person chose waits for review.
 */

import type { ActionResult, LibraryActionProps } from "../../src/plugin-host/panel.js";
import { fetchListing } from "./actions.js";
import { DEPTH_SETTING, depthFrom, documentFor, planFrom } from "./vrchat.js";

/** Waited between two requests to Booth, so a library of listings is not a burst. */
export const BETWEEN_REQUESTS_MS = 1000;

export async function runLibraryAction({ api, action }: LibraryActionProps): Promise<ActionResult> {
  if (action === "fetch booth listings") return fetchAllListings(api);
  if (action !== "scan products") {
    return { summary: `${action} is not something this plugin does`, changed: false };
  }

  // How deep the groupings go is the library's to say, once, in its
  // settings; the plugin reads its own key.
  const depth = depthFrom(await api.settingGet(DEPTH_SETTING));
  const proposed = await planFrom(api, depth);
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

/**
 * Fetch every Booth listing the library records and has not fetched yet.
 *
 * A listing counts as fetched once the object holds the shop's cover from
 * that region: that is the one thing a fetch always tries to store, and the
 * picture a grid of products most needs. The cover is a shared field, so it
 * is looked for among the object's cover sources rather than in the region. One request at a time with a pause between, so four
 * hundred listings are four hundred polite requests rather than a burst.
 * A listing that fails is counted and passed over; the rest go on.
 */
export async function fetchAllListings(
  api: LibraryActionProps["api"],
  pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<ActionResult> {
  const wanted: { id: string; property: string; instance: number }[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await api.objectQuery({ properties: ["booth"] }, "name", offset, 500);
    for (const id of page.ids) {
      const object = await api.objectFlat(id);
      for (const region of object.regions) {
        if (region.property !== "booth") continue;
        const from = `${region.property}#${region.instance}`;
        if ((object.shared["cover"] ?? []).some((source) => source.from === from)) continue;
        if (!region.fields["item_id"] && !region.fields["url"]) continue;
        wanted.push({ id, property: region.property, instance: region.instance });
      }
    }
    if (page.ids.length === 0 || offset + page.ids.length >= page.total) break;
  }

  if (wanted.length === 0) return { summary: "every recorded listing is fetched already", changed: false };

  let fetched = 0;
  let failed = 0;
  for (const [index, listing] of wanted.entries()) {
    if (index > 0) await pause(BETWEEN_REQUESTS_MS);
    try {
      const result = await fetchListing(api, listing.id, listing.property, listing.instance);
      if (result.changed) fetched += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }

  const parts = [`${fetched} of ${wanted.length} listings fetched`];
  if (failed > 0) parts.push(`${failed} gave nothing new or failed`);
  return { summary: parts.join(", "), changed: fetched > 0 };
}
