/**
 * The framework's object page.
 *
 * Drawn for every object, and replaced by nothing in v1: layout ownership is
 * deferred (`2026-09-02_v1-scope-revised.md`), so this is what a person sees
 * whatever the object turns out to be.
 *
 * Three things arrive from three places and meet here:
 *
 * - `object.flat` says what the object holds, resolved
 * - `slots.panelsFor` says which panels belong to it, in mount order
 * - `loader.loadAll` says which of those modules actually came back
 *
 * None of that is decided here. The page's own job is layout.
 *
 * # The head says what the thing is; the regions say the rest
 *
 * The top of the page is what a person opened it to see: the cover, the
 * name, what kind of thing it is, the shared fields, the terms it points at
 * (the avatars a product fits), where it sits, and the actions plugins offer
 * on it. Below that, the viewer if a plugin has one, then one region per
 * property instance in mount order, each a plugin's own space. Editing what
 * the object is, what it links to and where it sits is a section of its own
 * at the bottom, closed until wanted: it is how a wrong edge gets fixed, not
 * what anybody opens a product to read.
 *
 * Terms and facet values are links. Following one goes back to the grid
 * narrowed to everything sharing it, which is the question a page about one
 * avatar outfit most often leads to.
 */

import { Blankslate, InlineMessage } from "@primer/react/experimental";
import { Button, Heading, IconButton, Label, Spinner, Stack, Text, Token } from "@primer/react";
import { ChevronDownIcon, ChevronRightIcon, PencilIcon } from "@primer/octicons-react";
import { useEffect, useState } from "react";

import type {
  Api,
  AppApi,
  Edge,
  FlatObject,
  Region,
} from "../plugin-host/commands.js";
import type { Contribution, Mount } from "../plugin-host/slots.js";
import { actionsFor, panelsFor } from "../plugin-host/slots.js";
import { objectAction, panelComponent, type Panel } from "../plugin-host/panel.js";
import { pressedApiFor } from "../plugin-host/commands.js";
import type { Loaded } from "../plugin-host/loader.js";
import type { Manifest } from "../plugin-host/types.js";
import { Cover } from "./Cover.js";
import { fieldPath, isFieldName } from "./edit.js";
import { FieldEditor, NewField } from "./FieldEditor.js";
import { facetsOf, headingFor } from "./filters.js";
import { ObjectEditor } from "./ObjectEditor.js";
import { describe } from "./problem.js";
import { PropertyRegion, regionTitle, type ResolvedAction, type ResolvedPanel } from "./PropertyRegion.js";
import { SourceList } from "./SourceList.js";
import { Viewer } from "./Viewer.js";

/** Fields the page draws itself rather than leaving to a region. */
const HEADLINE = "title";

export interface ObjectPageProps {
  readonly api: Api;
  /** The resolved object, or `undefined` while it is being fetched. */
  readonly object: FlatObject | undefined;
  readonly plugins: readonly Manifest[];
  /** What each plugin's modules resolved to, by plugin id. */
  readonly loaded: readonly Loaded[];
  readonly mounts: readonly Mount[];
  /**
   * What the application writes with. Absent, the page is read-only, which
   * is what a panel's tests and a future embedded view want.
   */
  readonly app?: AppApi;
  /** The object changed; whoever owns it should re-read it. */
  readonly onChanged?: () => void;
  /** A term was followed: show everything pointing at it. */
  readonly onTerm?: (vocab: string, term: string) => void;
  /** A facet value was followed: show everything showing it. */
  readonly onField?: (field: string, value: string) => void;
}

export function ObjectPage({
  api,
  object,
  plugins,
  loaded,
  mounts,
  app,
  onChanged,
  onTerm,
  onField,
}: ObjectPageProps): React.JSX.Element {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingMore, setEditingMore] = useState(false);
  const [running, setRunning] = useState<string | undefined>(undefined);
  const [said, setSaid] = useState<{ text: string; failed: boolean } | undefined>(undefined);

  if (!object) {
    return <Spinner aria-label="Loading the object" />;
  }

  const writable = app !== undefined && onChanged !== undefined;

  // What the object carries, not what has fields: a plugin's panel belongs on
  // an object the moment it carries the property, not once the plugin has
  // already written something under it.
  const contributions = panelsFor(plugins, object.carries, mounts);
  // `file` and `folder` are the two properties everything on disk carries.
  // A region for one with nothing in it and nothing drawing in it is a
  // heading over an empty space on every object page there is.
  const shown = regionsToShow(object).filter(
    (region) =>
      !(["file", "folder"].includes(region.property) &&
        Object.keys(region.fields).length === 0 &&
        !contributions.some((c) => c.property === region.property)),
  );
  const counts = instanceCounts(shown);
  const facets = facetsOf(plugins).fields;

  const headline = object.shared[HEADLINE];
  // `cover` is drawn as a picture by `Cover`, not as a path in a row.
  const otherFields = Object.entries(object.shared).filter(([name]) => name !== HEADLINE && name !== "cover");

  // A pin is a value under the reserved `@pin` namespace, written like any
  // other edit; the page only has to say which source it names.
  const pinProps = (name: string): { pinned?: string | undefined; onPin?: ((from: string | null) => void) | undefined } =>
    writable
      ? {
          pinned: object.pins?.[name],
          onPin: (from) => {
            app
              .objectValueSet(object.id, `@pin/${name}`, from ?? "")
              .then(onChanged)
              .catch(() => undefined);
          },
        }
      : {};

  // Writing a shared field writes the bare one, which outranks every source:
  // that is what a person's own value means, and clearing it hands the field
  // back to mount order. The editor starts from what is shown, because that
  // is what they are looking at, and offers Clear only when a bare value is
  // theirs to take back.
  const sharedRow = (name: string, sources: FlatObject["shared"][string]): React.JSX.Element => {
    const value = sources[0]?.value;
    const asLink =
      onField && facets.includes(name) && value !== undefined && sources.length === 1 ? (
        <button type="button" className="yk-link" onClick={() => onField(name, value)}>
          {value}
        </button>
      ) : undefined;
    const display = asLink ?? <SourceList sources={sources} {...pinProps(name)} />;
    if (!writable) {
      return (
        <div className="yk-field" key={name}>
          <span className="yk-field-label">{name}</span>
          <span className="yk-field-value">{display}</span>
        </div>
      );
    }
    return (
      <FieldEditor
        key={name}
        label={name}
        display={display}
        shown={value}
        own={sources.find((source) => source.from === null)?.value}
        onSave={async (next) => {
          await app.objectValueSet(object.id, name, next);
          onChanged();
        }}
      />
    );
  };

  // Every action any region offers, in the head where a person looks first.
  const actions: ResolvedAction[] = writable
    ? shown.flatMap((region) => actionsIn(region, actionsFor(plugins, object.carries, mounts), plugins, loaded, api, app, object.id))
    : [];

  const press = (action: ResolvedAction): void => {
    setRunning(action.action);
    setSaid(undefined);
    action
      .run()
      .then((outcome) => {
        setSaid({ text: outcome.summary, failed: false });
        if (outcome.changed) onChanged?.();
      })
      .catch((error: unknown) => setSaid({ text: describe(error), failed: true }))
      .finally(() => setRunning(undefined));
  };

  const title = headline ? (
    <SourceList sources={headline} {...pinProps(HEADLINE)} />
  ) : (
    // A scan finds files before anybody names them, so most objects have no
    // title. The filename is what a person already calls the thing, and
    // showing "Untitled" over a file that plainly has a name is the page
    // refusing to read what is in front of it.
    (fallbackTitle(object) ?? <Text weight="light">Untitled</Text>)
  );

  return (
    <article className="yk-object">
      <div className="yk-object-head">
        <div className="yk-object-side">
          <Cover api={api} app={app} object={object} onChanged={onChanged} />
        </div>

        <div className="yk-object-info">
          {editingTitle && writable ? (
            <FieldEditor
              label="title"
              shown={headline?.[0]?.value ?? fallbackTitle(object)}
              own={headline?.find((source) => source.from === null)?.value}
              startOpen
              onClose={() => setEditingTitle(false)}
              onSave={async (next) => {
                await app.objectValueSet(object.id, HEADLINE, next);
                onChanged();
              }}
            />
          ) : (
            <div className="yk-object-title-row">
              <Heading as="h1" className="yk-object-title">
                {title}
              </Heading>
              {writable && (
                <IconButton
                  icon={PencilIcon}
                  aria-label="Edit title"
                  size="small"
                  variant="invisible"
                  onClick={() => setEditingTitle(true)}
                />
              )}
            </div>
          )}

          {shown.length > 0 && (
            <div className="yk-object-labels" aria-label="What it is">
              {shown.map((region) => (
                <Label key={`${region.property}#${region.instance}`} variant="secondary">
                  {regionTitle(region, counts.get(region.property) ?? 1)}
                </Label>
              ))}
            </div>
          )}

          {actions.length > 0 && (
            <div className="yk-object-actions">
              {actions.map((action) => (
                <Button
                  key={`${action.plugin}:${action.action}:${action.property}#${action.instance}`}
                  size="small"
                  disabled={running !== undefined}
                  onClick={() => press(action)}
                >
                  {running === action.action ? `${headingFor(action.action)}…` : headingFor(action.action)}
                </Button>
              ))}
              {said && (
                <Text size="small" className={said.failed ? "yk-danger" : "yk-muted"}>
                  {said.text}
                </Text>
              )}
            </div>
          )}

          <div className="yk-fields">
            {otherFields.map(([name, sources]) => sharedRow(name, sources))}
            <Pointers api={api} object={object} onTerm={onTerm} />
            {object.locations.map((location) => (
              <div className="yk-field" key={location.path}>
                <span className="yk-field-label">location</span>
                <span className="yk-field-value yk-mono">
                  {location.path}
                  {location.kind === "folder" ? "/" : sizeSuffix(location.size)}
                </span>
              </div>
            ))}
            {writable && (
              <NewField
                isName={isFieldName}
                onAdd={async (name, value) => {
                  await app.objectValueSet(object.id, name, value);
                  onChanged();
                }}
              />
            )}
          </div>
        </div>
      </div>

      <Viewer api={api} object={object} plugins={plugins} loaded={loaded} mounts={mounts} />

      {shown.length > 0 && (
        <div className="yk-regions">
          {shown.map((region) => (
            <PropertyRegion
              key={`${region.property}#${region.instance}`}
              api={api}
              objectId={object.id}
              region={region}
              instancesOfProperty={counts.get(region.property) ?? 1}
              panels={panelsIn(region, contributions, loaded)}
              onChanged={onChanged}
              facets={facets}
              onField={onField}
              onClearAll={writable ? clearerFor(region, object, app) : undefined}
              onSet={
                writable
                  ? async (name, value) => {
                      await app.objectValueSet(object.id, fieldPath(region, name), value);
                      onChanged();
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {shown.length === 0 &&
        object.locations.length === 0 &&
        Object.keys(object.shared).length === 0 && (
        <Blankslate>
          <Blankslate.Heading>Nothing recorded yet</Blankslate.Heading>
          <Blankslate.Description>
            This object exists but carries no values. A scan or an import will
            fill it in.
          </Blankslate.Description>
        </Blankslate>
      )}

      {object.skipped.length > 0 && (
        // Only defects reach here -- values under an uninstalled plugin are
        // filtered out in the bridge. What is left is worth interrupting for.
        <Stack gap="none">
          {object.skipped.map((skipped) => (
            <InlineMessage key={skipped.path} variant="warning">
              {skipped.path}: {skipped.reason}
            </InlineMessage>
          ))}
        </Stack>
      )}

      {writable && (
        <section className="yk-object-more">
          <button
            type="button"
            className="yk-facet-heading"
            aria-expanded={editingMore}
            onClick={() => setEditingMore((open) => !open)}
          >
            {editingMore ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
            <span>What it is, what it points at, where it sits</span>
          </button>
          {editingMore && (
            <div className="yk-object-more-body">
              <ObjectEditor api={api} app={app} object={object} plugins={plugins} onChanged={onChanged} />
            </div>
          )}
        </section>
      )}
    </article>
  );
}

/**
 * The terms an object points at, as rows of links.
 *
 * One row per kind of edge and vocabulary -- "supports avatar" -- because
 * "fits Manuka" and "is Manuka's own base" are different facts. Each term is
 * a token that opens the grid narrowed to it. What the object contains is
 * the grid's to show, so it is a count here.
 */
function Pointers({
  api,
  object,
  onTerm,
}: {
  readonly api: Api;
  readonly object: FlatObject;
  readonly onTerm?: ((vocab: string, term: string) => void) | undefined;
}): React.JSX.Element | null {
  const [edges, setEdges] = useState<Edge[]>([]);
  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    let live = true;
    const read = async (): Promise<void> => {
      const found = await api.objectEdges(object.id);
      const vocabularies = [...new Set(found.flatMap((edge) => (edge.target === "term" ? [edge.vocab] : [])))];
      const terms = (await Promise.all(vocabularies.map((vocab) => api.termList(vocab)))).flat();
      if (!live) return;
      setEdges(found);
      setLabels(new Map(terms.map((term) => [`${term.vocab}:${term.id}`, term.label])));
    };
    // A page without its links is still a page; the editor below says why
    // they could not be read when someone opens it.
    read().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, object]);

  const groups = new Map<string, { vocab: string; kind: string; terms: string[] }>();
  let contains = 0;
  for (const edge of edges) {
    if (edge.target === "object") {
      if (edge.kind === "contains") contains += 1;
      continue;
    }
    const key = `${edge.kind}:${edge.vocab}`;
    const group = groups.get(key) ?? { vocab: edge.vocab, kind: edge.kind, terms: [] };
    group.terms.push(edge.term);
    groups.set(key, group);
  }

  if (groups.size === 0 && contains === 0) return null;

  return (
    <>
      {[...groups.values()].map((group) => (
        <div className="yk-field" key={`${group.kind}:${group.vocab}`}>
          <span className="yk-field-label">
            {group.kind} {group.vocab}
          </span>
          <span className="yk-field-value yk-tokens">
            {group.terms.map((term) => {
              const label = labels.get(`${group.vocab}:${term}`) ?? term;
              return onTerm ? (
                <Token key={term} text={label} as="button" onClick={() => onTerm(group.vocab, term)} />
              ) : (
                <Token key={term} text={label} />
              );
            })}
          </span>
        </div>
      ))}
      {contains > 0 && (
        <div className="yk-field">
          <span className="yk-field-label">holds</span>
          <span className="yk-field-value">
            {contains} {contains === 1 ? "object" : "objects"}
          </span>
        </div>
      )}
    </>
  );
}

/**
 * Clear what one property instance says about an object, or nothing to do.
 *
 * Its own fields, and every shared field it is a source of: a Booth fetch
 * writes the title, price, url, vendor and cover under `booth#1`, and those
 * live among the shared sources rather than in the region. Values a person
 * typed (bare) and other sources' values are not touched.
 */
export function pathsSaidBy(region: Region, object: FlatObject): string[] {
  const from = `${region.property}#${region.instance}`;
  const paths = Object.keys(region.fields).map((name) => `${from}/${name}`);
  for (const [field, sources] of Object.entries(object.shared)) {
    if (sources.some((source) => source.from === from)) paths.push(`${from}/${field}`);
  }
  return paths;
}

/**
 * The region's Clear, when it has anything to clear. The region re-reads after.
 *
 * The property is recorded as chosen first. An object that carried `booth`
 * only because a fetch wrote under it would otherwise stop carrying it, and
 * the section a person needs to type the right listing number into would go
 * with the wrong values. Clearing what a source said is not saying the
 * object is not that kind of thing.
 */
function clearerFor(region: Region, object: FlatObject, app: AppApi): (() => Promise<void>) | undefined {
  const paths = pathsSaidBy(region, object);
  if (paths.length === 0) return undefined;
  return async () => {
    if (region.instance === 1) await app.objectPropertyAdd(object.id, region.property);
    for (const path of paths) await app.objectValueSet(object.id, path, "");
  };
}

/**
 * The regions to draw: one per property the object carries.
 *
 * A property with no fields still gets a region, because a plugin's panel goes
 * inside it and a `.zip` is an archive before anything is written about it.
 * Regions that do hold fields keep them.
 */
export function regionsToShow(object: FlatObject): Region[] {
  const byKey = new Map(
    object.regions.map((region) => [`${region.property}#${region.instance}`, region]),
  );

  return object.carries.map((carried) => {
    const existing = byKey.get(carried);
    if (existing) return existing;

    const hash = carried.lastIndexOf("#");
    return {
      property: hash === -1 ? carried : carried.slice(0, hash),
      instance: hash === -1 ? 1 : Number(carried.slice(hash + 1)),
      fields: {},
    };
  });
}

/**
 * What to call an object that has no title.
 *
 * The last segment of its first location. A scan records where things are
 * before anybody names them, so this is the common case rather than the
 * exception, and the filename is what the person already calls it.
 *
 * `undefined` for a grouping, which has no location and genuinely has no name
 * until somebody gives it one.
 */
export function fallbackTitle(object: FlatObject): string | undefined {
  const first = object.locations[0];
  if (!first) return undefined;

  const name = first.path.split("/").filter(Boolean).pop();
  return name === "" ? undefined : name;
}

/** A size a person can read, or nothing when there is none. */
export function sizeSuffix(size: number | null): string {
  return size === null ? "" : ` · ${sizeInWords(size)}`;
}

/** A size in bytes as a person reads it: `512 B`, `2.0 KB`. */
export function sizeInWords(size: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

/** How many instances of each property the object carries. */
export function instanceCounts(regions: readonly Region[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const region of regions) {
    counts.set(region.property, (counts.get(region.property) ?? 0) + 1);
  }
  return counts;
}

/**
 * The panels belonging in one region, with their modules resolved.
 *
 * A contribution whose module failed to load still appears, carrying
 * `undefined`. Dropping it would leave a silent gap; the region says which
 * plugin is missing instead.
 */
export function panelsIn(
  region: Region,
  contributions: readonly Contribution[],
  loaded: readonly Loaded[],
): ResolvedPanel[] {
  return contributions
    .filter(
      (c) => c.property === region.property && c.instance === region.instance,
    )
    .map((contribution) => ({
      plugin: contribution.plugin,
      component: componentFor(contribution, loaded),
    }));
}

/** The component a contribution names, if its module loaded and is one. */
function componentFor(
  contribution: Contribution,
  loaded: readonly Loaded[],
): Panel | undefined {
  const owner = loaded.find((entry) => entry.manifest.id === contribution.plugin);
  if (!owner) return undefined;
  return panelComponent(owner.modules.get(contribution.value));
}

/**
 * The actions offered in one region, each ready to run with the lent api.
 *
 * The api handed to the action carries the network for the hosts the
 * plugin's manifest named: the press is what lends it. An action whose
 * module did not load, or has no `runObjectAction`, is left out rather than
 * drawn as a button that fails -- the panel in the same region already says
 * which plugin is missing.
 */
export function actionsIn(
  region: Region,
  contributions: readonly Contribution[],
  plugins: readonly Manifest[],
  loaded: readonly Loaded[],
  api: Api,
  app: AppApi,
  objectId: FlatObject["id"],
): ResolvedAction[] {
  const resolved: ResolvedAction[] = [];
  for (const contribution of contributions) {
    if (contribution.property !== region.property || contribution.instance !== region.instance) continue;
    const manifest = plugins.find((plugin) => plugin.id === contribution.plugin);
    const owner = loaded.find((entry) => entry.manifest.id === contribution.plugin);
    const specifier = manifest?.contributes?.action_module;
    const run = specifier ? objectAction(owner?.modules.get(specifier)) : undefined;
    if (!run || !manifest) continue;
    const pressed = pressedApiFor(api, app, manifest.contributes?.hosts ?? []);
    resolved.push({
      plugin: contribution.plugin,
      action: contribution.value,
      property: region.property,
      instance: region.instance,
      run: () =>
        run({
          api: pressed,
          action: contribution.value,
          objectId,
          property: region.property,
          instance: region.instance,
        }),
    });
  }
  return resolved;
}
