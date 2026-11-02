/**
 * Scanning a VRChat library, as this plugin does it.
 *
 * The rule is in `vrchat.ts`; this carries it to the core. Through
 * `import.propose` like any other source: what fits into empty fields is
 * written, and a category proposed over one a person chose waits for review.
 */

import type { ActionResult, LibraryActionProps } from "../../src/plugin-host/panel.js";
import { fetchListing } from "./actions.js";
import { listingValues } from "./booth.js";
import { DEPTH_SETTING, depthFrom, documentFor, planFrom } from "./vrchat.js";

/** Waited between two requests to Booth, so a library of listings is not a burst. */
export const BETWEEN_REQUESTS_MS = 1000;

export async function runLibraryAction({ api, action, progress }: LibraryActionProps): Promise<ActionResult> {
  if (action === "fetch booth listings") return fetchAllListings(api, undefined, progress);
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
  progress?: LibraryActionProps["progress"],
): Promise<ActionResult> {
  const wanted: { id: string; property: string; instance: number; name: string }[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await api.objectQuery({ properties: ["booth"] }, "name", offset, 500);
    for (const id of page.ids) {
      const object = await api.objectFlat(id);
      for (const region of object.regions) {
        if (region.property !== "booth") continue;
        const own = listingValues(object, region.property, region.instance);
        if (own["cover"]) continue;
        if (!own["item_id"] && !own["url"]) continue;
        const name = object.shared["title"]?.[0]?.value ?? object.locations[0]?.path ?? id;
        wanted.push({ id, property: region.property, instance: region.instance, name });
      }
    }
    if (page.ids.length === 0 || offset + page.ids.length >= page.total) break;
  }

  if (wanted.length === 0) return { summary: "every recorded listing is fetched already", changed: false };

  let fetched = 0;
  let failed = 0;
  const doubtful: string[] = [];
  for (const [index, listing] of wanted.entries()) {
    progress?.(index, wanted.length);
    if (index > 0) await pause(BETWEEN_REQUESTS_MS);
    try {
      // Strict: a whole-library run never puts another shop's picture on a
      // product whose listing number was wrong.
      const result = await fetchListing(api, listing.id, listing.property, listing.instance, true);
      if (result.mismatch) doubtful.push(`${listing.name} (${result.mismatch.shop}, not ${result.mismatch.files})`);
      else if (result.changed) fetched += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }

  progress?.(wanted.length, wanted.length);
  const parts = [`${fetched} of ${wanted.length} listings fetched`];
  if (failed > 0) parts.push(`${failed} gave nothing new or failed`);
  if (doubtful.length > 0) {
    const named = doubtful.slice(0, 5).join("; ");
    const more = doubtful.length > 5 ? ` and ${doubtful.length - 5} more` : "";
    parts.push(`${doubtful.length} left alone because the shop differs from the vendor, so the listing number may be wrong: ${named}${more}`);
  }
  return { summary: parts.join(", "), changed: fetched > 0 };
}
