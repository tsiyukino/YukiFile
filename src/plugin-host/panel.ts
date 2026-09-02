/**
 * What a panel module has to be.
 *
 * A manifest names a panel as a module specifier; `loader.ts` fetches it. This
 * is the contract for what comes back: a default export that renders, given
 * the object it is drawing and the property instance it was scoped to.
 *
 * # Everything a panel needs is passed in
 *
 * A panel receives its `api` rather than importing one. That is the same
 * injection the loader and the command API use, and it has the same payoff
 * here: a panel is testable by rendering it with a fake api, and a panel that
 * reached for a module-level singleton would only work inside a running app.
 *
 * It also means a panel cannot widen its own reach. The `api` it is handed is
 * built from the allowlist, so what a panel can ask for is what the allowlist
 * says, with nothing to opt into.
 *
 * # A plugin is external code
 *
 * {@link panelComponent} checks what came back rather than trusting it. A
 * module whose default export is a number is not a bug in the host, and
 * treating it as one — letting React throw mid-render — takes down the object
 * page over one bad plugin. It is refused the same way a module that failed to
 * fetch is: reported, and the rest of the page draws.
 */

import type { ComponentType } from "react";

import type { Api } from "./commands.js";

/** What every panel is given. */
export interface PanelProps {
  /** The commands this plugin may call. Built from the allowlist. */
  readonly api: Api;
  /** The object being drawn. */
  readonly objectId: number;
  /** The property this panel was scoped to: `booth`. */
  readonly property: string;
  /**
   * Which instance of that property.
   *
   * An object carrying `booth#1` and `booth#2` gets two panels, and each has
   * to know which listing it is showing.
   */
  readonly instance: number;
}

/** A panel, once it has loaded. */
export type Panel = ComponentType<PanelProps>;

/**
 * The component in a loaded module, if there is one.
 *
 * Returns `undefined` rather than throwing. A plugin shipping something that
 * is not a component is a fact to report, not a reason to stop drawing the
 * page — the same stance `loader.ts` takes on a module that would not fetch.
 */
export function panelComponent(module: unknown): Panel | undefined {
  if (typeof module !== "object" || module === null) return undefined;

  const exported = (module as { default?: unknown }).default;

  // A function covers plain components; an object covers memo, forwardRef and
  // lazy, which are objects carrying a React type tag rather than functions.
  // Checking for the tag rather than listing the wrappers means a future one
  // works without an edit here.
  if (typeof exported === "function") return exported as Panel;
  if (typeof exported === "object" && exported !== null && "$$typeof" in exported) {
    return exported as Panel;
  }
  return undefined;
}
