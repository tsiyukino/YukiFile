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

import { Button, Heading, PageLayout, Spinner, Stack, Text } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import { useEffect, useState } from "react";

import {
  apiFor,
  type Api,
  type FlatObject,
  type ObjectId,
} from "../plugin-host/commands.js";
import { loadAll, type Loaded } from "../plugin-host/loader.js";
import type { Mount } from "../plugin-host/slots.js";
import { libraryAction } from "../plugin-host/panel.js";
import type { Manifest } from "../plugin-host/types.js";
import { invoke } from "./invoke.js";
import { ObjectList } from "./ObjectList.js";
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

  // Bumped when a scan finishes. Clearing the context alone left a spinner
  // nothing would ever replace: the effect ran once and had no reason to run
  // again, so "reload" meant "show the loading state forever".
  const [generation, setGeneration] = useState(0);

  // Which object the page is showing. Undefined means "whichever the library
  // hands back first", which is what a freshly opened library shows.
  const [chosen, setChosen] = useState<ObjectId | undefined>(undefined);
  const [shown, setShown] = useState<FlatObject | undefined>(undefined);

  useEffect(() => {
    if (!chosen) {
      setShown(undefined);
      return;
    }

    let current = true;
    api
      .objectFlat(chosen)
      .then((object) => {
        if (current) setShown(object);
      })
      .catch((error: unknown) => {
        if (current) setProblem(describe(error));
      });

    return () => {
      current = false;
    };
  }, [chosen]);

  useEffect(() => {
    let current = true;
    setContext(undefined);
    setProblem(undefined);

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
  }, [generation]);

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
        <LibraryActions
          plugins={context.plugins}
          loaded={context.loaded}
          onChanged={() => {
            setChosen(undefined);
            setGeneration((n) => n + 1);
          }}
        />
      </Stack>
    );
  }

  return (
    <PageLayout>
      <PageLayout.Pane position="start" width="medium">
        <Stack gap="condensed">
          <LibraryActions
            plugins={context.plugins}
            loaded={context.loaded}
            onChanged={() => {
              setChosen(undefined);
              setGeneration((n) => n + 1);
            }}
          />
          <ObjectList
            api={api}
            selected={chosen ?? context.object.id}
            onSelect={setChosen}
            generation={generation}
          />
        </Stack>
      </PageLayout.Pane>

      <PageLayout.Content>
        <ObjectPage
          api={api}
          object={shown ?? context.object}
          plugins={context.plugins}
          loaded={context.loaded}
          mounts={context.mounts}
        />
      </PageLayout.Content>
    </PageLayout>
  );
}

/**
 * What the installed plugins can do to the library as a whole.
 *
 * Scanning lives here rather than in the core: deciding what counts as an
 * object is domain knowledge, and `docs.yml` says the core has none. A folder
 * library, a VRChat library and a library of papers give three different
 * answers, so the answer arrives as a plugin.
 *
 * A library with no such plugin installed can still be filled by hand. It just
 * cannot be filled by walking a disk, because nothing has said what walking
 * one should produce.
 */
export function LibraryActions({
  plugins,
  loaded,
  onChanged,
}: {
  readonly plugins: readonly Manifest[];
  readonly loaded: readonly Loaded[];
  readonly onChanged: () => void;
}): React.JSX.Element | null {
  const [running, setRunning] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<string | undefined>(undefined);

  const offered = libraryActionsOf(plugins);
  if (offered.length === 0) return null;

  const run = (plugin: string, action: string): void => {
    setRunning(action);
    setResult(undefined);

    const owner = loaded.find((entry) => entry.manifest.id === plugin);
    const specifier = plugins.find((p) => p.id === plugin)?.contributes
      ?.library_action_module;
    const fn = specifier ? libraryAction(owner?.modules.get(specifier)) : undefined;

    if (!fn) {
      setResult(`${plugin} could not be loaded`);
      setRunning(undefined);
      return;
    }

    fn({ api, action })
      .then((outcome) => {
        setResult(outcome.summary);
        if (outcome.changed) onChanged();
      })
      .catch((error: unknown) => setResult(describe(error)))
      .finally(() => setRunning(undefined));
  };

  return (
    <Stack direction="horizontal" gap="condensed" align="center">
      {offered.map(({ plugin, action }) => (
        <Button
          key={`${plugin}:${action}`}
          disabled={running !== undefined}
          onClick={() => run(plugin, action)}
        >
          {running === action ? `${action}…` : action}
        </Button>
      ))}
      {result && <Text size="small">{result}</Text>}
    </Stack>
  );
}

/** Every library action the installed plugins offer. */
export function libraryActionsOf(
  plugins: readonly Manifest[],
): Array<{ plugin: string; action: string }> {
  return plugins.flatMap((plugin) =>
    (plugin.contributes?.library_actions ?? []).map((action) => ({
      plugin: plugin.id,
      action,
    })),
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
 * Test files are excluded. Without that they are bundled and shipped, which
 * puts vitest and every fixture into the application a user runs.
 *
 * Third-party plugins loaded from disk at runtime will need a different path —
 * they are not in the bundle by definition. That is a later problem, and the
 * injected resolver is what keeps it from being this file's problem twice.
 */
const BUILT_IN = import.meta.glob(["../../plugins/*/*.{ts,tsx}", "!**/*.test.*"]);

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
