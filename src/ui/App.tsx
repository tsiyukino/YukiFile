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
 * # A grid in the middle, a pane on the left
 *
 * The content area is the thumbnail grid: what the library holds, as covers.
 * `2026-09-01_ui-primer-not-github-clone.md` says thumbnails are the main
 * view, and now that covers exist to draw they are. Choosing a card replaces
 * the grid with the object's page, and **Back** brings the grid back.
 *
 * The pane on the left lists the other ways in — what the disk has, the
 * vocabularies, what is waiting for review — and holds the library-wide
 * actions. With the Library segment selected it lists nothing: the grid is
 * the listing, and the segment is the way back to it from any page.
 */

import { Button, Heading, IconButton, PageLayout, SegmentedControl, Spinner, Stack, Text } from "@primer/react";
import { GearIcon } from "@primer/octicons-react";
import { InlineMessage } from "@primer/react/experimental";
import { useEffect, useState } from "react";

import {
  apiFor,
  appApiFor,
  pressedApiFor,
  type Api,
  type AppApi,
  type FlatObject,
  type ObjectId,
  type PathAt,
} from "../plugin-host/commands.js";
import { loadAll, type Loaded } from "../plugin-host/loader.js";
import type { Mount } from "../plugin-host/slots.js";
import { libraryAction } from "../plugin-host/panel.js";
import type { Manifest } from "../plugin-host/types.js";
import { AddObject } from "./AddObject.js";
import { DiskBrowser } from "./DiskBrowser.js";
import { ForgetButton } from "./Forget.js";
import { dialogs, invoke } from "./invoke.js";
import { describe } from "./problem.js";
import { ObjectGrid } from "./ObjectGrid.js";
import { fallbackTitle, ObjectPage } from "./ObjectPage.js";
import { Rescan } from "./Rescan.js";
import { ReviewList, ReviewPage } from "./Review.js";
import { Settings } from "./Settings.js";
import type { ThemePreference } from "./theme.js";
import { TermList, TermPage, type TermRef } from "./Terms.js";
import { Transfer } from "./Transfer.js";

/** The API every panel is handed, wired to the real Tauri bridge. */
export const api: Api = apiFor(invoke);

/**
 * What only the application's own screens may call.
 *
 * Built from `APP_ONLY` rather than the allowlist, and never handed to a
 * plugin: a form returns values and this is what writes them.
 */
export const app: AppApi = appApiFor(invoke);

/** What the left pane is listing. */
type Pane = "library" | "disk" | "terms" | "review";

const PANES: readonly Pane[] = ["library", "disk", "terms", "review"];

/** What the shell gathers before a page can draw. */
export interface Context {
  readonly plugins: readonly Manifest[];
  readonly loaded: readonly Loaded[];
  readonly mounts: readonly Mount[];
  /** How many objects the library holds. */
  readonly total: number;
  /** How many change sets are waiting for a person. */
  readonly pending: number;
}

export interface AppProps {
  /** The theme setting changed; the window should follow at once. */
  readonly onTheme?: ((preference: ThemePreference) => void) | undefined;
}

export function App({ onTheme }: AppProps = {}): React.JSX.Element {
  const [context, setContext] = useState<Context | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  // Bumped when the library changes: a scan, an add, a forget. Clearing the
  // context alone left a spinner nothing would ever replace: the effect ran
  // once and had no reason to run again, so "reload" meant "show the loading
  // state forever".
  const [generation, setGeneration] = useState(0);

  // Which object the page is showing. Undefined means the grid is up.
  const [chosen, setChosen] = useState<ObjectId | undefined>(undefined);
  const [shown, setShown] = useState<FlatObject | undefined>(undefined);

  const [pane, setPane] = useState<Pane>("library");

  // Something on disk a person is in the middle of making an object of. While
  // it is set the page shows the add flow instead of an object.
  const [adding, setAdding] = useState<PathAt | undefined>(undefined);

  // The change set under review, when the page is showing one.
  const [reviewing, setReviewing] = useState<number | undefined>(undefined);

  // The term on the page, when it is showing one.
  const [term, setTerm] = useState<TermRef | undefined>(undefined);

  // The settings page, when it is showing.
  const [settings, setSettings] = useState(false);

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
    // Generation too: an edit changes the object on screen without changing
    // which object it is, and the page has to show the new value.
  }, [chosen, generation]);

  useEffect(() => {
    let current = true;
    setProblem(undefined);

    // The old context stays up while the new one is read. Clearing it would
    // unmount the panes, and a person who just added one file three folders
    // down would find the browser back at the root.
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

  // Back to the grid, whatever the page was showing.
  const home = (): void => {
    setAdding(undefined);
    setReviewing(undefined);
    setTerm(undefined);
    setSettings(false);
    setChosen(undefined);
  };

  // The library changed under the page: an object was added, forgotten, or a
  // scan ran. Re-read everything and show the grid as it is now.
  const changed = (): void => {
    setChosen(undefined);
    setGeneration((n) => n + 1);
  };

  // The object on screen changed but is still the one to look at. Re-read
  // everything, including it, without leaving it.
  const refresh = (): void => setGeneration((n) => n + 1);

  // Opening an object from any pane: the page shows it, nothing else.
  const open = (id: ObjectId): void => {
    home();
    setChosen(id);
  };

  return (
    <PageLayout>
      <PageLayout.Pane position="start" width="medium">
        <Stack gap="condensed">
          <LibraryActions plugins={context.plugins} loaded={context.loaded} onChanged={changed} />
          <Rescan app={app} onChanged={refresh} />
          <Transfer app={app} dialogs={dialogs} onChanged={refresh} />

          <Stack direction="horizontal" gap="condensed" align="center">
            <IconButton
              icon={GearIcon}
              aria-label="Settings"
              size="small"
              variant={settings ? "primary" : "default"}
              onClick={() => setSettings((on) => !on)}
            />
          </Stack>

          <SegmentedControl
            aria-label="What the pane lists"
            fullWidth
            onChange={(index) => {
              const next = PANES[index] ?? "library";
              setPane(next);
              // The Library segment is the way home: the grid is its listing.
              if (next === "library") home();
            }}
          >
            <SegmentedControl.Button selected={pane === "library"}>Library</SegmentedControl.Button>
            <SegmentedControl.Button selected={pane === "disk"}>Disk</SegmentedControl.Button>
            <SegmentedControl.Button selected={pane === "terms"}>Terms</SegmentedControl.Button>
            <SegmentedControl.Button selected={pane === "review"}>
              {context.pending > 0 ? `Review (${context.pending})` : "Review"}
            </SegmentedControl.Button>
          </SegmentedControl>

          {pane === "library" && (
            <Text size="small">
              {context.total} {context.total === 1 ? "object" : "objects"} in the library.
            </Text>
          )}
          {pane === "disk" && (
            <DiskBrowser
              api={api}
              generation={generation}
              onSelect={open}
              onAdd={(at) => {
                home();
                setAdding(at);
              }}
            />
          )}
          {pane === "terms" && (
            <TermList
              api={api}
              generation={generation}
              selected={term}
              onSelect={(chosenTerm) => {
                home();
                setTerm(chosenTerm);
              }}
            />
          )}
          {pane === "review" && (
            <ReviewList
              api={api}
              generation={generation}
              selected={reviewing}
              onSelect={(set) => {
                home();
                setReviewing(set);
              }}
            />
          )}
        </Stack>
      </PageLayout.Pane>

      <PageLayout.Content>
        {settings ? (
          <Settings
            api={api}
            app={app}
            generation={generation}
            onTheme={(preference) => onTheme?.(preference)}
            onChanged={refresh}
          />
        ) : term ? (
          <TermPage
            key={`${term.vocab}:${term.id}`}
            api={api}
            term={term}
            generation={generation}
            onSelect={(id) => {
              // Opening an object from a term page is a way in; leave the
              // term behind so the page shows the object.
              setTerm(undefined);
              setChosen(id);
            }}
          />
        ) : reviewing !== undefined ? (
          <ReviewPage
            key={reviewing}
            api={api}
            app={app}
            set={reviewing}
            onApplied={() => {
              // What was accepted is in the library now. Re-read it, and let
              // the pane show what is still waiting.
              setReviewing(undefined);
              setGeneration((n) => n + 1);
            }}
          />
        ) : adding ? (
          <AddObject
            // Keyed on the path so picking a different row starts over rather
            // than carrying one file's half-filled forms to another.
            key={adding.path}
            api={api}
            app={app}
            at={adding}
            plugins={context.plugins}
            loaded={context.loaded}
            mounts={context.mounts}
            onAdded={(id) => {
              setAdding(undefined);
              // Show what was just made, and re-read the library so the
              // browser marks it and the grid holds it.
              setGeneration((n) => n + 1);
              setChosen(id);
            }}
            onCancel={() => setAdding(undefined)}
          />
        ) : shown ? (
          <Stack gap="none">
            <Stack direction="horizontal" justify="space-between" padding="condensed">
              <Button onClick={() => setChosen(undefined)}>Back</Button>
              <ForgetButton
                key={shown.id}
                app={app}
                object={shown.id}
                name={shown.shared["title"]?.[0]?.value ?? fallbackTitle(shown) ?? "this object"}
                onForgotten={changed}
              />
            </Stack>
            <ObjectPage
              api={api}
              app={app}
              object={shown}
              plugins={context.plugins}
              loaded={context.loaded}
              mounts={context.mounts}
              onChanged={refresh}
            />
          </Stack>
        ) : chosen ? (
          // The page is on its way; the grid would flash underneath it.
          <Spinner aria-label="Opening the object" />
        ) : (
          <ObjectGrid api={api} selected={undefined} onSelect={open} generation={generation} />
        )}
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

    // The press lends the plugin the network, for the hosts it named.
    const manifest = plugins.find((p) => p.id === plugin);
    fn({ api: pressedApiFor(api, app, manifest?.contributes?.hosts ?? []), action })
      .then((outcome) => {
        setResult(outcome.summary);
        if (outcome.changed) onChanged();
      })
      .catch((error: unknown) => setResult(describe(error)))
      .finally(() => setRunning(undefined));
  };

  // Stacked, not in a row: the pane is narrow, two actions with long names
  // overflowed it, and the result -- the one line that says what the scan
  // did -- was pushed out of sight.
  return (
    <Stack gap="condensed">
      <Stack direction="horizontal" gap="condensed" wrap="wrap">
        {offered.map(({ plugin, action }) => (
          <Button
            key={`${plugin}:${action}`}
            size="small"
            disabled={running !== undefined}
            onClick={() => run(plugin, action)}
          >
            {running === action ? `${action}…` : action}
          </Button>
        ))}
      </Stack>
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
  // One id, for the total that comes with it. The grid fetches its own pages.
  const page = await api.objectIds(null, 1);
  const pending = await api.changesPending();

  return {
    plugins,
    loaded,
    mounts,
    total: page.total,
    pending: pending.length,
  };
}
