/**
 * One shared field, with every source that claims it.
 *
 * A product sold on two shops has three titles and all three are true. The
 * architecture is explicit that reading returns sources rather than picking a
 * winner; this is where that reaches a screen. The first source is shown
 * because something has to be, and the rest are one click away, attributed.
 *
 * Hiding the others entirely would make the model invisible exactly where a
 * person needs it: the moment they wonder why the title is not what they typed
 * is the moment the answer has to be reachable.
 */

import { Button, Details, Label, Text, useDetails } from "@primer/react";

import type { Source } from "../plugin-host/commands.js";

export interface SourceListProps {
  readonly sources: readonly Source[];
  /**
   * The source this field is pinned to, if any: `gumroad#1`.
   *
   * A pin is the per-object override of mount order (`architecture.md`),
   * kept next to the value it changes with an obvious way to undo it. That
   * is this list.
   */
  readonly pinned?: string | undefined;
  /** Pin the field to a source, or `null` to take the pin off. */
  readonly onPin?: ((from: string | null) => void) | undefined;
}

/** Where a source came from, in words. */
export function attribution(source: Source): string {
  // A bare field was entered here, by a person. Naming it "bare" would be the
  // storage model leaking into a sentence somebody reads.
  return source.from ?? "entered here";
}

export function SourceList({ sources, pinned, onPin }: SourceListProps): React.JSX.Element | null {
  const { getDetailsProps } = useDetails({});

  const [first, ...rest] = sources;
  if (!first) return null;

  // One source has no order to override, so nothing to pin.
  if (rest.length === 0) {
    return <Text>{first.value}</Text>;
  }

  const pinControl = (source: Source): React.JSX.Element | null => {
    if (!onPin || source.from === null) return null;
    if (source.from === pinned) {
      return (
        <>
          <Label size="small">pinned</Label>{" "}
          <Button size="small" variant="invisible" onClick={() => onPin(null)}>
            Unpin
          </Button>
        </>
      );
    }
    return (
      <Button size="small" variant="invisible" onClick={() => onPin(source.from)}>
        Prefer
      </Button>
    );
  };

  return (
    <Details {...getDetailsProps()}>
      <summary>
        <Text>{first.value}</Text>{" "}
        <Text size="small" weight="light">
          and {rest.length} other {rest.length === 1 ? "source" : "sources"}
        </Text>
      </summary>
      <ul>
        {sources.map((source, index) => (
          // Sources are ordered, not identified: two shops can carry the same
          // title, so the value is not a key. Position is what distinguishes
          // them, and the list is rebuilt whenever it changes.
          <li key={`${source.from ?? ""}-${index}`}>
            <Text>{source.value}</Text>{" "}
            <Text size="small" weight="light">
              {attribution(source)}
            </Text>{" "}
            {pinControl(source)}
          </li>
        ))}
      </ul>
    </Details>
  );
}
