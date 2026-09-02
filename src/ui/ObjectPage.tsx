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
 * None of that is decided here. The page's own job is small: put the shared
 * fields at the top, then one region per property instance, in the order the
 * library mounts them.
 */

import { Blankslate, InlineMessage } from "@primer/react/experimental";
import { Heading, Spinner, Stack, Text } from "@primer/react";

import type { Api, FlatObject, Region } from "../plugin-host/commands.js";
import type { Contribution, Mount } from "../plugin-host/slots.js";
import { panelsFor } from "../plugin-host/slots.js";
import { panelComponent, type Panel } from "../plugin-host/panel.js";
import type { Loaded } from "../plugin-host/loader.js";
import type { Manifest } from "../plugin-host/types.js";
import { PropertyRegion, type ResolvedPanel } from "./PropertyRegion.js";
import { SourceList } from "./SourceList.js";

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
}

export function ObjectPage({
  api,
  object,
  plugins,
  loaded,
  mounts,
}: ObjectPageProps): React.JSX.Element {
  if (!object) {
    return <Spinner aria-label="Loading the object" />;
  }

  const carried = object.regions.map((r) => `${r.property}#${r.instance}`);
  const contributions = panelsFor(plugins, carried, mounts);
  const counts = instanceCounts(object.regions);

  const headline = object.shared[HEADLINE];
  const otherFields = Object.entries(object.shared).filter(([name]) => name !== HEADLINE);

  return (
    <Stack gap="normal" padding="normal">
      <Stack gap="none">
        {headline ? (
          <Heading as="h1">
            <SourceList sources={headline} />
          </Heading>
        ) : (
          // An object with no title is normal -- a scan finds files before
          // anybody names them -- so this is a placeholder, not a warning.
          <Heading as="h1">
            <Text weight="light">Untitled</Text>
          </Heading>
        )}
      </Stack>

      {otherFields.length > 0 && (
        <Stack gap="condensed">
          {otherFields.map(([name, sources]) => (
            <Stack key={name} gap="none">
              <Text size="small" weight="semibold">
                {name}
              </Text>
              <SourceList sources={sources} />
            </Stack>
          ))}
        </Stack>
      )}

      {object.regions.map((region) => (
        <PropertyRegion
          key={`${region.property}#${region.instance}`}
          api={api}
          objectId={object.id}
          region={region}
          instancesOfProperty={counts.get(region.property) ?? 1}
          panels={panelsIn(region, contributions, loaded)}
        />
      ))}

      {object.regions.length === 0 && Object.keys(object.shared).length === 0 && (
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
    </Stack>
  );
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
