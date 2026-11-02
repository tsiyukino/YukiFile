/**
 * The application shell.
 *
 * Gathers what every page needs and cannot fetch for itself -- the plugin
 * manifests, their loaded modules, the library's mount order -- and lays the
 * window out: a header, a sidebar, and the page.
 *
 * # Header, sidebar, page
 *
 * The header holds what applies everywhere: the search box, the review
 * count, the Library menu (scans, rescan, import and export) and settings.
 * The sidebar switches between the four ways into the library -- the grid,
 * the disk, the vocabularies, what is waiting for review -- and under that
 * holds whatever the current one needs: the grid's filters, the term list,
 * the change sets.
 *
 * The page is the grid by default. `2026-09-01_ui-primer-not-github-clone.md`
 * says thumbnails are the main view and the review screens a list; both are
 * here, on the same tokens.
 *
 * # An object page sits over its view, not instead of it
 *
 * Choosing an object hides the view and shows the object; Back shows the view
 * again exactly as it was -- the same grouping, the same filters, the same
 * scroll. The view is hidden rather than unmounted for that reason: a grid
 * that re-read itself on the way back would land a person on the first page
 * of results having opened something from the fifth.
 */

import {
  Banner,
  Button,
  CounterLabel,
  Heading,
  IconButton,
  NavList,
  Spinner,
  Stack,
  TextInput,
} from "@primer/react";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  FileDirectoryIcon,
  GearIcon,
  ImageIcon,
  SearchIcon,
  TagIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Blankslate, InlineMessage } from "@primer/react/experimental";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  apiFor,
  appApiFor,
  type Api,
  type AppApi,
  type FlatObject,
  type ObjectId,
  type PathAt,
  type Sort,
} from "../plugin-host/commands.js";
import { loadAll, type Loaded } from "../plugin-host/loader.js";
import type { Mount } from "../plugin-host/slots.js";
import type { Manifest } from "../plugin-host/types.js";
import { AddObject } from "./AddObject.js";
import { CARD_SIZE, type CardSize } from "./Card.js";
import { DiskBrowser } from "./DiskBrowser.js";
import { FilterSidebar } from "./FilterSidebar.js";
import { NOTHING, onlyField, onlyTerm, withText, type Narrowing } from "./filters.js";
import { ForgetButton } from "./Forget.js";
import { dialogs, invoke } from "./invoke.js";
import { LibraryMenu, type Report } from "./LibraryMenu.js";
import { LibrarySwitcher } from "./LibrarySwitcher.js";
import { ObjectGrid, type Crumb } from "./ObjectGrid.js";
import { fallbackTitle, ObjectPage } from "./ObjectPage.js";
import { describe } from "./problem.js";
import { ReviewList, ReviewPage } from "./Review.js";
import { Settings } from "./Settings.js";
import type { ThemePreference } from "./theme.js";
import { TermList, TermPage, type TermRef } from "./Terms.js";

export { libraryActionsOf } from "./LibraryMenu.js";

/** The API every panel is handed, wired to the real Tauri bridge. */
export const api: Api = apiFor(invoke);

/**
 * What only the application's own screens may call.
 *
 * Built from `APP_ONLY` rather than the allowlist, and never handed to a
 * plugin: a form returns values and this is what writes them.
 */
export const app: AppApi = appApiFor(invoke);

/** The ways into the library the sidebar switches between. */
export type View = "library" | "disk" | "terms" | "review" | "settings";

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


function sizeFrom(stored: string | null): CardSize {
  return stored === "small" || stored === "large" ? stored : "medium";
}

/** True when a key press is being typed into something. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function App({ onTheme }: AppProps = {}): React.JSX.Element {
  const [context, setContext] = useState<Context | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [root, setRoot] = useState<string | undefined>(undefined);

  // Bumped when the library changes: a scan, an add, a forget. Clearing the
  // context alone left a spinner nothing would ever replace: the effect ran
  // once and had no reason to run again, so "reload" meant "show the loading
  // state forever".
  const [generation, setGeneration] = useState(0);

  const [view, setView] = useState<View>("library");

  // The object on the page, over whichever view it was opened from.
  const [chosen, setChosen] = useState<ObjectId | undefined>(undefined);
  const [shown, setShown] = useState<FlatObject | undefined>(undefined);
  // The last object opened, so the grid can mark where the person was.
  const [last, setLast] = useState<ObjectId | undefined>(undefined);

  // The grid's state, kept here so an object page cannot lose it.
  const [narrowing, setNarrowing] = useState<Narrowing>(NOTHING);
  const [typed, setTyped] = useState("");
  const [trail, setTrail] = useState<readonly Crumb[]>([]);
  const [sort, setSort] = useState<Sort>("name");
  const [size, setSize] = useState<CardSize>("medium");
  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(new Map());

  // Something on disk a person is in the middle of making an object of.
  const [adding, setAdding] = useState<PathAt | undefined>(undefined);
  // The change set under review.
  const [reviewing, setReviewing] = useState<number | undefined>(undefined);
  // The term on the page.
  const [term, setTerm] = useState<TermRef | undefined>(undefined);

  const [report, setReport] = useState<Report | undefined>(undefined);

  const main = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  // Where each view was scrolled to when an object was opened over it.
  const scrolls = useRef(new Map<View, number>());

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
        if (current) setReport({ tone: "critical", title: "That object could not be opened", detail: describe(error) });
        if (current) setChosen(undefined);
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
    // unmount the views, and a person who just added one file three folders
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

  // Once: where the library is, and how large the person likes the cards.
  useEffect(() => {
    app
      .libraryInfo()
      .then((info) => setRoot(info.root))
      .catch(() => undefined);
    api
      .settingGet(CARD_SIZE)
      .then((stored) => setSize(sizeFrom(stored)))
      .catch(() => undefined);
  }, []);

  // Typing settles before it searches: a query per keystroke over a large
  // library is work thrown away three times out of four.
  useEffect(() => {
    const timer = setTimeout(() => {
      setNarrowing((held) => (held.text === typed ? held : withText(held, typed)));
    }, 200);
    return () => clearTimeout(timer);
  }, [typed]);

  // "/" finds the search box from anywhere that is not itself a text field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "/" && !typing(event.target) && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // An object opens at its top; closing it puts the view back where it was.
  useLayoutEffect(() => {
    const scroller = main.current;
    if (!scroller) return;
    scroller.scrollTop = chosen ? 0 : (scrolls.current.get(view) ?? 0);
    // Only on opening and closing an object, not on every view change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);

  if (problem) {
    return (
      <Stack padding="normal" gap="condensed">
        <Heading>Yukifile</Heading>
        <InlineMessage variant="critical">{problem}</InlineMessage>
      </Stack>
    );
  }

  if (!context) {
    return (
      <div className="yk-app" style={{ placeItems: "center" }}>
        <Spinner aria-label="Opening the library" />
      </div>
    );
  }

  const refresh = (): void => setGeneration((n) => n + 1);

  // The library changed under the page: an object was added or forgotten, or
  // a scan ran. Re-read everything; an object that was forgotten closes.
  const changed = (): void => {
    setChosen(undefined);
    refresh();
  };

  /** Show an object over the current view. */
  const open = (id: ObjectId): void => {
    if (main.current && !chosen) scrolls.current.set(view, main.current.scrollTop);
    setChosen(id);
    setLast(id);
  };

  const close = (): void => setChosen(undefined);

  const go = (next: View): void => {
    setChosen(undefined);
    setView(next);
  };

  const narrow = (next: Narrowing): void => {
    setNarrowing(next);
    setTyped(next.text);
    setChosen(undefined);
    setView("library");
  };

  const chooseSize = (next: CardSize): void => {
    setSize(next);
    app.settingSet(CARD_SIZE, next).catch(() => undefined);
  };

  return (
    <div className="yk-app">
      <header className="yk-header">
        <LibrarySwitcher app={app} dialogs={dialogs} root={root} />

        <div className="yk-search">
          <TextInput
            ref={search}
            block
            leadingVisual={SearchIcon}
            placeholder="Search the library  ( / )"
            aria-label="Search the library"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              // Searching is looking at the grid, wherever the person was.
              setChosen(undefined);
              setView("library");
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setTyped("");
                (event.target as HTMLInputElement).blur();
              }
            }}
            {...(typed !== ""
              ? {
                  trailingAction: (
                    <TextInput.Action aria-label="Clear the search" icon={XCircleFillIcon} onClick={() => setTyped("")} />
                  ),
                }
              : {})}
          />
        </div>

        <div className="yk-header-end">
          {context.pending > 0 && (
            <Button
              leadingVisual={CheckCircleIcon}
              count={context.pending}
              onClick={() => go("review")}
            >
              Review
            </Button>
          )}
          <LibraryMenu
            api={api}
            app={app}
            dialogs={dialogs}
            plugins={context.plugins}
            loaded={context.loaded}
            onReport={setReport}
            onChanged={refresh}
          />
          <IconButton
            icon={GearIcon}
            aria-label="Settings"
            variant={view === "settings" ? "primary" : "default"}
            onClick={() => go(view === "settings" ? "library" : "settings")}
          />
        </div>
      </header>

      <div className="yk-body">
        <nav className="yk-sidebar" aria-label="Library">
          <NavList aria-label="Views">
            <NavList.Item
              href="#"
              aria-current={view === "library" ? "page" : false}
              onClick={(event: React.MouseEvent) => {
                event.preventDefault();
                // Library from Library is the way home: out of the object,
                // back to the top of the tree.
                if (view === "library" && !chosen) setTrail([]);
                go("library");
              }}
            >
              <NavList.LeadingVisual>
                <ImageIcon />
              </NavList.LeadingVisual>
              Library
              <NavList.TrailingVisual>
                <CounterLabel>{context.total}</CounterLabel>
              </NavList.TrailingVisual>
            </NavList.Item>
            <NavList.Item
              href="#"
              aria-current={view === "disk" ? "page" : false}
              onClick={(event: React.MouseEvent) => {
                event.preventDefault();
                go("disk");
              }}
            >
              <NavList.LeadingVisual>
                <FileDirectoryIcon />
              </NavList.LeadingVisual>
              Disk
            </NavList.Item>
            <NavList.Item
              href="#"
              aria-current={view === "terms" ? "page" : false}
              onClick={(event: React.MouseEvent) => {
                event.preventDefault();
                go("terms");
              }}
            >
              <NavList.LeadingVisual>
                <TagIcon />
              </NavList.LeadingVisual>
              Terms
            </NavList.Item>
            <NavList.Item
              href="#"
              aria-current={view === "review" ? "page" : false}
              onClick={(event: React.MouseEvent) => {
                event.preventDefault();
                go("review");
              }}
            >
              <NavList.LeadingVisual>
                <CheckCircleIcon />
              </NavList.LeadingVisual>
              Review
              {context.pending > 0 && (
                <NavList.TrailingVisual>
                  <CounterLabel scheme="primary">{context.pending}</CounterLabel>
                </NavList.TrailingVisual>
              )}
            </NavList.Item>
          </NavList>

          <hr className="yk-sidebar-divider" />

          {view === "library" && (
            <FilterSidebar
              api={api}
              plugins={context.plugins}
              narrowing={narrowing}
              onNarrow={narrow}
              onLabels={setLabels}
              generation={generation}
            />
          )}
          {view === "terms" && (
            <TermList
              api={api}
              generation={generation}
              selected={term}
              onSelect={(next) => {
                setChosen(undefined);
                setTerm(next);
              }}
            />
          )}
          {view === "review" && (
            <ReviewList
              api={api}
              generation={generation}
              selected={reviewing}
              onSelect={(set) => {
                setChosen(undefined);
                setReviewing(set);
              }}
            />
          )}
          {view === "disk" && (
            <p className="yk-muted yk-facet-note">
              What is on disk, against what the library recorded. Choose something new to add it.
            </p>
          )}
        </nav>

        <main className="yk-main" ref={main}>
          <div className="yk-main-inner">
            {report && (
              <div className="yk-banners">
                <Banner
                  title={report.title}
                  description={report.detail}
                  variant={report.tone === "info" ? "info" : report.tone}
                  onDismiss={() => setReport(undefined)}
                />
              </div>
            )}

            {shown && (
              <div>
                <div className="yk-page-bar">
                  <Button leadingVisual={ArrowLeftIcon} onClick={close}>
                    Back
                  </Button>
                  <ForgetButton
                    key={shown.id}
                    app={app}
                    object={shown.id}
                    name={shown.shared["title"]?.[0]?.value ?? fallbackTitle(shown) ?? "this object"}
                    onForgotten={changed}
                  />
                </div>
                <ObjectPage
                  api={api}
                  app={app}
                  object={shown}
                  plugins={context.plugins}
                  loaded={context.loaded}
                  mounts={context.mounts}
                  onChanged={refresh}
                  onTerm={(vocab, id) => {
                    setTrail([]);
                    narrow(onlyTerm(vocab, id));
                  }}
                  onField={(field, value) => {
                    setTrail([]);
                    narrow(onlyField(field, value));
                  }}
                />
              </div>
            )}
            {chosen && !shown && <Spinner aria-label="Opening the object" />}

            <div hidden={chosen !== undefined}>
              {view === "library" && (
                <ObjectGrid
                  api={api}
                  narrowing={narrowing}
                  onNarrow={narrow}
                  trail={trail}
                  onTrail={setTrail}
                  sort={sort}
                  onSort={setSort}
                  size={size}
                  onSize={chooseSize}
                  labels={labels}
                  onChoose={open}
                  current={last}
                  generation={generation}
                />
              )}

              {view === "disk" &&
                (adding ? (
                  <AddObject
                    // Keyed on the path so picking a different row starts
                    // over rather than carrying one file's forms to another.
                    key={adding.path}
                    api={api}
                    app={app}
                    at={adding}
                    plugins={context.plugins}
                    loaded={context.loaded}
                    mounts={context.mounts}
                    onAdded={(id) => {
                      setAdding(undefined);
                      refresh();
                      open(id);
                    }}
                    onCancel={() => setAdding(undefined)}
                  />
                ) : (
                  <DiskBrowser api={api} generation={generation} onSelect={open} onAdd={setAdding} />
                ))}

              {view === "terms" &&
                (term ? (
                  <TermPage
                    key={`${term.vocab}:${term.id}`}
                    api={api}
                    term={term}
                    generation={generation}
                    onSelect={open}
                    onShowInGrid={(shown) => {
                      setTrail([]);
                      narrow(onlyTerm(shown.vocab, shown.id));
                    }}
                  />
                ) : (
                  <Placeholder
                    heading="Choose a term"
                    description="Pick one from the list to see everything in the library that points at it."
                  />
                ))}

              {view === "review" &&
                (reviewing !== undefined ? (
                  <ReviewPage
                    key={reviewing}
                    api={api}
                    app={app}
                    set={reviewing}
                    onApplied={() => {
                      // What was accepted is in the library now. Re-read it,
                      // and let the list show what is still waiting.
                      setReviewing(undefined);
                      refresh();
                    }}
                  />
                ) : (
                  <Placeholder
                    heading={context.pending > 0 ? "Choose a change set" : "Nothing to review"}
                    description={
                      context.pending > 0
                        ? "Each set is a batch of proposed changes. Pick one to decide what it may write."
                        : "When an import would overwrite something a person chose, it waits here."
                    }
                  />
                ))}

              {view === "settings" && (
                <Settings
                  api={api}
                  app={app}
                  generation={generation}
                  onTheme={(preference) => onTheme?.(preference)}
                  onChanged={refresh}
                />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/** What an empty page says. */
function Placeholder({ heading, description }: { readonly heading: string; readonly description: string }): React.JSX.Element {
  return (
    <div className="yk-empty">
      <Blankslate>
        <Blankslate.Heading>{heading}</Blankslate.Heading>
        <Blankslate.Description>{description}</Blankslate.Description>
      </Blankslate>
    </div>
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
  // One id, for the total that comes with it: every object, wherever it sits
  // in the tree. The grid fetches its own pages.
  const page = await api.objectQuery({}, "oldest", 0, 1);
  const pending = await api.changesPending();

  return {
    plugins,
    loaded,
    mounts,
    total: page.total,
    pending: pending.length,
  };
}
