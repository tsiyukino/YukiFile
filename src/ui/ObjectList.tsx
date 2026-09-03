/**
 * What the library holds, as a list.
 *
 * `2026-09-01_ui-primer-not-github-clone.md` calls for a thumbnail grid, and
 * this is not that. Thumbnails are load-bearing there — the original problem
 * was not being able to tell what anything was without opening it — and the
 * decision is explicit that they get designed around rather than bolted on.
 * Nothing generates a thumbnail yet, and a grid of grey squares would be the
 * shape of that design with none of its value.
 *
 * A list is what the review screens use, so it is not a detour: when
 * thumbnails exist the grid goes beside this rather than replacing the work.
 *
 * # A page at a time
 *
 * The library this was built for holds 1518 objects. Asking for all of them to
 * draw a sidebar is the shape that stops working on somebody else's library
 * rather than on ours, so this pages by cursor and asks for more when the
 * person wants more.
 */

import { ActionList, Button, Spinner, Stack, Text } from "@primer/react";
import { useEffect, useState } from "react";

import type { Api, ObjectId, Summary } from "../plugin-host/commands.js";

/** How many rows to fetch at a time. */
const PAGE = 100;

export interface ObjectListProps {
  readonly api: Api;
  /** Which object the page is showing, so the list can mark it. */
  readonly selected: ObjectId | undefined;
  readonly onSelect: (id: ObjectId) => void;
  /**
   * Changes when the library does.
   *
   * A scan adds objects, and a list holding the previous page would keep
   * showing a library that no longer exists.
   */
  readonly generation: number;
}

export function ObjectList({
  api,
  selected,
  onSelect,
  generation,
}: ObjectListProps): React.JSX.Element {
  const [rows, setRows] = useState<Summary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  useEffect(() => {
    let current = true;
    setRows([]);
    setLoading(true);
    setProblem(undefined);

    page(api, null)
      .then((next) => {
        if (!current) return;
        setRows(next.rows);
        setTotal(next.total);
      })
      .catch((error: unknown) => {
        if (current) setProblem(String(error));
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [api, generation]);

  const more = (): void => {
    const last = rows[rows.length - 1];
    if (!last) return;

    setLoading(true);
    page(api, last.id)
      .then((next) => setRows((held) => [...held, ...next.rows]))
      .catch((error: unknown) => setProblem(String(error)))
      .finally(() => setLoading(false));
  };

  if (problem) {
    return <Text size="small">{problem}</Text>;
  }

  return (
    <Stack gap="condensed">
      <Text size="small" weight="semibold">
        {total} {total === 1 ? "object" : "objects"}
      </Text>

      <ActionList selectionVariant="single">
        {rows.map((row) => (
          <ActionList.Item
            key={row.id}
            selected={row.id === selected}
            onSelect={() => onSelect(row.id)}
          >
            {row.name ?? "Untitled"}
            {row.path && row.path !== row.name && (
              <ActionList.Description variant="block">{row.path}</ActionList.Description>
            )}
          </ActionList.Item>
        ))}
      </ActionList>

      {loading && <Spinner size="small" aria-label="Loading objects" />}

      {!loading && rows.length < total && (
        <Button onClick={more}>Show more</Button>
      )}
    </Stack>
  );
}

/** One page of rows, with what the library holds in total. */
async function page(
  api: Api,
  after: ObjectId | null,
): Promise<{ rows: Summary[]; total: number }> {
  const ids = await api.objectIds(after, PAGE);
  // Two calls rather than one: ids come from the objects table and names from
  // the paths and values tables, and joining them in SQL would put the list's
  // shape into the store.
  const rows = ids.ids.length > 0 ? await api.objectSummaries(ids.ids) : [];
  return { rows, total: ids.total };
}
