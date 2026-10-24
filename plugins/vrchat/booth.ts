/**
 * What a Booth listing says, read out of what the shop sends.
 *
 * Booth answers `https://booth.pm/en/items/<id>.json` with the listing as
 * JSON: a name, a price as text with the yen sign, the shop, the images.
 * This module reads that into the fields the plugin stores, and nothing
 * else: the matching VRCAL does -- scoring a filename against candidates --
 * is a later rule, and this one only has to be right about a listing whose
 * number is already known.
 *
 * Tolerant on purpose. The shape is the shop's to change, and a field that
 * moved should cost the field, not the fetch. Anything missing is left out,
 * and a listing with no name at all is reported as not a listing.
 */

/** The fields a listing yields, each present only when the shop said it. */
export interface Listing {
  readonly title?: string;
  /** Whole yen, as text. */
  readonly price?: string;
  /** The shop's name, which is what `vendor` means for a Booth product. */
  readonly vendor?: string;
  /** The first image, at the size Booth serves for a card. */
  readonly image?: string;
}

/** The listing endpoint for an item number. */
export function listingUrl(item: string): string {
  return `https://booth.pm/en/items/${item}.json`;
}

/** Read a listing out of the shop's JSON, or say why not. */
export function listingFrom(json: string): { ok: true; listing: Listing } | { ok: false; problem: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, problem: "the shop did not answer with a listing" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, problem: "the shop did not answer with a listing" };
  }
  const item = parsed as Record<string, unknown>;

  const title = text(item["name"]);
  if (title === undefined) return { ok: false, problem: "the listing has no name" };

  const listing: { -readonly [K in keyof Listing]: Listing[K] } = { title };

  const price = yen(item["price"]);
  if (price !== undefined) listing.price = price;

  const shop = item["shop"];
  const vendor = typeof shop === "object" && shop !== null ? text((shop as Record<string, unknown>)["name"]) : undefined;
  if (vendor !== undefined) listing.vendor = vendor;

  const images = item["images"];
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0] as Record<string, unknown> | undefined;
    const image = text(first?.["resized"]) ?? text(first?.["original"]);
    if (image !== undefined) listing.image = image;
  }

  return { ok: true, listing };
}

/** A non-empty string, or nothing. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * Whole yen out of what Booth sends: `"¥ 1,200"`, `"1200 JPY"`, or a number.
 *
 * The digits, with separators dropped. A price with none is not a price.
 */
export function yen(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return String(value);
  if (typeof value !== "string") return undefined;
  const digits = value.replace(/[^\d]/g, "");
  return digits === "" ? undefined : String(Number(digits));
}
