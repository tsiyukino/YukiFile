/**
 * One property instance's region.
 *
 * The core places the region; the plugin scoped to that property draws inside
 * it. That is the whole of the arbitration reaching a screen — a plugin never
 * said where it wanted to be, only which property it belongs to.
 *
 * A region holds two things: the fields that plugin keeps to itself, and
 * whatever panels are scoped to the property. Both can be empty, and a region
 * with neither still renders its heading, because an object carrying `booth#1`
 * carries it whether or not anything has filled it in.
 */

import { InlineMessage } from "@primer/react/experimental";
import { Heading, Stack, Text } from "@primer/react";

import type { Api, ObjectId, Region } from "../plugin-host/commands.js";
import type { Panel } from "../plugin-host/panel.js";

/** A panel that belongs in this region, once resolved. */
export interface ResolvedPanel {
  readonly plugin: string;
  /** The component, or `undefined` when its module did not load. */
  readonly component: Panel | undefined;
}

export interface PropertyRegionProps {
  readonly api: Api;
  readonly objectId: ObjectId;
  readonly region: Region;
  readonly panels: readonly ResolvedPanel[];
  /**
   * How many instances of this property the object carries.
   *
   * Only used for the heading. Passed in because the answer depends on the
   * whole object, and a region cannot see its siblings.
   */
  readonly instancesOfProperty: number;
}

export function PropertyRegion({
  api,
  objectId,
  region,
  panels,
  instancesOfProperty,
}: PropertyRegionProps): React.JSX.Element {
  const fields = Object.entries(region.fields);

  return (
    <Stack gap="condensed">
      <Heading as="h2">{regionTitle(region, instancesOfProperty)}</Heading>

      {fields.length > 0 && (
        <Stack gap="none">
          {fields.map(([name, value]) => (
            <Text key={name} size="small">
              {name}: {value}
            </Text>
          ))}
        </Stack>
      )}

      {panels.map(({ plugin, component: Panel }) =>
        Panel ? (
          <Panel
            key={plugin}
            api={api}
            objectId={objectId}
            property={region.property}
            instance={region.instance}
          />
        ) : (
          // One plugin's panel failing must not take the region with it, let
          // alone the page. Saying which plugin is missing beats a gap nobody
          // can explain.
          <InlineMessage key={plugin} variant="warning">
            {plugin} could not be loaded
          </InlineMessage>
        ),
      )}
    </Stack>
  );
}

/**
 * What a region is called.
 *
 * The instance counter appears only when the object carries that property more
 * than once. On a single Booth listing `#1` is noise; on two listings the
 * number is the only thing telling them apart, and showing it on one but not
 * the other would be worse than showing neither.
 *
 * That decision needs every region on the object, not just this one, so the
 * count is passed in rather than guessed from the instance number.
 */
export function regionTitle(region: Region, instancesOfProperty: number): string {
  return instancesOfProperty > 1
    ? `${region.property} #${region.instance}`
    : region.property;
}
