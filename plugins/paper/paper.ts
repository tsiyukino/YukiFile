/**
 * What a paper is, apart from what draws it.
 *
 * The first semantic property anything ships. `architecture.md` splits
 * properties in two: factual ones are attached because they are observably
 * true, and semantic ones are attached by a person because the software cannot
 * tell a research dataset from a VRChat outfit by looking at extensions.
 *
 * `pdf` is factual and this is not. A `.pdf` is a pdf; whether it is a paper is
 * a judgement, and this plugin exists so somebody can make it.
 *
 * # Building on a factual property
 *
 * `requires: ["pdf"]` is the layering the architecture describes: a paper can
 * offer DOI lookup because `pdf` already provides text extraction. It is also
 * the ticket into `pdf`'s region, since requiring a property is what permits
 * contributing to it.
 */

/** A DOI, as somebody might paste it. */
export type Doi = string;

/**
 * A DOI reduced to the form it is stored in.
 *
 * People paste DOIs as bare ids, as `doi:` prefixed strings, and as resolver
 * URLs. All three name one document, and storing them as typed would make two
 * copies of one paper look like two papers to anything comparing the field.
 *
 * The prefix is lowercased and the suffix is not: the registrant code is
 * case-insensitive by the DOI handbook, while the suffix is not guaranteed to
 * be. Lowercasing the whole thing would silently change what some publishers
 * issue.
 */
export function normaliseDoi(typed: string): Doi | undefined {
  const trimmed = typed.trim();
  if (trimmed === "") return undefined;

  const withoutPrefix = trimmed
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");

  // `10.` then a registrant, a slash, and a suffix that is not empty. Anything
  // else is not a DOI, and storing it would put a value in a field that claims
  // to hold one.
  const match = /^(10\.\d{4,9})\/(\S+)$/.exec(withoutPrefix);
  if (!match) return undefined;

  return `${match[1]?.toLowerCase()}/${match[2]}`;
}

/**
 * A title guessed from a filename, for the form to start with.
 *
 * A guess offered as a default, never written on its own. The seed library's
 * lesson is that a confident wrong answer costs more than a blank, so this only
 * does what is safe: drop the extension, turn separators into spaces, and stop.
 * It does not try to find an author or a year.
 */
export function titleFrom(path: string): string {
  const name = path.split("/").pop() ?? "";
  const withoutExtension = name.replace(/\.[^.]+$/, "");

  return withoutExtension.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The fields a paper form hands back. */
export interface PaperFields {
  readonly doi?: string;
  readonly title?: string;
}

/**
 * What to write, given what was typed.
 *
 * Empty fields are left out rather than written blank: a blank is the absence
 * of a value, and `values::set` drops it anyway, so including it would only
 * make the document say something it does not mean.
 *
 * A DOI that does not parse is a refusal rather than a silent drop. Somebody
 * who typed one and got an object without it would have no idea why.
 */
export function fieldsFrom(typed: {
  doi: string;
  title: string;
}): { ok: true; values: PaperFields } | { ok: false; problem: string } {
  const values: { doi?: string; title?: string } = {};

  if (typed.doi.trim() !== "") {
    const doi = normaliseDoi(typed.doi);
    if (doi === undefined) {
      return { ok: false, problem: `${typed.doi.trim()} is not a DOI` };
    }
    values.doi = doi;
  }

  if (typed.title.trim() !== "") {
    values.title = typed.title.trim();
  }

  return { ok: true, values };
}
