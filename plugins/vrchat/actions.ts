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
import { listingFrom, listingUrl, listingValues, pageUrl, shopMismatch } from "./booth.js";
import { boothItem } from "./vrchat.js";

export async function runObjectAction({ api, action, objectId, property, instance }: ObjectActionProps): Promise<ActionResult> {
  if (action !== "fetch listing") {
    return { summary: `${action} is not something this plugin does`, changed: false };
  }
  return fetchListing(api, objectId, property, instance);
}

/** A refusal in words: the bridge sends `{ kind, detail }`, a host check an Error. */
function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const { kind, detail } = error as { kind?: unknown; detail?: unknown };
    if (typeof kind === "string") return typeof detail === "string" ? `${kind}: ${detail}` : kind;
  }
  return String(error);
}

/** What a fetch did, with what the bulk run needs to report it. */
export interface Fetched extends ActionResult {
  /** The shop disagreed with the vendor the files or a person gave. */
  readonly mismatch?: { readonly shop: string; readonly files: string } | undefined;
}

/**
 * Fetch one listing and propose what it says. Shared by the button on one
 * object and the library action that presses it for every listing.
 *
 * `strict` refuses to write anything when the listing's shop disagrees with
 * the vendor already known: a run over a whole library would otherwise put
 * another shop's picture on a product whose listing number was wrong, which
 * is how two Qrochairo outfits showed another shop's name. A person pressing
 * the button on one object is told, and the values are proposed anyway.
 */
export async function fetchListing(
  api: ObjectActionProps["api"],
  objectId: ObjectActionProps["objectId"],
  property: string,
  instance: number,
  strict = false,
): Promise<Fetched> {
  const object = await api.objectFlat(objectId);
  const own = listingValues(object, property, instance);
  const item = own["item_id"] ?? (own["url"] ? boothItem(own["url"]) : undefined);
  if (!item) {
    return { summary: "no listing number recorded; add the Booth URL first", changed: false };
  }

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

  const mismatch = shopMismatch(read.listing.vendor, object, property, instance);
  const warning = mismatch
    ? `item ${item} is by ${mismatch.shop}, but this object says ${mismatch.files}: check the listing number`
    : undefined;
  if (strict && mismatch) {
    return { summary: `not written: ${warning}`, changed: false, mismatch };
  }

  const values: Record<string, string> = {};
  const under = `${property}#${instance}`;
  if (read.listing.title) values[`${under}/title`] = read.listing.title;
  if (read.listing.price) values[`${under}/price`] = read.listing.price;
  if (read.listing.vendor) values[`${under}/vendor`] = read.listing.vendor;
  values[`${under}/url`] = pageUrl(item);

  // The picture is what a grid of products most needs, so a failure to get
  // it is said, never swallowed: it was swallowed once, and every fetch came
  // back "written" with no cover and no reason.
  let picture: string | undefined;
  for (const image of read.listing.images ?? []) {
    try {
      values[`${under}/cover`] = await api.coverFetch(image);
      picture = undefined;
      break;
    } catch (error: unknown) {
      picture = reasonOf(error);
    }
  }

  const outcome = await api.importPropose(`Booth listing ${item}`, JSON.stringify({
    version: 1,
    source: `booth:${item}`,
    objects: [{ paths: [path], values, reason: `fetched from ${pageUrl(item)}` }],
  }));

  const parts = [`${outcome.written} written`];
  if (outcome.unchanged > 0) parts.push(`${outcome.unchanged} already so`);
  if (outcome.pending !== null) parts.push("some need review");
  if (picture !== undefined) parts.push(`no picture: ${picture}`);
  else if ((read.listing.images ?? []).length === 0) parts.push("the listing has no picture");
  if (warning) parts.push(warning);
  return { summary: parts.join(", "), changed: outcome.written > 0 || outcome.pending !== null, mismatch };
}
