/**
 * What a card says about an object, apart from drawing it.
 *
 * Pure. Which placeholder stands in for a missing cover, what to call a
 * thing, how a path reads under its name. The grid draws the answers.
 */

import type { Summary } from "../plugin-host/commands.js";

/** What stands in for a cover when there is none. */
export type Placeholder = "folder" | "package" | "archive" | "image" | "document" | "file" | "grouping";

const ARCHIVES: readonly string[] = ["zip", "rar", "7z"];
const IMAGES: readonly string[] = ["png", "jpg", "jpeg", "webp", "gif"];
const DOCUMENTS: readonly string[] = ["pdf", "txt", "md", "docx"];

/**
 * The placeholder for an object without a cover.
 *
 * By what the thing is on disk, which the summary already says: a folder, a
 * package, an archive, a picture, a document, any other file, or nothing at
 * all for a grouping. Judging by extension is allowed here for the same
 * reason the Disk pane may: it decides what icon to draw, not what the thing
 * means.
 */
export function placeholderFor(summary: Pick<Summary, "path" | "kind">): Placeholder {
  if (summary.path === null) return "grouping";
  if (summary.kind === "folder") return "folder";
  const name = summary.path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  const extension = dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
  if (extension === "unitypackage") return "package";
  if (ARCHIVES.includes(extension)) return "archive";
  if (IMAGES.includes(extension)) return "image";
  if (DOCUMENTS.includes(extension)) return "document";
  return "file";
}

/** What to call a card. */
export function titleOf(summary: Pick<Summary, "name">): string {
  return summary.name ?? "Untitled";
}

/**
 * The path under a card's name, or nothing when it would repeat the name.
 *
 * A product titled by its shop sits at `Clothing/Cross_Maid_Fullset`, and
 * the path is where a person finds it. One titled by its filename has the
 * filename for a name already, and the folder it sits in is what is left to
 * say.
 */
export function pathUnder(summary: Pick<Summary, "name" | "path">): string | undefined {
  if (summary.path === null) return undefined;
  if (summary.path === summary.name) return undefined;
  const slash = summary.path.lastIndexOf("/");
  const file = slash === -1 ? summary.path : summary.path.slice(slash + 1);
  if (file === summary.name) return slash === -1 ? undefined : summary.path.slice(0, slash);
  return summary.path;
}
