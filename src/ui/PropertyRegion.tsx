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
import { Button, ConfirmationDialog, Heading, Link, Stack, Text } from "@primer/react";
import { useState } from "react";

import type { Api, ObjectId, Region } from "../plugin-host/commands.js";
import type { Panel } from "../plugin-host/panel.js";
import { isFieldName } from "./edit.js";
import { FieldEditor, NewField } from "./FieldEditor.js";

/** An action offered in this region, ready to run. */
export interface ResolvedAction {
  readonly plugin: string;
  readonly action: string;
  /** The region it was offered in. */
  readonly property?: string;
  readonly instance?: number;
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
  /**
   * Fields the sidebar filters by. Their values are drawn as links that
   * narrow the grid to everything sharing the value.
   */
  readonly facets?: readonly string[] | undefined;
  /** A facet value was followed. */
  readonly onField?: ((name: string, value: string) => void) | undefined;
  /**
   * Clear everything this property instance says about the object, its own
   * fields and its shares of the common ones. Absent when it says nothing or
   * the page cannot write.
   */
  readonly onClearAll?: (() => Promise<void>) | undefined;
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
  facets,
  onField,
  onClearAll,
}: PropertyRegionProps): React.JSX.Element {
  const [clearing, setClearing] = useState(false);
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

  // A facet value reads as a link to everything else showing it: the
  // category on a product page is the quickest way to the rest of the shelf.
  const display = (name: string, value: string): React.ReactNode =>
    onField && facets?.includes(name) && value !== "" ? (
      <Link as="button" onClick={() => onField(name, value)}>
        {value}
      </Link>
    ) : undefined;

  const empty = fields.length === 0 && panels.length === 0 && !onSet;

  return (
    <section className="yk-region">
      <header className="yk-region-head">
        <Heading as="h2" variant="small">
          {regionTitle(region, instancesOfProperty)}
        </Heading>
        {onClearAll && (
          <Button size="small" variant="invisible" onClick={() => setClearing(true)}>
            Clear
          </Button>
        )}
        {clearing && onClearAll && (
          <ConfirmationDialog
            title={`Clear what ${regionTitle(region, instancesOfProperty)} says?`}
            confirmButtonContent="Clear"
            confirmButtonType="danger"
            onClose={(gesture) => {
              setClearing(false);
              if (gesture === "confirm") {
                onClearAll()
                  .then(() => onChanged?.())
                  .catch((error: unknown) => setSaid(error instanceof Error ? error.message : String(error)));
              }
            }}
          >
            Every value {regionTitle(region, instancesOfProperty)} recorded on this object is cleared: its own fields,
            and the title, price, picture or anything else it supplied. What a person typed, and what other sources
            say, stay. This is how a wrong fetch is undone.
          </ConfirmationDialog>
        )}
        {actions && actions.length > 0 && (
          <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
            {said && <Text size="small" className="yk-muted">{said}</Text>}
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
          </Stack>
        )}
      </header>

      <div className="yk-region-body">
        {fields.length > 0 && !onSet && (
          <div className="yk-fields">
            {fields.map(([name, value]) => (
              <div className="yk-field" key={name}>
                <span className="yk-field-label">{name}</span>
                <span className="yk-field-value">{display(name, value) ?? value}</span>
              </div>
            ))}
          </div>
        )}

        {onSet && (
          <div className="yk-fields">
            {fields.map(([name, value]) => (
              <FieldEditor
                key={name}
                label={name}
                display={display(name, value)}
                shown={value}
                own={value}
                onSave={(next) => onSet(name, next)}
              />
            ))}
            <NewField isName={isFieldName} onAdd={onSet} />
          </div>
        )}

        {panels.map(({ plugin, component: Panel }) =>
          Panel ? (
            <div className="yk-panel" key={plugin}>
              <Panel api={api} objectId={objectId} property={region.property} instance={region.instance} />
            </div>
          ) : (
            <InlineMessage key={plugin} variant="warning">
              {plugin} could not be loaded
            </InlineMessage>
          ),
        )}

        {empty && <Text size="small" className="yk-muted">Nothing recorded under this yet.</Text>}
      </div>
    </section>
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
