/**
 * What the PDF plugin decides, apart from what it draws.
 *
 * Same split as the archive plugin: the deciding is pure and testable without
 * a DOM, and the components turn its answers into elements. The interesting
 * questions here — which page to show, what to do when a file will not open —
 * are answerable without rendering anything.
 */

import type { Api, FlatObject } from "../../src/plugin-host/commands.js";

/** Where the PDF is, if the object has one. */
export function pdfLocation(object: FlatObject): string | undefined {
  return object.locations.find((location) => location.path.toLowerCase().endsWith(".pdf"))
    ?.path;
}

/** Which page to show, kept inside the document. */
export function clampPage(wanted: number, pages: number): number {
  if (pages < 1) return 1;
  return Math.min(Math.max(1, Math.trunc(wanted)), pages);
}

/** Why a PDF could not be shown. */
export interface Problem {
  readonly problem: string;
}

/** The URL to render, or the reason there is none. */
export type Source = { readonly url: string } | Problem;

export function isProblem(source: Source): source is Problem {
  return "problem" in source;
}

/**
 * Ask the core for a URL this document can be rendered from.
 *
 * A URL, not the bytes. The plugin hands it to pdf.js and the data goes from
 * disk into a canvas without passing through this code, which is what lets a
 * plugin render a file it is not trusted to read.
 */
export async function sourceFor(api: Api, object: FlatObject): Promise<Source> {
  const path = pdfLocation(object);
  if (!path) return { problem: "This object has no PDF on disk." };

  try {
    return { url: await api.fileUrl(path) };
  } catch (thrown) {
    return { problem: describe(thrown) };
  }
}

/** What went wrong, in words. */
export function describe(thrown: unknown): string {
  const kind =
    typeof thrown === "object" && thrown !== null && "kind" in thrown
      ? String((thrown as { kind: unknown }).kind)
      : "";

  switch (kind) {
    case "not_found":
      return "This PDF is no longer where the library expects it.";
    case "outside_library":
      return "This path is outside the library.";
    case "unreadable":
      return "This PDF could not be opened.";
    default:
      return thrown instanceof Error ? thrown.message : String(thrown);
  }
}
