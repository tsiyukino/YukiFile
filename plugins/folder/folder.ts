/**
 * What a folder library decides, apart from what it draws.
 *
 * This plugin answers one question the core deliberately does not: **what
 * counts as an object here?** In a library of loose files the answer is "every
 * file, and every folder that holds them", which is the plainest reading of a
 * directory tree and wrong for plenty of libraries — a VRChat library wants
 * the product folder and not its forty contents.
 *
 * Being replaceable is the point. A library with a different answer installs a
 * different plugin, and nothing in the core has to change, because the core
 * never held an opinion to change.
 */

import type { Api, Entry } from "../../src/plugin-host/commands.js";

/** One object a scan proposes. */
export interface Proposed {
  readonly paths: readonly string[];
  /** Which of `paths` are folders. The core cannot look and find out. */
  readonly folders: readonly string[];
  readonly key: string;
  readonly values: Readonly<Record<string, string>>;
}

/**
 * Which entries become objects.
 *
 * Every file and every folder, each on its own. The folders matter: a person
 * who put forty textures in `Clothing/AW KLASSIK MAID` named that folder for a
 * reason, and it is the thing they would open.
 *
 * Nothing here decides that a folder and the zip beside it are one product.
 * `seed/vrc-lessons.md` records what guessing that costs, and a plugin with
 * evidence — a manifest, a shop page — is the thing that should say so.
 */
export function objectsFrom(entries: readonly Entry[]): Proposed[] {
  return entries.map((entry) => ({
    paths: [entry.path],
    // The walk saw what it is; the document has to carry that, because an
    // import may name a path that is not on disk and the core cannot look.
    folders: entry.kind === "folder" ? [entry.path] : [],
    // The path is the stable identity across runs. Without it a second walk
    // proposes everything again and the import creates a duplicate library.
    key: entry.path,
    values: {},
  }));
}

/** What a walk turned into, before anything is written. */
export interface Plan {
  readonly proposed: readonly Proposed[];
  /** Entries the plugin left alone, with why. */
  readonly skipped: readonly string[];
}

/**
 * Read the disk and decide what to propose.
 *
 * Split from submitting so the deciding can be tested without a library: what
 * is worth checking is which entries become objects, not whether an import
 * ran.
 */
export async function planFrom(api: Api, under: string | null): Promise<Plan> {
  const entries = await api.fsWalk(under);
  return { proposed: objectsFrom(entries), skipped: [] };
}

/** The import document a plan becomes. */
export function documentFor(plan: Plan): string {
  return JSON.stringify({
    version: 1,
    source: "folder scan",
    objects: plan.proposed.map((object) => ({
      paths: object.paths,
      folders: object.folders,
      id: object.key,
      values: object.values,
    })),
  });
}
