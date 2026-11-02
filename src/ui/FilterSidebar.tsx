/**
 * What there is to narrow the grid by, with how many of each.
 *
 * The groups come from the plugins: each manifest's `facets` names fields
 * worth counting and its `vocabularies` names term lists. The core counts
 * them with `object.facets`. The sidebar adds nothing of its own except the
 * types every object carries, which is the one grouping the core knows.
 *
 * # Counts say what a click would add
 *
 * A group's numbers are counted with that group's own choices set aside, so
 * ticking `Clothing` leaves `Hair` showing how many hair products there are
 * rather than dropping to zero. What is chosen stays at the top of its group
 * and stays visible however long the list, so a choice can always be taken
 * back where it was made.
 */

import { ActionList, Button, CounterLabel, TextInput } from "@primer/react";
import { ChevronDownIcon, ChevronRightIcon, SearchIcon } from "@primer/octicons-react";
import { useEffect, useMemo, useState } from "react";

import type { Api, Facets } from "../plugin-host/commands.js";
import type { Manifest } from "../plugin-host/types.js";
import {
  facetsOf,
  filterFor,
  hasField,
  hasProperty,
  hasTerm,
  headingFor,
  isNarrowed,
  toggleField,
  toggleProperty,
  toggleTerm,
  valueLabel,
  type Narrowing,
} from "./filters.js";
import { describe } from "./problem.js";

/** How many rows a group shows before offering the rest. */
const SHOWN = 8;

/** A group long enough to need a box to type into. */
const SEARCHABLE = 12;

export interface FilterSidebarProps {
  readonly api: Api;
  readonly plugins: readonly Manifest[];
  readonly narrowing: Narrowing;
  readonly onNarrow: (narrowing: Narrowing) => void;
  /** Term ids to labels, as counted, so chips can name what they hold. */
  readonly onLabels?: (labels: ReadonlyMap<string, string>) => void;
  readonly generation: number;
}

/** One row a group draws. */
interface Row {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly chosen: boolean;
  readonly toggle: () => void;
}

export function FilterSidebar({ api, plugins, narrowing, onNarrow, onLabels, generation }: FilterSidebarProps): React.JSX.Element {
  const offered = useMemo(() => facetsOf(plugins), [plugins]);
  const [facets, setFacets] = useState<Facets | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  // Counted against what is chosen, never against where the grid has walked:
  // the sidebar describes the library, and a narrowed grid is flat anyway.
  const filter = filterFor(narrowing, null);
  const key = JSON.stringify([filter, offered]);

  useEffect(() => {
    let live = true;
    setProblem(undefined);
    const [askedFilter, askedOffered] = JSON.parse(key) as [typeof filter, typeof offered];
    api
      .objectFacets(isNarrowed(narrowing) ? askedFilter : {}, askedOffered.fields, askedOffered.vocabularies)
      .then((next) => {
        if (!live) return;
        setFacets(next);
        const labels = new Map<string, string>();
        for (const vocab of next.vocabularies) {
          for (const term of vocab.terms) labels.set(`${vocab.vocab}:${term.id}`, term.label);
        }
        onLabels?.(labels);
      })
      .catch((error: unknown) => {
        if (live) setProblem(describe(error));
      });
    return () => {
      live = false;
    };
    // `narrowing` only decides between `{}` and the filter, which `key` holds.
  }, [api, key, generation]);

  if (problem) return <p className="yk-muted" style={{ padding: "0 8px" }}>{problem}</p>;
  if (!facets) return <p className="yk-muted" style={{ padding: "0 8px" }}>Counting…</p>;

  const groups: { key: string; heading: string; rows: Row[] }[] = [];

  for (const field of facets.fields) {
    const rows: Row[] = field.values.map((entry) => ({
      key: entry.value ?? "\u0000",
      label: valueLabel(entry.value),
      count: entry.count,
      chosen: hasField(narrowing, field.field, entry.value),
      toggle: () => onNarrow(toggleField(narrowing, field.field, entry.value)),
    }));
    // A choice the counts no longer mention -- other groups excluded all of
    // it -- is still narrowing the grid, and has to be there to untick.
    for (const clause of narrowing.fields) {
      if (clause.field !== field.field) continue;
      if (rows.some((row) => row.key === (clause.value ?? "\u0000"))) continue;
      rows.push({
        key: clause.value ?? "\u0000",
        label: valueLabel(clause.value),
        count: 0,
        chosen: true,
        toggle: () => onNarrow(toggleField(narrowing, field.field, clause.value)),
      });
    }
    // A field nothing holds yet would be a group of one "Not set" row.
    if (rows.every((row) => row.key === "\u0000" && !row.chosen)) continue;
    groups.push({ key: `field:${field.field}`, heading: headingFor(field.field), rows });
  }

  for (const vocab of facets.vocabularies) {
    const rows: Row[] = vocab.terms.map((term) => ({
      key: term.id,
      label: term.label,
      count: term.count,
      chosen: hasTerm(narrowing, vocab.vocab, term.id),
      toggle: () => onNarrow(toggleTerm(narrowing, vocab.vocab, term.id)),
    }));
    for (const clause of narrowing.terms) {
      if (clause.vocab !== vocab.vocab || rows.some((row) => row.key === clause.term)) continue;
      rows.push({
        key: clause.term,
        label: clause.term,
        count: 0,
        chosen: true,
        toggle: () => onNarrow(toggleTerm(narrowing, vocab.vocab, clause.term)),
      });
    }
    if (rows.length === 0) continue;
    groups.push({ key: `vocab:${vocab.vocab}`, heading: headingFor(vocab.vocab), rows });
  }

  const types: Row[] = facets.properties.map((entry) => ({
    key: entry.property,
    label: entry.property,
    count: entry.count,
    chosen: hasProperty(narrowing, entry.property),
    toggle: () => onNarrow(toggleProperty(narrowing, entry.property)),
  }));
  if (types.length > 0) groups.push({ key: "types", heading: "Type", rows: types });

  return (
    <div aria-label="Filters" role="region">
      {groups.map((group) => (
        <Group key={group.key} heading={group.heading} rows={group.rows} />
      ))}
    </div>
  );
}

/** One heading and its rows, chosen ones first. */
function Group({ heading, rows }: { readonly heading: string; readonly rows: readonly Row[] }): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const [typed, setTyped] = useState("");

  const needle = typed.trim().toLowerCase();
  const ordered = [...rows.filter((row) => row.chosen), ...rows.filter((row) => !row.chosen)];
  const matching = needle === "" ? ordered : ordered.filter((row) => row.chosen || row.label.toLowerCase().includes(needle));
  const shown = all || needle !== "" ? matching : matching.slice(0, Math.max(SHOWN, rows.filter((r) => r.chosen).length));
  const hidden = matching.length - shown.length;
  const chosen = rows.filter((row) => row.chosen).length;

  return (
    <section className="yk-facet">
      <button type="button" className="yk-facet-heading" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        {open ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
        <span>{heading}</span>
        {chosen > 0 && <CounterLabel scheme="primary">{chosen}</CounterLabel>}
      </button>

      {open && (
        <>
          {rows.length > SEARCHABLE && (
            <div className="yk-facet-search">
              <TextInput
                size="small"
                block
                leadingVisual={SearchIcon}
                placeholder={`Filter ${heading.toLowerCase()}`}
                aria-label={`Filter ${heading.toLowerCase()}`}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            </div>
          )}
          <ActionList
            selectionVariant="multiple"
            // Primer marks a chosen row only inside a listbox; without the
            // role the row is chosen and its checkbox says otherwise.
            role="listbox"
            aria-multiselectable="true"
            aria-label={heading}
            variant="inset"
            showDividers={false}
          >
            {shown.map((row) => (
              <ActionList.Item key={row.key} selected={row.chosen} onSelect={row.toggle} size="medium">
                <span className={row.key === "\u0000" ? "yk-muted" : undefined}>{row.label}</span>
                <ActionList.TrailingVisual>
                  <span className="yk-facet-count">{row.count}</span>
                </ActionList.TrailingVisual>
              </ActionList.Item>
            ))}
          </ActionList>
          {matching.length === 0 && <p className="yk-muted yk-facet-note">No match.</p>}
          {hidden > 0 && (
            <Button size="small" variant="invisible" className="yk-facet-more" onClick={() => setAll(true)}>
              Show {hidden} more
            </Button>
          )}
          {all && needle === "" && matching.length > SHOWN && (
            <Button size="small" variant="invisible" className="yk-facet-more" onClick={() => setAll(false)}>
              Show fewer
            </Button>
          )}
        </>
      )}
    </section>
  );
}
