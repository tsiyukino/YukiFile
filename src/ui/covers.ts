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
export function fromFolder(location: Location, walked: readonly Entry[]): Candidate[] {
  return walked
    .filter((entry) => entry.kind === "file" && isImage(entry.path))
    .map((entry) => ({
      label: entry.path,
      size: entry.size,
      source: { from: "file", path: `${location.path}/${entry.path}` },
    }));
}

/** The images inside a zip location. */
export function fromZip(location: Location, members: readonly ArchiveMember[]): Candidate[] {
  return members
    .filter((member) => !member.is_dir && !member.escapes_root && isImage(member.path))
    .map((member) => ({
      label: member.path,
      size: member.size,
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
): Candidate[] {
  return assets
    .filter((asset) => asset.has_preview)
    .map((asset) => ({
      label: `${member ? `${member}: ` : ""}${asset.path}`,
      size: asset.size,
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

/** What a ranking knows about a choice besides its label. */
export interface Candidate extends Choice {
  /** Bytes, when the listing said. A larger picture is usually the promo. */
  readonly size?: number | null;
}

/** Names that say "this is the picture of the product". */
const COVER_WORDS = /(cover|thumb|thumbnail|main|top|preview|promo|banner|header|keyvisual|key_visual|サムネ|表紙|メイン|イメージ|image)/i;

/**
 * Names that say "this is part of the product, not a picture of it": maps a
 * shader reads, licences, readmes. A normal map is a fine image and a
 * terrible cover.
 */
const PART_WORDS = /(normal|_n\b|mask|matcap|emission|emiss|_ao\b|ambient|metallic|rough|smooth|height|_uv|uv_|alpha|texture|_tex|tex_|lut|noise|gradation|readme|licen[cs]e|規約|利用)/i;

/**
 * How cover-like a choice looks, by its name and where it sits. Higher wins.
 *
 * A picture beside the product beats one inside its package; a name that
 * says cover or thumbnail beats one that says nothing; a texture map loses
 * to almost anything. Among Unity previews a prefab's -- the product as
 * worn -- beats a material's, which beats a texture's.
 */
export function coverScore(candidate: Candidate): number {
  const name = candidate.label;
  let score = 0;
  if (candidate.source.from !== "preview") score += 20;
  if (COVER_WORDS.test(name)) score += 50;
  if (PART_WORDS.test(name)) score -= 45;

  // Shallower is likelier to be the promo image a shop zip puts at its top.
  const depth = (name.match(/\//g) ?? []).length;
  score -= Math.min(depth, 6) * 4;

  if (candidate.source.from === "preview") {
    const lower = name.toLowerCase();
    if (lower.endsWith(".prefab")) score += 15;
    else if (lower.endsWith(".mat")) score += 5;
    else score -= 10;
  }

  const size = candidate.size ?? 0;
  if (size > 0) score += Math.min(10, Math.max(0, Math.log2(size / 16_384)));
  return score;
}

/** Below this, a picture is more likely a texture than a picture of anything. */
export const ENOUGH = -15;

/** The most cover-like choice, or nothing when none looks like a cover. */
export function bestCover(candidates: readonly Candidate[]): Candidate | undefined {
  let best: Candidate | undefined;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = coverScore(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= ENOUGH ? best : undefined;
}
