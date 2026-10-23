/**
 * What is on disk, one directory at a time, against what the library holds.
 *
 * The other half of the object list. That one shows what the library knows;
 * this one shows what the disk has, and marks the rows the library already
 * recorded so that what is left is what somebody might want to add.
 *
 * # One level, not the tree
 *
 * `fs.walk` with a depth of one. The seed library's root holds ten entries and
 * four hundred and forty-one below them, and drawing ten rows should not read
 * the rest. A folder is listed but not entered; opening it asks again.
 *
 * # The comparison lives in `disk.ts`
 *
 * The walk reports names relative to the directory walked and the library
 * stores paths from its root, and joining the two is where the one bug worth
 * guarding against sits. It is checked there, against the real library's
 * shape; this component only draws the answer.
 *
 * # A recorded row opens its object; a new one offers to add it
 *
 * Clicking does the thing a person most likely wants from each. The browser
 * is also a way of finding an object by where it sits, which the object list
 * cannot do once a plugin has grouped things differently from the disk.
 */

import { ActionList, Button, Checkbox, FormControl, Spinner, Stack, Text } from "@primer/react";
import { ChevronRightIcon, FileDirectoryIcon, FileIcon } from "@primer/octicons-react";
import { useEffect, useState } from "react";

import type { Api, ObjectId, PathAt } from "../plugin-host/commands.js";
import { pathOf, rowsFor, showing, type DiskRow } from "./disk.js";
import { sizeInWords } from "./ObjectPage.js";
import { describe } from "./problem.js";

export interface DiskBrowserProps {
  readonly api: Api;
  /** Changes when the library does, so recorded marks are re-read. */
  readonly generation: number;
  /** A recorded row was clicked: open the object behind it. */
  readonly onSelect: (id: ObjectId) => void;
  /** A new row was clicked: offer to make an object of it. */
  readonly onAdd: (at: PathAt) => void;
}

export function DiskBrowser({ api, generation, onSelect, onAdd }: DiskBrowserProps): React.JSX.Element {
  const [rows, setRows] = useState<DiskRow[]>([]);
  // Which object sits at each recorded path, for opening one.
  const [objects, setObjects] = useState<ReadonlyMap<string, ObjectId>>(new Map());
  const [hideKnown, setHideKnown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  // Where in the tree the browser is looking. Empty is the root.
  const [trail, setTrail] = useState<string[]>([]);
  const directory = pathOf(trail);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setProblem(undefined);

    // Both at once rather than the listing first and the marks after: a list
    // that draws unmarked and then marks itself is one where a person can
    // click "add" on something recorded in the half-second between.
    Promise.all([api.fsWalk(directory === "" ? null : directory, 1), api.pathList()])
      .then(([walked, known]) => {
        if (!current) return;
        setObjects(new Map(known.map((entry) => [entry.path, entry.object])));
        setRows(rowsFor(walked, directory, new Set(known.map((entry) => entry.path))));
      })
      .catch((error: unknown) => {
        if (current) setProblem(describe(error));
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [api, generation, directory]);

  if (problem) {
    return <Text size="small">{problem}</Text>;
  }

  const shown = showing(rows, hideKnown);
  const recorded = rows.filter((row) => row.known).length;

  const choose = (row: DiskRow): void => {
    const id = objects.get(row.path);
    if (row.known && id !== undefined) {
      onSelect(id);
    } else {
      onAdd({ path: row.path, kind: row.kind });
    }
  };

  return (
    <Stack gap="condensed">
      {trail.length > 0 && (
        <Stack direction="horizontal" gap="condensed" align="center">
          <Button onClick={() => setTrail((held) => held.slice(0, -1))}>Back</Button>
          <Text size="small">{trail[trail.length - 1]}</Text>
        </Stack>
      )}

      <Stack direction="horizontal" gap="normal" align="center" justify="space-between">
        <Text size="small" weight="semibold">
          {rows.length} {rows.length === 1 ? "entry" : "entries"}, {recorded} recorded
        </Text>
        <FormControl>
          <Checkbox checked={hideKnown} onChange={(event) => setHideKnown(event.target.checked)} />
          <FormControl.Label>Hide recorded</FormControl.Label>
        </FormControl>
      </Stack>

      <ActionList>
        {shown.map((row) => (
          <ActionList.Item key={row.path} onSelect={() => choose(row)}>
            <ActionList.LeadingVisual>
              {row.kind === "folder" ? <FileDirectoryIcon /> : <FileIcon />}
            </ActionList.LeadingVisual>
            {row.name}
            <ActionList.Description>{descriptionOf(row)}</ActionList.Description>
            {row.kind === "folder" && (
              <ActionList.TrailingAction
                label="Open"
                icon={ChevronRightIcon}
                onClick={(event: React.MouseEvent) => {
                  // Opening is not choosing, same as in the object list: the
                  // name is the thing, the chevron is what is inside it.
                  event.stopPropagation();
                  setTrail((held) => [...held, row.name]);
                }}
              />
            )}
          </ActionList.Item>
        ))}
      </ActionList>

      {loading && <Spinner size="small" aria-label="Reading the disk" />}

      {!loading && rows.length === 0 && <Text size="small">Nothing here.</Text>}
      {!loading && rows.length > 0 && shown.length === 0 && (
        <Text size="small">Everything here is recorded.</Text>
      )}
    </Stack>
  );
}

/**
 * What a row says beside its name.
 *
 * "recorded" for anything the library holds, because that is the one fact the
 * browser exists to show. A size for a new file, since it is what a person
 * looks at to tell a stub from the real thing; nothing for a new folder, which
 * has no size until it is walked.
 */
export function descriptionOf(row: DiskRow): string {
  if (row.known) return "recorded";
  return row.size === null ? "" : sizeInWords(row.size);
}
