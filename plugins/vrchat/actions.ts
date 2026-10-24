/**
 * What a person can press on a Booth listing.
 *
 * One action: fetch the listing. The press is what lends this plugin the
 * network, for `booth.pm` and its shops and nothing else, and what the shop
 * said goes through `import.propose` like any other source: into empty
 * fields at once, and into a change set where a person already chose. The
 * picture is stored by the core and proposed as a path under `booth#1`, so
 * the page draws it offline from then on.
 */

import type { ActionResult, ObjectActionProps } from "../../src/plugin-host/panel.js";
import { listingFrom, listingUrl } from "./booth.js";
import { boothItem } from "./vrchat.js";

export async function runObjectAction({ api, action, objectId, property, instance }: ObjectActionProps): Promise<ActionResult> {
  if (action !== "fetch listing") {
    return { summary: `${action} is not something this plugin does`, changed: false };
  }

  const object = await api.objectFlat(objectId);
  const region = object.regions.find((r) => r.property === property && r.instance === instance);
  const item = region?.fields["item_id"] ?? (region?.fields["url"] ? boothItem(region.fields["url"]) : undefined);
  if (!item) {
    return { summary: "no listing number recorded; add the Booth URL first", changed: false };
  }

  // Matched by path. An object with no location would need its import key,
  // which a plugin cannot read; saying so beats proposing into nothing.
  const path = object.locations[0]?.path;
  if (!path) {
    return { summary: "this object has no location to propose against", changed: false };
  }

  const response = await api.httpGet(listingUrl(item));
  if (response.status !== 200) {
    return { summary: `Booth answered ${response.status} for item ${item}`, changed: false };
  }
  const read = listingFrom(response.body);
  if (!read.ok) return { summary: read.problem, changed: false };

  const values: Record<string, string> = {};
  const under = `${property}#${instance}`;
  if (read.listing.title) values[`${under}/title`] = read.listing.title;
  if (read.listing.price) values[`${under}/price`] = read.listing.price;
  if (read.listing.vendor) values[`${under}/vendor`] = read.listing.vendor;
  if (read.listing.image) {
    try {
      values[`${under}/cover`] = await api.coverFetch(read.listing.image);
    } catch {
      // A picture that will not fetch costs the picture, not the listing.
    }
  }

  const outcome = await api.importPropose(`Booth listing ${item}`, JSON.stringify({
    version: 1,
    source: `booth:${item}`,
    objects: [{ paths: [path], values, reason: `fetched from ${listingUrl(item)}` }],
  }));

  const parts = [`${outcome.written} written`];
  if (outcome.unchanged > 0) parts.push(`${outcome.unchanged} already so`);
  if (outcome.pending !== null) parts.push("some need review");
  return { summary: parts.join(", "), changed: outcome.written > 0 };
}
