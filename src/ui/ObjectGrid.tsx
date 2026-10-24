/**
 * What the library holds, as a grid of covers.
 *
 * `2026-09-01_ui-primer-not-github-clone.md`: the original problem was not
 * being able to tell what anything was without opening it, so thumbnails are
 * load-bearing and the main view is a grid of them. This is that view, now
 * that covers exist to draw.
 *
 * The same shape as the list it replaces: a page at a time, one level at a
 * time, with a grouping opened by its own control rather than by selecting
 * it. A card without a cover draws what the thing is on disk, so a grid of
 * freshly scanned products is still legible before anyone picks a picture.
 */

import { Button, Spinner, Stack, Text } from "@primer/react";
import {
  ChevronRightIcon,
  FileDirectoryIcon,
  FileIcon,
  FileMediaIcon,
  FileZipIcon,
  PackageIcon,
  StackIcon,
} from "@primer/octicons-react";
import { useEffect, useState } from "react";

import type { Api, ObjectId, Summary } from "../plugin-host/commands.js";
import "./grid.css";
import { pathUnder, placeholderFor, titleOf, type Placeholder } from "./grid.js";

/** How many cards to fetch at a time. */
const PAGE = 60;

/** One step of where the grid has navigated to. */
export interface Crumb {
  readonly id: ObjectId;
  readonly name: string;
}

export interface ObjectGridProps {
  readonly api: Api;
  readonly selected: ObjectId | undefined;
  readonly onSelect: (id: ObjectId) => void;
  /** Changes when the library does. */
  readonly generation: number;
}

/** The icon a placeholder draws. */
const ICONS: Record<Placeholder, React.ComponentType<{ size?: number }>> = {
  folder: FileDirectoryIcon,
  package: PackageIcon,
  archive: FileZipIcon,
  image: FileMediaIcon,
  document: FileIcon,
  file: FileIcon,
  grouping: StackIcon,
};

/**
 * A cover's URL, fetched once per path and shared across cards.
 *
 * `file.url` is a command per file; a page of sixty cards asks sixty times
 * on first draw and never again for the same path.
 */
const urls = new Map<string, Promise<string>>();
function urlFor(api: Api, path: string): Promise<string> {
  let held = urls.get(path);
  if (!held) {
    held = api.fileUrl(path);
    urls.set(path, held);
  }
  return held;
}

function Card({
  api,
  summary,
  current,
  onSelect,
  onOpen,
}: {
  readonly api: Api;
  readonly summary: Summary;
  readonly current: boolean;
  readonly onSelect: () => void;
  readonly onOpen: (() => void) | undefined;
}): React.JSX.Element {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const cover = summary.cover ?? null;

  useEffect(() => {
    let live = true;
    setUrl(undefined);
    if (!cover) return;
    urlFor(api, cover)
      .then((next) => {
        if (live) setUrl(next);
      })
      .catch(() => {
        // A cover whose file is gone draws the placeholder.
        if (live) setUrl(undefined);
      });
    return () => {
      live = false;
    };
  }, [api, cover]);

  const Icon = ICONS[placeholderFor(summary)];
  const under = pathUnder(summary);

  return (
    <li>
      <button type="button" className="yk-card" aria-current={current ? "true" : undefined} onClick={onSelect}>
        <div className="yk-cover" aria-hidden={url ? undefined : "true"}>
          {url ? <img src={url} alt="" loading="lazy" /> : <Icon size={32} />}
        </div>
        <div className="yk-card-foot">
          <div style={{ minWidth: 0 }}>
            <div className="yk-card-name">{titleOf(summary)}</div>
            {under && <div className="yk-card-path">{under}</div>}
          </div>
          {onOpen && (
            <Button
              size="small"
              variant="invisible"
              aria-label={`Open ${titleOf(summary)}`}
              leadingVisual={ChevronRightIcon}
              onClick={(event: React.MouseEvent) => {
                // Opening is not selecting: the name is the thing, the
                // chevron is what is inside it.
                event.stopPropagation();
                onOpen();
              }}
            />
          )}
        </div>
      </button>
    </li>
  );
}

export function ObjectGrid({ api, selected, onSelect, generation }: ObjectGridProps): React.JSX.Element {
  const [rows, setRows] = useState<Summary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  // Where in the tree the grid is looking. Empty means the top.
  const [trail, setTrail] = useState<Crumb[]>([]);
  const inside = trail[trail.length - 1]?.id ?? null;

  useEffect(() => {
    let live = true;
    setRows([]);
    setLoading(true);
    setProblem(undefined);
    page(api, null, inside)
      .then((next) => {
        if (!live) return;
        setRows(next.rows);
        setTotal(next.total);
      })
      .catch((error: unknown) => {
        if (live) setProblem(String(error));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
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

  if (problem) return <Text size="small">{problem}</Text>;

  return (
    <Stack gap="normal" padding="normal">
      <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
        {trail.length > 0 && <Button onClick={() => setTrail((held) => held.slice(0, -1))}>Back</Button>}
        <Text weight="semibold">{trail.length > 0 ? trail[trail.length - 1]?.name : "Library"}</Text>
        <Text size="small">
          {total} {total === 1 ? "object" : "objects"}
        </Text>
      </Stack>

      {!loading && rows.length === 0 && (
        <Text>{trail.length > 0 ? "Nothing inside." : "This library holds no objects yet."}</Text>
      )}

      <ul className="yk-grid">
        {rows.map((row) => (
          <Card
            key={row.id}
            api={api}
            summary={row}
            current={row.id === selected}
            onSelect={() => onSelect(row.id)}
            onOpen={
              row.kind === "folder" || row.path === null
                ? () => setTrail((held) => [...held, { id: row.id, name: titleOf(row) }])
                : undefined
            }
          />
        ))}
      </ul>

      {loading && <Spinner size="small" aria-label="Loading objects" />}
      {!loading && rows.length < total && <Button onClick={more}>Show more</Button>}
    </Stack>
  );
}

/** One page of rows, with what the library holds in total. */
async function page(api: Api, after: ObjectId | null, within: ObjectId | null): Promise<{ rows: Summary[]; total: number }> {
  const ids = await api.objectIds(after, PAGE, within);
  const rows = ids.ids.length > 0 ? await api.objectSummaries(ids.ids) : [];
  return { rows, total: ids.total };
}
