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

import type { Api, ObjectId } from "./commands.js";

/** What every panel is given. */
export interface PanelProps {
  /** The commands this plugin may call. Built from the allowlist. */
  readonly api: Api;
  /** The object being drawn. */
  readonly objectId: ObjectId;
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

/**
 * What a form is given when a new object is being made.
 *
 * No object id: there is no object yet, which is what makes this the one slot
 * that draws before its subject exists. `paths` is what the person selected, so
 * a form can read a filename or peer into an archive to fill something in.
 */
export interface FormProps {
  /** The commands this plugin may call. Built from the allowlist. */
  readonly api: Api;
  /** The property this form was scoped to: `paper`. */
  readonly property: string;
  /** Where the new object will sit. Empty when it is a grouping. */
  readonly paths: readonly FormPath[];
  /** What this form returned last time, so going back does not lose typing. */
  readonly initial: Readonly<Record<string, string>>;
  /**
   * Hand over what was filled in, or say why not.
   *
   * A `Result` rather than a plain callback because a form may do real work —
   * a DOI lookup is a network call — and a failure needs somewhere to go other
   * than a thrown error in the host's render.
   */
  readonly onDone: (result: FormResult) => void;
}

/** One place the new object will sit, as the picker selected it. */
export interface FormPath {
  readonly path: string;
  readonly kind: "file" | "folder";
}

/** What a form hands back. */
export type FormResult =
  | { readonly ok: true; readonly values: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly problem: string };

/** A form, once it has loaded. */
export type Form = ComponentType<FormProps>;

/**
 * The form in a loaded module, if there is one.
 *
 * Same check as {@link panelComponent} and for the same reason, but kept a
 * separate function so the two can diverge without one silently accepting the
 * other's shape: a panel takes an object id and a form cannot have one.
 */
export function formComponent(module: unknown): Form | undefined {
  return panelComponent(module) as Form | undefined;
}

/** What a library action is given. */
export interface LibraryActionProps {
  /** The commands this plugin may call. Built from the allowlist. */
  readonly api: Api;
  /** Which of the plugin's library actions was chosen. */
  readonly action: string;
}

/** What a library action reports when it finishes. */
export interface ActionResult {
  /** One line for a person. */
  readonly summary: string;
  /** True when the library changed and callers should re-read it. */
  readonly changed: boolean;
}

/** A library action, once it has loaded. */
export type LibraryAction = (props: LibraryActionProps) => Promise<ActionResult>;

/**
 * The library action in a loaded module, if there is one.
 *
 * A function rather than a component: a scan has no UI of its own, it does
 * work and reports. Checked rather than trusted, for the same reason
 * {@link panelComponent} checks — a module whose default export is a number
 * is a plugin's mistake, not a reason to stop.
 */
export function libraryAction(module: unknown): LibraryAction | undefined {
  if (typeof module !== "object" || module === null) return undefined;

  const exported = (module as { runLibraryAction?: unknown }).runLibraryAction;
  return typeof exported === "function" ? (exported as LibraryAction) : undefined;
}
