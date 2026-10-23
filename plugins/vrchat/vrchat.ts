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
 * A product is one folder or one file. `vrc-lessons.md`: "A product maps to
 * exactly one folder or file. Products do not span folders." Which folders
 * are products is decided **by content, never by name** -- the lessons made
 * that mistake twice with `Texture/`, which is sometimes loose PNGs belonging
 * to a product and sometimes a category holding eighteen of them.
 *
 * So: a folder that directly holds a loose file -- a texture, a mesh, a
 * readme -- is a product, and nothing below it is an object; the forty
 * textures inside an outfit are the outfit's. A folder that holds only
 * folders and packaged things is a grouping, and each thing directly inside
 * it is an object of its own. A zip or a unitypackage is never loose content:
 * it is a product by itself, wherever it sits, which is what makes
 * `_Archive/` forty-two products rather than one. That reads an organised
 * library and an unorganised one the same way, which it has to: before a
 * library is organised nobody knows what any of it is, and the scan is what
 * makes it possible to find out.
 *
 * # What this does not decide
 *
 * The category. A folder's name is where a thing sits, not what it is, and
 * the same library has `Clothes`, `Cloths` and `CLOTHS`. A category arrives
 * by import or from a person. The scan also does not read inside anything,
 * judge a folder by its name, or guess an avatar from a filename. Each of
 * those is a trap the lessons name, and each is a later rule with its own
 * evidence.
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
  /** Paths this holds. Only a grouping holds anything. */
  readonly contains: readonly string[];
}

/**
 * Files that are a product in themselves rather than part of one.
 *
 * An archive or a package sitting in a folder is a thing somebody bought and
 * put there; a texture or a mesh sitting in a folder is part of the thing the
 * folder is. The plugin may name extensions where the core may not, and this
 * is the one place it does.
 */
const PACKAGED: readonly string[] = ["zip", "unitypackage", "rar", "7z"];

/** Whether a file is part of whatever folder it sits in, rather than a thing of its own. */
export function isLoose(entry: Entry): boolean {
  if (entry.kind !== "file") return false;
  const name = entry.path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  const extension = dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
  return !PACKAGED.includes(extension);
}

/**
 * Which entries become objects.
 *
 * Decided from the whole walk, because whether a folder is a product depends
 * on what is directly inside it, and that is not visible from its name or
 * its depth.
 */
export function productsFrom(entries: readonly Entry[]): Proposed[] {
  // Direct children of each folder, with "" for the root.
  const children = new Map<string, Entry[]>();
  for (const entry of entries) {
    const slash = entry.path.lastIndexOf("/");
    const parent = slash === -1 ? "" : entry.path.slice(0, slash);
    const held = children.get(parent) ?? [];
    held.push(entry);
    children.set(parent, held);
  }

  const proposed: Proposed[] = [];

  // A grouping: every direct child becomes an object, and the folders among
  // them are looked at in turn.
  const group = (folder: string): void => {
    for (const child of children.get(folder) ?? []) {
      if (child.kind === "file") {
        proposed.push({ path: child.path, isFolder: false, contains: [] });
      } else if (isGrouping(child.path)) {
        proposed.push({
          path: child.path,
          isFolder: true,
          contains: (children.get(child.path) ?? []).map((inside) => inside.path),
        });
        group(child.path);
      } else {
        proposed.push({ path: child.path, isFolder: true, contains: [] });
      }
    }
  };

  // A folder holding nothing loose: only folders and packaged things. An
  // empty folder is not a grouping: it is a thing somebody made, with
  // nothing in it yet.
  const isGrouping = (folder: string): boolean => {
    const inside = children.get(folder) ?? [];
    return inside.length > 0 && !inside.some(isLoose);
  };

  group("");
  return proposed;
}

/**
 * Read the whole disk and decide what to propose.
 *
 * The whole tree, not a level: whether a folder is a product is decided by
 * what is directly inside it, and that is one level further down than the
 * folder itself, all the way down.
 */
export async function planFrom(api: Api): Promise<Proposed[]> {
  return productsFrom(await api.fsWalk(null));
}

/**
 * The import document a plan becomes.
 *
 * Objects and containment only; no values. Through `import.propose` like any
 * other source, and idempotent for the same reason the explorer's is: the
 * path is the stable key.
 */
export function documentFor(proposed: readonly Proposed[]): string {
  return JSON.stringify({
    version: 1,
    source: "vrchat scan",
    objects: proposed.map((object) => ({
      paths: [object.path],
      folders: object.isFolder ? [object.path] : [],
      id: object.path,
      values: {},
      edges: object.contains.map((path) => ({ kind: "contains", object: path })),
    })),
  });
}

/**
 * The category a path's parent folder suggests, if it is one.
 *
 * Only when the folder is spelled like one of the known categories, case
 * aside: `Clothing/outfit.zip` suggests `Clothing`, `.LAPWING/outfit.zip`
 * suggests nothing. A folder's name is where a thing sits, and only when it
 * happens to also say what it is does the form start from it.
 */
export function categorySuggestedBy(path: string): string | undefined {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return undefined;
  const parent = path.slice(0, slash).split("/").pop() ?? "";
  return CATEGORIES.find((category) => category.toLowerCase() === parent.toLowerCase());
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
