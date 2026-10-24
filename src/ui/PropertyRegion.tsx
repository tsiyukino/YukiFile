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
import { Button, Heading, Stack, Text } from "@primer/react";
import { useState } from "react";

import type { Api, ObjectId, Region } from "../plugin-host/commands.js";
import type { Panel } from "../plugin-host/panel.js";
import { isFieldName } from "./edit.js";
import { FieldEditor, NewField } from "./FieldEditor.js";

/** An action offered in this region, ready to run. */
export interface ResolvedAction {
  readonly plugin: string;
  readonly action: string;
  /** Run it. Resolves to one line and whether the library changed. */
  readonly run: () => Promise<{ summary: string; changed: boolean }>;
}

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
  /**
   * Write one of this region's fields, by bare name. Absent, the region is
   * read-only. The page spells the stored path; the region knows only names.
   */
  readonly onSet?: ((name: string, value: string) => Promise<void>) | undefined;
  /** Actions plugins offer on this property, as buttons. */
  readonly actions?: readonly ResolvedAction[] | undefined;
  /** An action said the library changed; whoever owns it should re-read. */
  readonly onChanged?: (() => void) | undefined;
}

export function PropertyRegion({
  api,
  objectId,
  region,
  panels,
  instancesOfProperty,
  onSet,
  actions,
  onChanged,
}: PropertyRegionProps): React.JSX.Element {
  const fields = Object.entries(region.fields);
  const [running, setRunning] = useState<string | undefined>(undefined);
  const [said, setSaid] = useState<string | undefined>(undefined);

  const press = (action: ResolvedAction): void => {
    setRunning(action.action);
    setSaid(undefined);
    action
      .run()
      .then((outcome) => {
        setSaid(outcome.summary);
        if (outcome.changed) onChanged?.();
      })
      .catch((error: unknown) => setSaid(error instanceof Error ? error.message : String(error)))
      .finally(() => setRunning(undefined));
  };

  return (
    <Stack gap="condensed">
      <Heading as="h2">{regionTitle(region, instancesOfProperty)}</Heading>

      {actions && actions.length > 0 && (
        // The press is what lends a plugin the network. Nothing on this page
        // reaches outside until one of these is pressed.
        <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
          {actions.map((action) => (
            <Button
              key={`${action.plugin}:${action.action}`}
              size="small"
              disabled={running !== undefined}
              onClick={() => press(action)}
            >
              {running === action.action ? `${action.action}…` : action.action}
            </Button>
          ))}
          {said && <Text size="small">{said}</Text>}
        </Stack>
      )}

      {fields.length > 0 && !onSet && (
        <Stack gap="none">
          {fields.map(([name, value]) => (
            <Text key={name} size="small">
              {name}: {value}
            </Text>
          ))}
        </Stack>
      )}

      {onSet && (
        <Stack gap="condensed">
          {fields.map(([name, value]) => (
            // A region's field is the plugin's own, so the value shown is the
            // value owned: Clear is always on offer.
            <FieldEditor key={name} label={name} shown={value} own={value} onSave={(next) => onSet(name, next)} />
          ))}
          <NewField isName={isFieldName} onAdd={onSet} />
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
