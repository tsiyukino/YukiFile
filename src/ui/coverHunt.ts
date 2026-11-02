/**
 * Covers for every object that has none, found without a person.
 *
 * The same places the cover picker looks -- pictures in a folder, pictures
 * in an archive, previews in a Unity package -- ranked by `bestCover`, for
 * the whole library in one press. A product nobody has opened yet is the one
 * a person cannot recognise, and opening four hundred of them one at a time
 * to pick a picture is the job this exists to save.
 *
 * Nothing a person chose is replaced: an object with any cover, its own or a
 * shop's, is skipped. Groupings are skipped too; their cards borrow from
 * what they hold. One object at a time, because the work is reading disks,
 * and a stop is honoured between objects.
 */

import type { Api, AppApi, Location, ObjectId } from "../plugin-host/commands.js";
import { bestCover, fromFolder, fromPackage, fromZip, isPackage, isZip, packagesIn, type Candidate } from "./covers.js";

export interface CoverHunt {
  /** Read Unity packages for previews. Slow: a package is read through. */
  readonly packages: boolean;
  /** Checked between objects. */
  readonly stopped: () => boolean;
  readonly onProgress: (progress: Progress) => void;
}

export interface Progress {
  readonly done: number;
  readonly total: number;
  readonly found: number;
  /** The object being looked at now. */
  readonly current?: string | undefined;
}

export interface Hunted {
  readonly looked: number;
  readonly found: number;
  /** Objects whose locations could not be read, by name. */
  readonly unreadable: readonly string[];
  readonly stopped: boolean;
}

/** Every picture an object's locations hold, as the picker would list them. */
export async function candidatesFor(api: Api, locations: readonly Location[], packages: boolean): Promise<Candidate[]> {
  const found: Candidate[] = [];
  for (const location of locations) {
    if (location.kind === "folder") {
      // Two levels: a promo image sits at the top or in an `Images/` beside
      // the package, rarely deeper, and deeper is textures.
      found.push(...fromFolder(location, await api.fsWalk(location.path, 2)));
    } else if (isZip(location.path)) {
      const members = await api.archiveList(location.path);
      found.push(...fromZip(location, members));
      if (packages) {
        for (const member of packagesIn(members)) {
          found.push(...fromPackage(location, await api.unitypackageList(location.path, member), member));
        }
      }
    } else if (packages && isPackage(location.path)) {
      found.push(...fromPackage(location, await api.unitypackageList(location.path)));
    }
  }
  return found;
}

/** The objects worth looking at: on disk, and with no cover from anyone. */
async function coverless(api: Api): Promise<{ id: ObjectId; name: string }[]> {
  const wanted: { id: ObjectId; name: string }[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await api.objectQuery({}, "name", offset, 500);
    if (page.ids.length === 0) break;
    const rows = await api.objectSummaries(page.ids);
    for (const row of rows) {
      if (!row.cover && row.path !== null) wanted.push({ id: row.id, name: row.name ?? row.path });
    }
    if (offset + page.ids.length >= page.total) break;
  }
  return wanted;
}

export async function findCovers(api: Api, app: AppApi, hunt: CoverHunt): Promise<Hunted> {
  const wanted = await coverless(api);
  let found = 0;
  let done = 0;
  const unreadable: string[] = [];
  hunt.onProgress({ done, total: wanted.length, found });

  for (const object of wanted) {
    if (hunt.stopped()) return { looked: done, found, unreadable, stopped: true };
    hunt.onProgress({ done, total: wanted.length, found, current: object.name });
    try {
      const flat = await api.objectFlat(object.id);
      const best = bestCover(await candidatesFor(api, flat.locations, hunt.packages));
      if (best) {
        // As a find, not a choice: a shop's picture fetched later outranks it.
        await app.coverSet(object.id, best.source, true);
        found += 1;
      }
    } catch {
      // One unreadable archive is no reason to stop the other four hundred.
      unreadable.push(object.name);
    }
    done += 1;
  }

  hunt.onProgress({ done, total: wanted.length, found });
  return { looked: done, found, unreadable, stopped: false };
}
