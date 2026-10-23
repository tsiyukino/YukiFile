/**
 * What a Unity package holds, as a panel shows it.
 *
 * The consumer the core's reader was waiting for. `summarise` is pure: given
 * the asset list, which rows to show, how to count, and which top-level
 * folders the package puts things under. That last one is the whole reason
 * the seed library could be organised offline -- `Assets/[meron-farm]/...`
 * names the vendor -- and it is reported as folders, not as "the vendor",
 * because deciding that is the VRChat plugin's judgement, not this one's.
 */

import type { Api, UnityAsset } from "../../src/plugin-host/commands.js";

/** How many assets a panel lists before summarising the rest. */
const SHOWN = 40;

export interface Row {
  readonly path: string;
  /** Absent for a folder asset. */
  readonly size: number | null;
}

export interface View {
  readonly rows: readonly Row[];
  readonly hidden: number;
  readonly files: number;
  readonly folders: number;
  /** Bytes across every file asset. */
  readonly unpacked: number;
  /**
   * The folders directly under `Assets/`, each once, in order of first
   * appearance. Where a vendor's name usually sits.
   */
  readonly top: readonly string[];
  readonly previews: number;
}

export interface Problem {
  readonly problem: string;
}

export type PanelState = View | Problem;

export function isProblem(state: PanelState): state is Problem {
  return "problem" in state;
}

/** Turn an asset list into what the panel shows. */
export function summarise(assets: readonly UnityAsset[]): View {
  let files = 0;
  let folders = 0;
  let unpacked = 0;
  let previews = 0;
  const top: string[] = [];

  for (const asset of assets) {
    if (asset.size === null) {
      folders += 1;
    } else {
      files += 1;
      unpacked += asset.size;
    }
    if (asset.has_preview) previews += 1;

    const segments = asset.path.split("/");
    // `Assets/<here>/...`. A package rooted elsewhere, or a file directly
    // under Assets, has nothing to say here.
    if (segments.length > 2 && segments[0] === "Assets") {
      const second = segments[1] ?? "";
      if (!top.includes(second)) top.push(second);
    }
  }

  return {
    rows: assets.slice(0, SHOWN).map((asset) => ({ path: asset.path, size: asset.size })),
    hidden: Math.max(0, assets.length - SHOWN),
    files,
    folders,
    unpacked,
    top,
    previews,
  };
}

/** Read one package and summarise it, or say why not. */
export async function open(api: Api, path: string): Promise<PanelState> {
  try {
    return summarise(await api.unitypackageList(path));
  } catch (thrown) {
    return { problem: describe(thrown) };
  }
}

function describe(thrown: unknown): string {
  const kind =
    typeof thrown === "object" && thrown !== null && "kind" in thrown
      ? String((thrown as { kind: unknown }).kind)
      : undefined;
  switch (kind) {
    case "not_an_archive":
      return "This file is not a readable Unity package.";
    case "not_found":
      return "The file is not where the library recorded it.";
    case "unreadable":
      return "The file could not be read.";
    case "outside_library":
      return "The path points outside the library.";
    default:
      return thrown instanceof Error ? thrown.message : String(thrown);
  }
}
