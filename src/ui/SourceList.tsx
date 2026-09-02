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

import { Details, Text, useDetails } from "@primer/react";

import type { Source } from "../plugin-host/commands.js";

export interface SourceListProps {
  readonly sources: readonly Source[];
}

/** Where a source came from, in words. */
export function attribution(source: Source): string {
  // A bare field was entered here, by a person. Naming it "bare" would be the
  // storage model leaking into a sentence somebody reads.
  return source.from ?? "entered here";
}

export function SourceList({ sources }: SourceListProps): React.JSX.Element | null {
  const { getDetailsProps } = useDetails({});

  const [first, ...rest] = sources;
  if (!first) return null;

  if (rest.length === 0) {
    return <Text>{first.value}</Text>;
  }

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
            </Text>
          </li>
        ))}
      </ul>
    </Details>
  );
}
