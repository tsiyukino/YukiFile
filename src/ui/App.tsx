/**
 * The application shell.
 *
 * Gathers what the object page needs and cannot fetch for itself — the plugin
 * manifests, their loaded modules, the library's mount order — then draws a
 * page for whichever object is selected.
 *
 * All of it is fetched once. The page is a function of those four things, and
 * re-fetching per render would make it a function of the network instead.
 *
 * # There is no grid yet
 *
 * Browsing is a later layer. This lists object ids and shows the first one,
 * which is enough to prove the chain end to end: a manifest on disk, through
 * discovery and the registry, through slot arbitration and the loader, to a
 * plugin's panel drawn inside its property's region.
 */

import { Heading, Spinner, Stack, Text } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import { useEffect, useState } from "react";

import { apiFor, type Api, type FlatObject } from "../plugin-host/commands.js";
import { loadAll, type Loaded } from "../plugin-host/loader.js";
import type { Mount } from "../plugin-host/slots.js";
import type { Manifest } from "../plugin-host/types.js";
import { invoke } from "./invoke.js";
import { ObjectPage } from "./ObjectPage.js";

/** The API every panel is handed, wired to the real Tauri bridge. */
export const api: Api = apiFor(invoke);

/** What the shell gathers before a page can draw. */
export interface Context {
  readonly plugins: readonly Manifest[];
  readonly loaded: readonly Loaded[];
  readonly mounts: readonly Mount[];
  /** The object on screen, or `undefined` when the library holds none. */
  readonly object: FlatObject | undefined;
  readonly total: number;
}

export function App(): React.JSX.Element {
  const [context, setContext] = useState<Context | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  useEffect(() => {
    let current = true;

    gather(api)
      .then((next) => {
        if (current) setContext(next);
      })
      .catch((error: unknown) => {
        if (current) setProblem(describe(error));
      });

    return () => {
      current = false;
    };
  }, []);

  if (problem) {
    return (
      <Stack padding="normal" gap="condensed">
        <Heading>Yukifile</Heading>
        <InlineMessage variant="critical">{problem}</InlineMessage>
      </Stack>
    );
  }

  if (!context) {
    return <Spinner aria-label="Opening the library" />;
  }

  if (!context.object) {
    return (
      <Stack padding="normal" gap="condensed">
        <Heading>Yukifile</Heading>
        <Text>This library holds no objects yet. A scan will find them.</Text>
      </Stack>
    );
  }

  return (
    <ObjectPage
      api={api}
      object={context.object}
      plugins={context.plugins}
      loaded={context.loaded}
      mounts={context.mounts}
    />
  );
}

/**
 * Everything the page needs, fetched once.
 *
 * Exported so it can be tested against a fake api: what is worth checking here
 * is that a plugin whose module will not load does not stop the rest, and that
 * is a property of this function rather than of any component.
 */
export async function gather(api: Api): Promise<Context> {
  const plugins = await api.pluginList();

  // `loadAll` takes a resolver rather than calling import() itself, so this is
  // the call site that decides how a specifier becomes a module. A plugin
  // module that will not load is reported in `failures` and the rest proceed;
  // the object page names the missing one.
  const loaded = await loadAll(plugins, (specifier) =>
    import(/* @vite-ignore */ specifier),
  );

  const mounts = await api.mountOrder();
  const page = await api.objectIds(null, 1);
  const first = page.ids[0];

  return {
    plugins,
    loaded,
    mounts,
    object: first === undefined ? undefined : await api.objectFlat(first),
    total: page.total,
  };
}

/** A thrown value in words, whatever shape it arrived in. */
export function describe(error: unknown): string {
  if (typeof error === "object" && error !== null && "kind" in error) {
    return `the core refused: ${String((error as { kind: unknown }).kind)}`;
  }
  return error instanceof Error ? error.message : String(error);
}
