/**
 * Turning module specifiers into modules.
 *
 * A manifest names its panels and viewers as specifiers — `./panels/Booth`.
 * Something has to fetch those at runtime. That is all this module does, and
 * it deliberately does not decide *what* to fetch: {@link modulesOf} reads the
 * specifiers out of a manifest, {@link load} resolves them.
 *
 * # Resolution is injected
 *
 * `load` takes a {@link Resolve} rather than calling `import()` itself.
 * Dynamic import ties the loader to a bundler and a filesystem, which would
 * mean testing it required mocking the module system — and a loader that can
 * only be exercised through its own machinery is one whose failure paths never
 * get exercised at all. Injecting the resolver keeps the I/O at the call site
 * and leaves this module a function of its arguments.
 *
 * # A broken module is not a broken library
 *
 * `plugin::registry` on the Rust side is all or nothing: a set of plugins with
 * an unsatisfied requirement does not load, because a partly loaded set is a
 * library where some objects have panels and others do not for reasons nobody
 * can see. This module is the opposite, and the asymmetry is the point.
 *
 * By the time anything gets here, the set has already been checked. What can
 * still go wrong is one module failing to fetch or parse — a bad specifier, a
 * syntax error in a third-party panel. Refusing to start over that would let
 * any plugin author take the whole application down with a typo. Instead the
 * broken contribution is left out and reported in {@link Loaded.failures}, so
 * the rest of the library keeps working and somebody can see what is missing.
 * A failure that is dropped silently is the one that gets shipped.
 */

import type { Manifest } from "./types.js";

/**
 * How a specifier becomes a module.
 *
 * Production passes `(specifier) => import(specifier)`. Tests pass a map. The
 * loader cannot tell the difference, which is the reason it takes one.
 */
export type Resolve = (specifier: string) => Promise<unknown>;

/** A module a manifest asked for, and where it was asked for. */
export interface Needed {
  /** `panel` or `viewer` — the slots whose value is a module. */
  readonly slot: "panel" | "viewer";
  /** The property whose region it renders in. */
  readonly property: string;
  readonly specifier: string;
}

/** One module that did not load. */
export interface Failure extends Needed {
  /** Whatever the resolver threw, unwrapped as far as a message. */
  readonly reason: string;
}

/** What came back for one plugin. */
export interface Loaded {
  readonly manifest: Manifest;
  /** Specifier to module, for everything that resolved. */
  readonly modules: ReadonlyMap<string, unknown>;
  /** Everything that did not, with the reason. Empty is the normal case. */
  readonly failures: readonly Failure[];
}

/**
 * Every module a manifest needs, deduplicated.
 *
 * One module serving two properties is a normal thing to write — a plugin with
 * one panel component keyed to both `booth` and `gumroad` — and fetching it
 * twice would run its top-level code twice.
 */
export function modulesOf(manifest: Manifest): Needed[] {
  const needed: Needed[] = [];
  const seen = new Set<string>();

  const collect = (
    slot: "panel" | "viewer",
    from: Readonly<Record<string, string>> | undefined,
  ): void => {
    for (const [property, specifier] of Object.entries(from ?? {})) {
      if (typeof specifier !== "string" || specifier === "") continue;
      if (seen.has(specifier)) continue;
      seen.add(specifier);
      needed.push({ slot, property, specifier });
    }
  };

  collect("panel", manifest.contributes?.panels);
  collect("viewer", manifest.contributes?.viewers);
  return needed;
}

/** What a thrown value says, without assuming it is an `Error`. */
function reasonFor(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.message;
  return String(thrown);
}

/**
 * Fetch one plugin's modules.
 *
 * Resolution runs concurrently: modules do not depend on each other — the
 * dependency graph is between plugins, and the registry settled that before
 * anything reached here — so serialising them would pay import latency once
 * per panel for no ordering anyone can observe.
 */
export async function load(manifest: Manifest, resolve: Resolve): Promise<Loaded> {
  const needed = modulesOf(manifest);

  const settled = await Promise.all(
    needed.map(async (entry) => {
      try {
        const module = await resolve(entry.specifier);
        // A resolver that returns nothing has failed without saying so. Left
        // unchecked this reaches a slot as an undefined component, and the
        // error surfaces at render time pointing at the wrong place.
        if (module === undefined || module === null) {
          return { entry, failure: "resolved to nothing" };
        }
        return { entry, module };
      } catch (thrown) {
        return { entry, failure: reasonFor(thrown) };
      }
    }),
  );

  const modules = new Map<string, unknown>();
  const failures: Failure[] = [];

  for (const result of settled) {
    if ("failure" in result) {
      failures.push({ ...result.entry, reason: result.failure });
    } else {
      modules.set(result.entry.specifier, result.module);
    }
  }

  return { manifest, modules, failures };
}

/**
 * Fetch every plugin's modules.
 *
 * Order matches the order given, which is the registry's load order. Nothing
 * here re-derives it: an order computed in two places is an order that
 * disagrees with itself eventually.
 */
export async function loadAll(
  manifests: readonly Manifest[],
  resolve: Resolve,
): Promise<Loaded[]> {
  return Promise.all(manifests.map((manifest) => load(manifest, resolve)));
}
