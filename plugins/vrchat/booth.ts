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
  /** The first image, at the largest size Booth serves for it. */
  readonly image?: string;
  /** The first image's sizes, largest first: what to try in turn. */
  readonly images?: readonly string[];
}

/** The listing endpoint for an item number. */
export function listingUrl(item: string): string {
  return `https://booth.pm/en/items/${item}.json`;
}

/** The listing's page, the link a person follows. */
export function pageUrl(item: string): string {
  return `https://booth.pm/ja/items/${item}`;
}

/** What one Booth region of an object says, its own fields and its shared ones. */
export function listingValues(
  object: { readonly regions: readonly { property: string; instance: number; fields: Readonly<Record<string, string>> }[]; readonly shared: Readonly<Record<string, readonly { value: string; from: string | null }[]>> },
  property: string,
  instance: number,
): Record<string, string> {
  const from = `${property}#${instance}`;
  const values: Record<string, string> = {
    ...(object.regions.find((r) => r.property === property && r.instance === instance)?.fields ?? {}),
  };
  // Title, price, url, vendor and cover are shared: they sit among the
  // object's sources for each field, attributed to this region's mount.
  for (const [field, sources] of Object.entries(object.shared)) {
    const own = sources.find((source) => source.from === from);
    if (own) values[field] = own.value;
  }
  return values;
}

/** A shop name reduced to what two spellings of it share. */
function squeezed(name: string): string {
  return name.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

/**
 * Whether two names are the same shop: equal once case, spaces and
 * punctuation are set aside, or one inside the other (`MARX` and `MARX shop`).
 */
export function sameShop(a: string, b: string): boolean {
  const x = squeezed(a);
  const y = squeezed(b);
  if (x === "" || y === "") return true;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * The shop a listing names against the vendor anything else says, when they
 * disagree.
 *
 * A listing number found in a package's files can be the number of
 * something the package credits rather than the package itself: the seed
 * library filed two Qrochairo outfits under a listing from another shop
 * that way. The vendor the files or a person gave is the check. A shop
 * written in another script than the files' vendor will also disagree; the
 * warning says to look, not that it is wrong.
 */
export function shopMismatch(
  shop: string | undefined,
  object: { readonly shared: Readonly<Record<string, readonly { value: string; from: string | null }[]>> },
  property: string,
  instance: number,
): { shop: string; files: string } | undefined {
  if (!shop) return undefined;
  const from = `${property}#${instance}`;
  const other = (object.shared["vendor"] ?? []).find((source) => source.from !== from);
  if (!other || other.value.trim() === "") return undefined;
  return sameShop(shop, other.value) ? undefined : { shop, files: other.value };
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

  // The original first: a cover is stored at up to 512 pixels, and the
  // card-sized `resized` is 300. The smaller one stays as a fallback for a
  // picture too large to fetch.
  const images = item["images"];
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0] as Record<string, unknown> | undefined;
    const sizes = [text(first?.["original"]), text(first?.["resized"])].filter((url): url is string => url !== undefined);
    const [largest] = sizes;
    if (largest !== undefined) {
      listing.image = largest;
      listing.images = sizes;
    }
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
