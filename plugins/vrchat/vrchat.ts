/**
 * What a VRChat asset library is made of, apart from what draws it.
 *
 * The plugin the whole design came out of, built last on purpose: the PDF
 * and paper plugins exposed defects in the extension points with almost no
 * domain knowledge in the way, and this one carries a lot of it. Everything
 * here is a judgement `seed/vrc-lessons.md` records the cost of getting
 * wrong, so each rule is pure and tested on its own.
 *
 * # Two properties, one plugin
 *
 * `vrchat` is what a thing is in this library: a category, a vendor, which
 * avatars it fits. `booth` is where it was bought: a listing with a price and
 * a URL. They are separate because a product can be sold on two shops and a
 * shop can sell things that are not VRChat assets; they ship together because
 * the architecture's own example does, and splitting them before a second
 * shop exists would be designing against nothing.
 *
 * # What counts as an object here
 *
 * A product is one folder or one file, directly under a category folder.
 * `vrc-lessons.md`: "A product maps to exactly one folder or file. Products do
 * not span folders." The category folders are the top-level ones, and they
 * are objects too, holding their products through `contains` -- that is what
 * the object list draws. Nothing below a product is an object: the forty
 * textures inside an outfit are the outfit's, and listing them is what made
 * the library impossible to organise.
 *
 * A top-level file is a product with no category. Anything deeper than a
 * product is not looked at, which is why the scan walks two levels and not
 * the tree.
 *
 * # What this does not decide
 *
 * It does not read inside anything, judge a folder by its name, or guess an
 * avatar from a filename. Each of those is a trap the lessons name, and each
 * is a later rule with its own evidence. The scan proposes objects and their
 * category; everything else arrives by import or by hand.
 */

import type { Api, Entry } from "../../src/plugin-host/commands.js";

/**
 * Categories the seed library settled on, offered as suggestions.
 *
 * Suggestions, not a list: a category is a string the person chose, and the
 * form accepts any. These are the ones 174 products sorted into.
 */
export const CATEGORIES: readonly string[] = [
  "Clothing",
  "Hair",
  "Accessory",
  "Bases",
  "BodyTexture",
  "Gimmick",
  "Animation",
  "FaceTracking",
  "Editor",
  "MochiFitter",
  "NSFW",
];

/** One object a scan proposes. */
export interface Proposed {
  readonly path: string;
  readonly isFolder: boolean;
  /** `vrchat#1/category` for a product; nothing for a category folder. */
  readonly values: Readonly<Record<string, string>>;
  /** Paths this holds. Only a category folder holds anything. */
  readonly contains: readonly string[];
}

/**
 * Which entries become objects, and what each is.
 *
 * Entries come from a two-level walk: `Clothing` and `Clothing/outfit.zip`,
 * never `Clothing/outfit/skin.png`. A deeper entry, if one arrives, is
 * ignored rather than guessed about.
 */
export function productsFrom(entries: readonly Entry[]): Proposed[] {
  const top = entries.filter((entry) => !entry.path.includes("/"));
  const proposed: Proposed[] = [];

  for (const entry of top) {
    if (entry.kind === "folder") {
      const inside = entries
        .filter((candidate) => candidate.path.startsWith(`${entry.path}/`))
        .filter((candidate) => !candidate.path.slice(entry.path.length + 1).includes("/"));

      proposed.push({
        path: entry.path,
        isFolder: true,
        values: {},
        contains: inside.map((candidate) => candidate.path),
      });

      for (const product of inside) {
        proposed.push({
          path: product.path,
          isFolder: product.kind === "folder",
          values: { "vrchat#1/category": entry.path },
          contains: [],
        });
      }
    } else {
      // A file at the root is a product nobody has filed yet.
      proposed.push({ path: entry.path, isFolder: false, values: {}, contains: [] });
    }
  }

  return proposed;
}

/** Read two levels of the disk and decide what to propose. */
export async function planFrom(api: Api): Promise<Proposed[]> {
  return productsFrom(await api.fsWalk(null, 2));
}

/**
 * The import document a plan becomes.
 *
 * Through `import.propose` like any other source: a category the scan
 * proposes over one a person chose becomes a change set, not an overwrite.
 */
export function documentFor(proposed: readonly Proposed[]): string {
  return JSON.stringify({
    version: 1,
    source: "vrchat scan",
    objects: proposed.map((object) => ({
      paths: [object.path],
      folders: object.isFolder ? [object.path] : [],
      id: object.path,
      values: object.values,
      edges: object.contains.map((path) => ({ kind: "contains", object: path })),
    })),
  });
}

/**
 * A Booth item id, from any of the ways people paste a listing.
 *
 * `https://booth.pm/ja/items/6467347`, `https://booth.pm/en/items/6467347`,
 * `https://unya28.booth.pm/items/5848934` and a bare `6467347` all name one
 * listing. The seed library's sources use all of them. The id is what is
 * stored beside the URL, so two spellings of one listing compare equal.
 */
export function boothItem(typed: string): string | undefined {
  const trimmed = typed.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;

  const match = /^https?:\/\/(?:[\w-]+\.)?booth\.pm\/(?:[a-z-]+\/)?items\/(\d+)/i.exec(trimmed);
  return match?.[1];
}

/** The canonical page for an item id. */
export function boothUrl(item: string): string {
  return `https://booth.pm/ja/items/${item}`;
}

/**
 * What the Booth form hands back, given what was typed.
 *
 * A URL that is not a Booth listing is refused rather than dropped, since the
 * person who pasted it would otherwise never learn why it vanished. A price
 * has to be a whole number of yen or empty.
 */
export function boothFields(typed: {
  url: string;
  price: string;
  title: string;
}): { ok: true; values: Record<string, string> } | { ok: false; problem: string } {
  const values: Record<string, string> = {};

  if (typed.url.trim() !== "") {
    const item = boothItem(typed.url);
    if (item === undefined) {
      return { ok: false, problem: `${typed.url.trim()} is not a Booth listing` };
    }
    values.item_id = item;
    values.url = boothUrl(item);
  }

  if (typed.price.trim() !== "") {
    if (!/^\d+$/.test(typed.price.trim())) {
      return { ok: false, problem: `${typed.price.trim()} is not a price in yen` };
    }
    values.price = typed.price.trim();
  }

  if (typed.title.trim() !== "") values.title = typed.title.trim();

  return { ok: true, values };
}

/** What the VRChat form hands back. Empty fields are left out. */
export function vrchatFields(typed: { category: string; vendor: string }): Record<string, string> {
  const values: Record<string, string> = {};
  if (typed.category.trim() !== "") values.category = typed.category.trim();
  if (typed.vendor.trim() !== "") values.vendor = typed.vendor.trim();
  return values;
}
