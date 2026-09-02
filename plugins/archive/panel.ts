/**
 * What an archive holds, without unpacking it.
 *
 * The first consumer of the extension points, and built with no privileges the
 * core would not give a third party: it declares `archive`, registers `zip` as
 * bringing that property, and contributes a panel and two columns keyed to it.
 * If any of that needed a special case in the core, the extension point would
 * be wrong.
 *
 * # This computes a view, it does not render one
 *
 * {@link summarise} returns what should be on screen; nothing here imports a
 * UI framework. v1 has not chosen how panels render, and a panel that reached
 * for React today would have to be rewritten when that is decided — while one
 * that returns data stays correct either way.
 *
 * It also means the interesting behaviour is testable without a DOM. What is
 * worth testing here is which of 4000 entries to show and how to describe an
 * archive that escapes its own root, not whether a list element appeared.
 */

import type { Api, ArchiveMember } from "../../src/plugin-host/commands.js";

/** How many entries a panel lists before summarising the rest. */
const SHOWN = 50;

/** One row in the listing. */
export interface Row {
  readonly path: string;
  /** Uncompressed size. Zero for a directory entry. */
  readonly size: number;
  readonly isDir: boolean;
  /** The stored name escapes the archive root. */
  readonly escapes: boolean;
}

/** What the panel shows for one archive. */
export interface View {
  readonly rows: readonly Row[];
  /** Entries beyond the ones listed. Zero when everything is shown. */
  readonly hidden: number;
  readonly files: number;
  readonly folders: number;
  /** Total uncompressed size of every file. */
  readonly unpacked: number;
  /**
   * Entries whose stored name escapes the archive root.
   *
   * Nothing is extracted, so these cannot overwrite anything today. They are
   * surfaced because the name still reaches a screen, and an archive carrying
   * `../../autoexec.bat` is worth knowing about before anyone adds an extract
   * button.
   */
  readonly escaping: readonly string[];
}

/** Why a panel has nothing to show. */
export interface Problem {
  readonly problem: string;
}

/** What the panel renders: a view, or the reason there is none. */
export type PanelState = View | Problem;

/** Whether the panel has a listing or a problem. */
export function isProblem(state: PanelState): state is Problem {
  return "problem" in state;
}

/**
 * Turn a listing into what the panel shows.
 *
 * Pure, so the interesting decisions -- what to truncate, what counts as a
 * folder, what to warn about -- are testable without a command or a screen.
 */
export function summarise(members: readonly ArchiveMember[]): View {
  const rows: Row[] = members.slice(0, SHOWN).map((member) => ({
    path: member.path,
    size: member.size,
    isDir: member.is_dir,
    escapes: member.escapes_root,
  }));

  let files = 0;
  let folders = 0;
  let unpacked = 0;
  const escaping: string[] = [];

  // Counted over every member, not over the truncated rows: an archive of 4000
  // entries has a real file count, and reporting 50 because that is what fits
  // on screen would be a number that quietly means something else.
  for (const member of members) {
    if (member.is_dir) {
      folders += 1;
    } else {
      files += 1;
      unpacked += member.size;
    }
    if (member.escapes_root) {
      escaping.push(member.path);
    }
  }

  return {
    rows,
    hidden: Math.max(0, members.length - rows.length),
    files,
    folders,
    unpacked,
    escaping,
  };
}

/**
 * Read one archive and summarise it.
 *
 * The path is relative to the library root, and the core refuses anything that
 * resolves outside it. A refusal is shown as a problem rather than thrown: a
 * panel that throws takes the object page with it, and an unreadable archive is
 * a fact about that object, not a failure of the page.
 */
export async function open(api: Api, path: string): Promise<PanelState> {
  try {
    return summarise(await api.archiveList(path));
  } catch (thrown) {
    return { problem: describe(thrown) };
  }
}

/**
 * What went wrong, in words.
 *
 * The core sends a tagged error (`bridge::error::BridgeError`). Switching on
 * the tag gives a sentence worth reading; falling back to the raw value keeps
 * an unrecognised shape from rendering as `[object Object]`.
 */
function describe(thrown: unknown): string {
  const kind =
    typeof thrown === "object" && thrown !== null && "kind" in thrown
      ? String((thrown as { kind: unknown }).kind)
      : "";

  switch (kind) {
    case "not_found":
      return "This archive is no longer where the library expects it.";
    case "not_an_archive":
      // The seed library has one RAR that cannot be opened at all. That is a
      // fact to record about the object, not an error to hide.
      return "This file cannot be read as an archive.";
    case "unreadable":
      return "This archive could not be opened.";
    case "outside_library":
      return "This path is outside the library.";
    default:
      return thrown instanceof Error ? thrown.message : String(thrown);
  }
}
