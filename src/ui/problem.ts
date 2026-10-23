/**
 * A thrown value in words.
 *
 * The bridge refuses with a tagged object — `{ kind, detail }` — and
 * everything else throws whatever it throws. Both end up on a screen, and a
 * screen cannot show an object.
 *
 * Kept apart from the shell because the add flow and the forget button say
 * what went wrong too, and importing the shell for one function would make
 * the shell depend on the screens it draws.
 */

/** The shape the bridge's refusals arrive in. */
interface Refusal {
  readonly kind: string;
  readonly detail?: unknown;
}

function isRefusal(error: unknown): error is Refusal {
  return typeof error === "object" && error !== null && "kind" in error;
}

/** A thrown value in words, whatever shape it arrived in. */
export function describe(error: unknown): string {
  if (isRefusal(error)) {
    switch (error.kind) {
      // The two refusals a person adding an object can act on, said so they
      // can. "the core refused: path_taken" is true and tells them nothing.
      case "path_taken":
        return `another object already sits at ${String(error.detail)}`;
      case "not_found":
        return `nothing is at ${String(error.detail)} any more`;
      case "already_applied":
        return "this set was already applied; its entries are the record of what was decided";
      case "stale":
        return staleInWords(error.detail);
      default:
        return `the core refused: ${error.kind}`;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/** What a stale refusal carries. */
export interface Stale {
  readonly object: string;
  readonly field: string;
  readonly expected: string | null;
  readonly found: string | null;
}

/** The detail of a `stale` refusal, if it is one. */
export function staleDetail(error: unknown): Stale | undefined {
  if (!isRefusal(error) || error.kind !== "stale") return undefined;
  const detail = error.detail;
  if (typeof detail !== "object" || detail === null) return undefined;
  if (!("field" in detail) || !("object" in detail)) return undefined;
  return detail as Stale;
}

/**
 * A field that moved, in words.
 *
 * Says what the proposal was built against and what is there now, because the
 * person reading it has to decide which of the two to keep, and cannot from
 * "something changed".
 */
function staleInWords(detail: unknown): string {
  const stale = staleDetail({ kind: "stale", detail });
  if (!stale) return "a field changed since this set was proposed";
  const was = stale.expected === null ? "empty" : `"${stale.expected}"`;
  const now = stale.found === null ? "empty" : `"${stale.found}"`;
  return `${stale.field} changed since this was proposed: it was ${was} and is now ${now}`;
}
