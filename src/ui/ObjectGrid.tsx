/**
 * What the library holds, as a grid of covers.
 *
 * `2026-09-01_ui-primer-not-github-clone.md`: the original problem was not
 * being able to tell what anything was without opening it, so thumbnails are
 * load-bearing and the main view is a grid of them.
 *
 * # Two ways of looking, one query
 *
 * With nothing chosen in the sidebar the grid is one level of the tree a
 * plugin built: the top, or inside whatever was opened, with a breadcrumb
 * trail back up. With something chosen it is flat, across the whole library,
 * because a match three groupings deep is as much a match as one at the top.
 * Both go through `object.query`, so the sort applies to either.
 *
 * Where the grid has walked to, how it is sorted and how large the cards are
 * belong to the shell, which keeps them while an object page is open. A
 * person who opened something from the third row of `Clothing` comes back to
 * `Clothing`, not to the top.
 */

import { ActionList, ActionMenu, Breadcrumbs, Button, IconButton, SegmentedControl, Spinner, Text, Token } from "@primer/react";
import { InfoIcon, SortAscIcon } from "@primer/octicons-react";
import { Blankslate } from "@primer/react/experimental";
import { useEffect, useRef, useState } from "react";

import type { Api, ObjectId, Sort, Summary } from "../plugin-host/commands.js";
import { CardGrid, type CardSize } from "./Card.js";
import { chipsOf, filterFor, isNarrowed, type Narrowing } from "./filters.js";
import { titleOf } from "./grid.js";
import { describe } from "./problem.js";

/** How many cards to fetch at a time. */
export const PAGE = 60;

/** One step of where the grid has walked to. */
export interface Crumb {
  readonly id: ObjectId;
  readonly name: string;
}

export const SORTS: readonly { readonly value: Sort; readonly label: string }[] = [
  { value: "name", label: "Name" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

const SIZES: readonly { readonly value: CardSize; readonly label: string }[] = [
  { value: "small", label: "S" },
  { value: "medium", label: "M" },
  { value: "large", label: "L" },
];

export interface ObjectGridProps {
  readonly api: Api;
  /** What the sidebar and the search box chose. */
  readonly narrowing: Narrowing;
  readonly onNarrow: (narrowing: Narrowing) => void;
  /** Where in the tree the grid is, top first. Ignored while narrowed. */
  readonly trail: readonly Crumb[];
  readonly onTrail: (trail: readonly Crumb[]) => void;
  readonly sort: Sort;
  readonly onSort: (sort: Sort) => void;
  readonly size: CardSize;
  readonly onSize: (size: CardSize) => void;
  /** Term ids to the names the sidebar showed, for the chips. */
  readonly labels: ReadonlyMap<string, string>;
  /** An object was chosen: show its page. */
  readonly onChoose: (id: ObjectId) => void;
  /** The object last opened, marked so the eye finds its place again. */
  readonly current?: ObjectId | undefined;
  /** Changes when the library does. */
  readonly generation: number;
}

export function ObjectGrid(props: ObjectGridProps): React.JSX.Element {
  const { api, narrowing, onNarrow, trail, onTrail, sort, onSort, size, onSize, labels, onChoose, current, generation } =
    props;

  const [rows, setRows] = useState<Summary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const narrowed = isNarrowed(narrowing);
  const inside = narrowed ? null : (trail[trail.length - 1]?.id ?? null);
  const filter = filterFor(narrowing, inside);
  // One string for the effect to compare: the filter is rebuilt every render.
  const key = JSON.stringify(filter);

  // The request a page answers. A slow first page arriving after a fast
  // second filter would otherwise draw the wrong library.
  const asked = useRef(0);

  useEffect(() => {
    const ticket = ++asked.current;
    setLoading(true);
    setProblem(undefined);
    page(api, JSON.parse(key) as typeof filter, sort, 0)
      .then((next) => {
        if (asked.current !== ticket) return;
        setRows(next.rows);
        setTotal(next.total);
      })
      .catch((error: unknown) => {
        if (asked.current === ticket) setProblem(describe(error));
      })
      .finally(() => {
        if (asked.current === ticket) setLoading(false);
      });
    // `filter` is `key` parsed; listing both would re-run on every render.
  }, [api, key, sort, generation]);

  const more = (): void => {
    if (loading) return;
    const ticket = asked.current;
    setLoading(true);
    page(api, filter, sort, rows.length)
      .then((next) => {
        if (asked.current !== ticket) return;
        setRows((held) => [...held, ...next.rows]);
        setTotal(next.total);
      })
      .catch((error: unknown) => {
        if (asked.current === ticket) setProblem(describe(error));
      })
      .finally(() => {
        if (asked.current === ticket) setLoading(false);
      });
  };

  // Reaching the bottom asks for the next page, as the button would. Not
  // every environment has the observer; the button is always there.
  const sentinel = useRef<HTMLDivElement>(null);
  const moreRef = useRef(more);
  moreRef.current = more;
  const short = rows.length < total;
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !short || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) moreRef.current();
      },
      { rootMargin: "600px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [short, rows.length]);

  const enter = (summary: Summary): void => onTrail([...trail, { id: summary.id, name: titleOf(summary) }]);

  // A grouping with no location is nothing but what it holds, so choosing
  // it goes in. Anything with a place on disk is a thing with a page.
  const choose = (summary: Summary): void => {
    if (summary.path === null && (summary.children ?? 0) > 0) enter(summary);
    else onChoose(summary.id);
  };

  const chips = chipsOf(narrowing, labels);
  const sortLabel = SORTS.find((s) => s.value === sort)?.label ?? "Name";
  const here = trail[trail.length - 1];

  return (
    <div>
      <div className="yk-grid-toolbar">
        <div className="yk-grid-title">
          {narrowed ? (
            <Text as="h2" weight="semibold" size="large" style={{ margin: 0 }}>
              Results
            </Text>
          ) : (
            <Breadcrumbs>
              <Breadcrumbs.Item
                href="#"
                selected={trail.length === 0}
                onClick={(event: React.MouseEvent) => {
                  event.preventDefault();
                  onTrail([]);
                }}
              >
                Library
              </Breadcrumbs.Item>
              {trail.map((crumb, index) => (
                <Breadcrumbs.Item
                  key={crumb.id}
                  href="#"
                  selected={index === trail.length - 1}
                  onClick={(event: React.MouseEvent) => {
                    event.preventDefault();
                    onTrail(trail.slice(0, index + 1));
                  }}
                >
                  {crumb.name}
                </Breadcrumbs.Item>
              ))}
            </Breadcrumbs>
          )}
          <span className="yk-grid-count">
            {total} {total === 1 ? "object" : "objects"}
          </span>
        </div>

        {!narrowed && here && (
          <IconButton
            icon={InfoIcon}
            size="small"
            variant="invisible"
            aria-label={`Details of ${here.name}`}
            onClick={() => onChoose(here.id)}
          />
        )}

        <ActionMenu>
          <ActionMenu.Button size="small" leadingVisual={SortAscIcon}>
            {sortLabel}
          </ActionMenu.Button>
          <ActionMenu.Overlay width="small">
            <ActionList selectionVariant="single" aria-label="Sort by">
              {SORTS.map((option) => (
                <ActionList.Item key={option.value} selected={option.value === sort} onSelect={() => onSort(option.value)}>
                  {option.label}
                </ActionList.Item>
              ))}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>

        <SegmentedControl aria-label="Card size" size="small" onChange={(index) => onSize(SIZES[index]?.value ?? "medium")}>
          {SIZES.map((option) => (
            <SegmentedControl.Button key={option.value} selected={option.value === size} aria-label={`${option.value} cards`}>
              {option.label}
            </SegmentedControl.Button>
          ))}
        </SegmentedControl>
      </div>

      {chips.length > 0 && (
        <div className="yk-chips" aria-label="Chosen filters">
          {chips.map((chip) => (
            <Token
              key={chip.key}
              text={chip.label}
              size="large"
              onRemove={() => onNarrow(chip.remove(narrowing))}
            />
          ))}
          <Button size="small" variant="invisible" onClick={() => onNarrow({ text: "", properties: [], fields: [], terms: [] })}>
            Clear all
          </Button>
        </div>
      )}

      {problem ? (
        <Text>{problem}</Text>
      ) : !loading && rows.length === 0 ? (
        <div className="yk-empty">
          <Blankslate>
            <Blankslate.Heading>
              {narrowed ? "Nothing matches" : trail.length > 0 ? "Nothing inside" : "This library holds no objects yet"}
            </Blankslate.Heading>
            <Blankslate.Description>
              {narrowed
                ? "Nothing in the library has everything chosen. Remove a filter to widen it."
                : trail.length > 0
                  ? "This holds nothing the library has recorded."
                  : "Scan it from the Library menu, if an installed plugin offers to, or add something by hand from the Disk view. Another library opens from its name at the top left."}
            </Blankslate.Description>
          </Blankslate>
        </div>
      ) : (
        <CardGrid
          api={api}
          rows={rows}
          size={size}
          current={current}
          label={narrowed ? "Results" : (here?.name ?? "Library")}
          onChoose={choose}
          onOpen={narrowed ? undefined : enter}
        />
      )}

      <div ref={sentinel} />
      {loading && (
        <div className="yk-grid-more">
          <Spinner size="small" aria-label="Loading objects" />
        </div>
      )}
      {!loading && !problem && short && (
        <div className="yk-grid-more">
          <Button onClick={more}>Show more</Button>
        </div>
      )}
    </div>
  );
}

/** One page of cards, with how many match in all. */
async function page(
  api: Api,
  filter: Parameters<Api["objectQuery"]>[0],
  sort: Sort,
  offset: number,
): Promise<{ rows: Summary[]; total: number }> {
  const found = await api.objectQuery(filter, sort, offset, PAGE);
  const rows = found.ids.length > 0 ? await api.objectSummaries(found.ids) : [];
  // Summaries come back in the order asked, but nothing promises it; the
  // query's order is the one the person chose.
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    rows: found.ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    }),
    total: found.total,
  };
}
