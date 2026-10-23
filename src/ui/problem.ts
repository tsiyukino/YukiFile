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
      default:
        return `the core refused: ${error.kind}`;
    }
  }
  return error instanceof Error ? error.message : String(error);
}
