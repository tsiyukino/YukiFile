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
 * exactly one folder or file. Products do not span folders." What the scan
 * cannot know is *where products begin*: a folder is a category holding
 * products, or a product holding its own parts, and nothing in the folder
 * says which. The first version decided by content -- a folder with loose
 * files is a product -- and on the real library it made 800 objects of 174
 * products, because an unpacked package is a folder of folders.
 *
 * So the library says. A scan takes a grouping depth: every folder down to
 * that depth is a grouping, and everything directly below a grouping is a
 * product, whatever is inside it. One level for a library sorted into
 * categories (`Clothing/outfit/`), two for one sorted by avatar and then by
 * kind (`.LAPWING/Clothes/outfit/`). A file at a grouping level is a product
 * too, since a file is never a grouping. That is a fact about how the person
 * arranged their library, told once, rather than a guess made per folder.
 *
 * Before either of those, the product's own evidence. A folder that directly
 * holds `Assets/`, `Packages/` or `ProjectSettings/`, or a model, a prefab or
 * a material, is a Unity layout -- an unpacked package or a project -- and a
 * Unity layout is one thing. That is not a judgement about meaning; it is
 * what the format is. It is what lets `Bases/Airi_Ver1.00/` be a product
 * without anyone saying so, and it is the rule VRCAL's scanner arrived at:
 * "engine layouts and loose model sources prove a product boundary".
 *
 * One more fact, from the same place: categories nest. The seed library has
 * `NSFW/BDSM/Accessory/`, and a depth of one read `NSFW/BDSM` as a product
 * holding 21 real ones. A folder inside a grouping whose name is one of the
 * plugin's own category names is a grouping too, at any depth. That is a
 * judgement by name, and it is allowed where `Texture/` was not: the
 * category list is the person's, and the question is "is this one of the
 * folders I sort into", not "what is inside this".
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

/**
 * Folders that are groupings wherever they sit inside another grouping.
 *
 * The categories, and the two names the seed nests under `NSFW/`. A product
 * folder would have to be named exactly like one of these to be misread,
 * which is the kind of coincidence a person notices on the object page.
 */
export const GROUPING_NAMES: readonly string[] = [...CATEGORIES, "BDSM", "BodyPart"];

/**
 * What proves a folder is a Unity layout, and so one thing.
 *
 * Folder names Unity itself makes, and file types that only exist inside
 * one. `Textures/` is deliberately not here: a category can be called that,
 * and `vrc-lessons.md` made the mistake of judging it twice.
 */
const ENGINE_FOLDERS: readonly string[] = ["assets", "packages", "projectsettings"];
const ENGINE_FILES: readonly string[] = ["fbx", "obj", "blend", "prefab", "mat", "anim", "controller", "shader", "unity"];

/** Whether these direct children prove a Unity layout. */
export function isEngineLayout(children: readonly Entry[]): boolean {
  return children.some((child) => {
    const name = child.path.slice(child.path.lastIndexOf("/") + 1).toLowerCase();
    if (child.kind === "folder") return ENGINE_FOLDERS.includes(name);
    const dot = name.lastIndexOf(".");
    return dot !== -1 && ENGINE_FILES.includes(name.slice(dot + 1));
  });
}

/** One object a scan proposes. */
export interface Proposed {
  readonly path: string;
  readonly isFolder: boolean;
  /** Paths this holds. Only a grouping holds anything. */
  readonly contains: readonly string[];
}

/** How deep the groupings go, by what the library action was called. */
export const ACTIONS: Readonly<Record<string, number>> = {
  "scan products": 1,
  "scan products, groupings two deep": 2,
};

/**
 * Which entries become objects.
 *
 * `groupingDepth` is how many folder levels are groupings. Depth 1: the
 * top-level folders group, and `Clothing/outfit` is a product. Depth 2:
 * `.LAPWING/Clothes` groups too, and `.LAPWING/Clothes/outfit` is a product.
 * Depth 0: everything at the root is a product and there are no groupings.
 * Below the depth, a folder named like a category inside a grouping is a
 * grouping as well, so `NSFW/BDSM/Accessory/` holds products at depth 1.
 *
 * Whatever sits below a product is the product's and is not looked at.
 */
export function productsFrom(entries: readonly Entry[], groupingDepth = 1): Proposed[] {
  const parentOf = (path: string): string => {
    const slash = path.lastIndexOf("/");
    return slash === -1 ? "" : path.slice(0, slash);
  };
  const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
  const depthOf = (path: string): number => path.split("/").length;

  const childrenOf = new Map<string, Entry[]>();
  for (const entry of entries) {
    const held = childrenOf.get(parentOf(entry.path)) ?? [];
    held.push(entry);
    childrenOf.set(parentOf(entry.path), held);
  }

  // Decided top-down: a folder can only be a grouping if its parent is one.
  // The root is one by definition. A Unity layout is never one, whatever its
  // depth or name: the product's own evidence comes first.
  const groupings = new Set<string>([""]);
  for (const entry of [...entries].sort((a, b) => depthOf(a.path) - depthOf(b.path))) {
    if (entry.kind !== "folder" || !groupings.has(parentOf(entry.path))) continue;
    if (isEngineLayout(childrenOf.get(entry.path) ?? [])) continue;
    const named = GROUPING_NAMES.some((name) => name.toLowerCase() === nameOf(entry.path).toLowerCase());
    if (depthOf(entry.path) <= groupingDepth || named) groupings.add(entry.path);
  }

  const proposed: Proposed[] = [];
  for (const entry of entries) {
    if (!groupings.has(parentOf(entry.path))) continue; // inside a product
    if (groupings.has(entry.path)) {
      proposed.push({
        path: entry.path,
        isFolder: true,
        contains: (childrenOf.get(entry.path) ?? []).map((inside) => inside.path),
      });
    } else {
      proposed.push({ path: entry.path, isFolder: entry.kind === "folder", contains: [] });
    }
  }
  return proposed;
}

/**
 * Read the disk and decide what to propose.
 *
 * The whole tree, because a nested category can sit at any depth and the
 * walk cannot know where to stop. The walk is cheap next to reading inside
 * anything; the parts of a product are listed and then ignored.
 */
export async function planFrom(api: Api, groupingDepth = 1): Promise<Proposed[]> {
  return productsFrom(await api.fsWalk(null), groupingDepth);
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
