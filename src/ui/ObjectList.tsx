/**
 * What the library holds, as a navigable list.
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
 * # A page at a time, and one level at a time
 *
 * The library this was built for holds 1518 objects across 174 products.
 * Listing all of them flat is what makes a library impossible to organise —
 * most rows are files inside something the person actually thinks about.
 *
 * So the list shows what nothing contains and opens downwards. Which objects
 * contain which is a plugin's answer, recorded as `contains` edges: a library
 * whose plugin builds no hierarchy is entirely top level, which is the right
 * answer for one.
 */

import { ActionList, Button, Spinner, Stack, Text } from "@primer/react";
import { ChevronRightIcon } from "@primer/octicons-react";
import { useEffect, useState } from "react";

import type { Api, ObjectId, Summary } from "../plugin-host/commands.js";

/** How many rows to fetch at a time. */
const PAGE = 100;

/** One step of where the list has navigated to. */
export interface Crumb {
  readonly id: ObjectId;
  readonly name: string;
}

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

  // Where in the tree the list is looking. Empty means the top.
  const [trail, setTrail] = useState<Crumb[]>([]);
  const inside = trail[trail.length - 1]?.id ?? null;

  useEffect(() => {
    let current = true;
    setRows([]);
    setLoading(true);
    setProblem(undefined);

    page(api, null, inside)
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
  }, [api, generation, inside]);

  const more = (): void => {
    const last = rows[rows.length - 1];
    if (!last) return;

    setLoading(true);
    page(api, last.id, inside)
      .then((next) => setRows((held) => [...held, ...next.rows]))
      .catch((error: unknown) => setProblem(String(error)))
      .finally(() => setLoading(false));
  };

  if (problem) {
    return <Text size="small">{problem}</Text>;
  }

  const open = (row: Summary): void => {
    setTrail((held) => [...held, { id: row.id, name: row.name ?? "Untitled" }]);
  };

  return (
    <Stack gap="condensed">
      {trail.length > 0 && (
        <Stack direction="horizontal" gap="condensed" align="center">
          <Button onClick={() => setTrail((held) => held.slice(0, -1))}>Back</Button>
          <Text size="small">{trail[trail.length - 1]?.name}</Text>
        </Stack>
      )}

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
            {row.kind === "folder" && (
              <ActionList.TrailingAction
                label="Open"
                icon={ChevronRightIcon}
                onClick={(event: React.MouseEvent) => {
                  // Opening is not selecting. A person clicking a folder's
                  // name wants to see the folder; clicking the chevron wants
                  // to go inside it.
                  event.stopPropagation();
                  open(row);
                }}
              />
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
  within: ObjectId | null,
): Promise<{ rows: Summary[]; total: number }> {
  const ids = await api.objectIds(after, PAGE, within);
  // Two calls rather than one: ids come from the objects table and names from
  // the paths and values tables, and joining them in SQL would put the list's
  // shape into the store.
  const rows = ids.ids.length > 0 ? await api.objectSummaries(ids.ids) : [];
  return { rows, total: ids.total };
}
