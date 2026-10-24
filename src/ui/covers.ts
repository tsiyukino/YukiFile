/**
 * Where an object's cover could come from.
 *
 * Pure. Given what the object's locations hold -- the images in a folder,
 * the images in a zip, the assets with previews in a package -- this lists
 * the choices a person can pick from. The component fetches those listings
 * and draws the choices; which listing to ask for is decided here too.
 *
 * VRCAL's order of preference is the one worth copying: a cover a person
 * set, then one from the shop, then one found locally. This module is the
 * third of those. The first is the bare `cover` field; the second arrives
 * once the core can fetch.
 */

import type {
  ArchiveMember,
  CoverSource,
  Entry,
  Location,
  UnityAsset,
} from "../plugin-host/commands.js";

/** Extensions the core can decode into a cover. */
const IMAGES: readonly string[] = ["png", "jpg", "jpeg", "webp"];

/** Whether a name is an image the core can store. */
export function isImage(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot !== -1 && IMAGES.includes(name.slice(dot + 1).toLowerCase());
}

/** Whether a name is a Unity package. */
export function isPackage(name: string): boolean {
  return name.toLowerCase().endsWith(".unitypackage");
}

/** Whether a name is a zip the core can list. */
export function isZip(name: string): boolean {
  return name.toLowerCase().endsWith(".zip");
}

/** One thing a person can pick as the cover. */
export interface Choice {
  /** What to show for it: the file name, or the asset's path. */
  readonly label: string;
  readonly source: CoverSource;
}

/**
 * The images directly inside a folder location.
 *
 * One level: a product folder's promo image sits at its top, and walking
 * into `Assets/` for every texture would offer four hundred choices of
 * nothing.
 */
export function fromFolder(location: Location, walked: readonly Entry[]): Choice[] {
  return walked
    .filter((entry) => entry.kind === "file" && isImage(entry.path))
    .map((entry) => ({
      label: entry.path,
      source: { from: "file", path: `${location.path}/${entry.path}` },
    }));
}

/** The images inside a zip location. */
export function fromZip(location: Location, members: readonly ArchiveMember[]): Choice[] {
  return members
    .filter((member) => !member.is_dir && !member.escapes_root && isImage(member.path))
    .map((member) => ({
      label: member.path,
      source: { from: "member", path: location.path, member: member.path },
    }));
}

/**
 * The assets with previews in a package, on disk or inside a zip.
 *
 * Every asset with a preview, not just images: Unity draws a preview for a
 * prefab or a material too, and a prefab's preview is often the one picture
 * of the product as worn.
 */
export function fromPackage(
  location: Location,
  assets: readonly UnityAsset[],
  member?: string,
): Choice[] {
  return assets
    .filter((asset) => asset.has_preview)
    .map((asset) => ({
      label: `${member ? `${member}: ` : ""}${asset.path}`,
      source:
        member === undefined
          ? { from: "preview", path: location.path, guid: asset.guid }
          : { from: "preview", path: location.path, member, guid: asset.guid },
    }));
}

/** The packages a zip holds, worth listing for their previews. */
export function packagesIn(members: readonly ArchiveMember[]): string[] {
  return members.filter((member) => !member.is_dir && isPackage(member.path)).map((member) => member.path);
}
