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

import { Button, Heading, Spinner, Stack, Text } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import { useEffect, useState } from "react";

import {
  apiFor,
  appApiFor,
  type AppApi,
  type Api,
  type FlatObject,
} from "../plugin-host/commands.js";
import { loadAll, type Loaded } from "../plugin-host/loader.js";
import type { Mount } from "../plugin-host/slots.js";
import type { Manifest } from "../plugin-host/types.js";
import { invoke } from "./invoke.js";
import { ObjectPage } from "./ObjectPage.js";

/** The API every panel is handed, wired to the real Tauri bridge. */
export const api: Api = apiFor(invoke);

/**
 * What the application itself may ask for.
 *
 * Held apart from `api` because a scan writes directly, and a plugin that
 * could do that is what change sets exist to prevent. Panels never see this.
 */
export const appApi: AppApi = appApiFor(invoke);

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
        <Text>This library holds no objects yet.</Text>
        <ScanButton onDone={() => setContext(undefined)} />
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
 * Look at the disk.
 *
 * `docs.yml` says network access happens when the user presses a button; this
 * is the same rule applied to the filesystem. A scan is not on a timer and not
 * something a plugin can trigger.
 *
 * `onDone` clears the gathered context, which makes the shell fetch again.
 * Refetching rather than merging is the honest thing after a scan: it may have
 * created objects, moved paths and removed others, and reconstructing that
 * here would be a second implementation of what the scan already decided.
 */
export function ScanButton({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | undefined>(undefined);

  const scan = (): void => {
    setRunning(true);
    setResult(undefined);

    appApi
      .libraryScan()
      .then((scanned) => {
        setResult(
          `found ${scanned.added} ${scanned.added === 1 ? "path" : "paths"}` +
            (scanned.removed > 0 ? `, ${scanned.removed} gone` : "") +
            (scanned.moved > 0 ? `, ${scanned.moved} moved` : ""),
        );
        onDone();
      })
      .catch((error: unknown) => setResult(describe(error)))
      .finally(() => setRunning(false));
  };

  return (
    <Stack direction="horizontal" gap="condensed" align="center">
      <Button onClick={scan} disabled={running}>
        {running ? "Scanning…" : "Scan this folder"}
      </Button>
      {result && <Text size="small">{result}</Text>}
    </Stack>
  );
}

/**
 * Every module the built-in plugins can contribute.
 *
 * A glob rather than a bare `import(specifier)`: the specifier is data from a
 * manifest, and a bundler cannot follow a string it does not see at build
 * time. Vite turns this into a map of loaders it can, which is also what makes
 * a production build include the plugins at all.
 *
 * Third-party plugins loaded from disk at runtime will need a different path —
 * they are not in the bundle by definition. That is a later problem, and the
 * injected resolver is what keeps it from being this file's problem twice.
 */
const BUILT_IN = import.meta.glob("../../plugins/*/*.{ts,tsx}");

/**
 * Resolve a manifest's specifier against the plugin's own directory.
 *
 * `./panel` in `plugins/archive/manifest.json` means `plugins/archive/panel`.
 * Importing `"./panel"` from here would ask for `src/ui/panel`, which is the
 * 404 this exists to avoid — a failure that reads as a missing plugin rather
 * than a wrong base path.
 */
export async function resolvePluginModule(
  plugins: readonly Manifest[],
  id: string,
  specifier: string,
): Promise<unknown> {
  const directory = plugins.find((plugin) => plugin.id === id)?.directory;
  if (!directory) {
    throw new Error(`${id} did not say which directory it came from`);
  }

  const base = `../../plugins/${directory}/${specifier.replace(/^\.\//, "")}`;

  // The extension is the resolver's business, which is why the manifest does
  // not name one. Trying both is what makes that true here.
  for (const candidate of [`${base}.tsx`, `${base}.ts`]) {
    const load = BUILT_IN[candidate];
    if (load) return load();
  }

  throw new Error(`${specifier} is not a module in plugins/${directory}`);
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
  const loaded = await loadAll(plugins, (specifier, id) =>
    resolvePluginModule(plugins, id, specifier),
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
