/**
 * Changing many objects at once: the bar that appears while cards are
 * selected, and the two questions it asks.
 *
 * What can be set comes from the plugins, as the sidebar's groups do: each
 * field a plugin filters by can be set on everything selected, and each
 * vocabulary can be added to or taken from it. "These twelve are Hair" and
 * "these thirty fit Manuka" are the two sentences a person sorting a library
 * says most, and each is one command here (`bridge::bulk`), all or nothing.
 */

import { ActionList, Button, Dialog, FormControl, Stack, Text, TextInput } from "@primer/react";
import { PlusIcon, SearchIcon, TagIcon, XIcon } from "@primer/octicons-react";
import { InlineMessage } from "@primer/react/experimental";
import { useEffect, useState } from "react";

import type { Api, AppApi, Bulk, ObjectId, Term } from "../plugin-host/commands.js";
import { EDGE_KINDS } from "./edit.js";
import { headingFor } from "./filters.js";
import type { Report } from "./LibraryMenu.js";
import { describe } from "./problem.js";

/** What the bar asks about. */
type Asking =
  | { readonly kind: "field"; readonly field: string }
  | { readonly kind: "term"; readonly vocab: string; readonly removing: boolean };

export interface SelectionBarProps {
  readonly api: Api;
  readonly app: AppApi;
  readonly selected: ReadonlySet<ObjectId>;
  /** Fields and vocabularies the plugins offer. */
  readonly detail: { readonly fields: readonly string[]; readonly vocabularies: readonly string[] };
  readonly onClear: () => void;
  /** A change was made: report it, re-read, and let go of the selection. */
  readonly onDone: (report: Report) => void;
}

export function SelectionBar({ api, app, selected, detail, onClear, onDone }: SelectionBarProps): React.JSX.Element {
  const [asking, setAsking] = useState<Asking | undefined>(undefined);
  const ids = [...selected];
  const count = selected.size;

  return (
    <>
      <div className="yk-selection-bar" role="toolbar" aria-label="Change what is selected">
        <Text weight="semibold">
          {count} selected
        </Text>
        <div className="yk-selection-actions">
          {detail.fields.map((field) => (
            <Button key={field} size="small" onClick={() => setAsking({ kind: "field", field })}>
              Set {headingFor(field).toLowerCase()}…
            </Button>
          ))}
          {detail.vocabularies.map((vocab) => (
            <Button
              key={`add:${vocab}`}
              size="small"
              leadingVisual={PlusIcon}
              onClick={() => setAsking({ kind: "term", vocab, removing: false })}
            >
              Add {vocab}…
            </Button>
          ))}
          {detail.vocabularies.map((vocab) => (
            <Button
              key={`remove:${vocab}`}
              size="small"
              variant="invisible"
              onClick={() => setAsking({ kind: "term", vocab, removing: true })}
            >
              Remove {vocab}…
            </Button>
          ))}
        </div>
        <Button size="small" variant="invisible" leadingVisual={XIcon} onClick={onClear}>
          Clear selection
        </Button>
      </div>

      {asking?.kind === "field" && (
        <FieldDialog
          api={api}
          app={app}
          ids={ids}
          field={asking.field}
          onClose={() => setAsking(undefined)}
          onDone={(report) => {
            setAsking(undefined);
            onDone(report);
          }}
        />
      )}
      {asking?.kind === "term" && (
        <TermDialog
          api={api}
          app={app}
          ids={ids}
          vocab={asking.vocab}
          removing={asking.removing}
          onClose={() => setAsking(undefined)}
          onDone={(report) => {
            setAsking(undefined);
            onDone(report);
          }}
        />
      )}
    </>
  );
}

/** How a bulk change reads in a banner. */
export function saidOf(what: string, bulk: Bulk): string {
  if (bulk.changed === 0) {
    return `Nothing to change: all ${bulk.unchanged} ${bulk.unchanged === 1 ? "was" : "were"} already so`;
  }
  const parts = [`${what} on ${bulk.changed} ${bulk.changed === 1 ? "object" : "objects"}`];
  if (bulk.unchanged > 0) parts.push(`${bulk.unchanged} already so`);
  return parts.join(", ");
}

interface DialogProps {
  readonly api: Api;
  readonly app: AppApi;
  readonly ids: readonly ObjectId[];
  readonly onClose: () => void;
  readonly onDone: (report: Report) => void;
}

/** Set one field on everything selected, from the values already in use or a new one. */
function FieldDialog({ api, app, ids, field, onClose, onDone }: DialogProps & { readonly field: string }): React.JSX.Element {
  const [value, setValue] = useState("");
  const [known, setKnown] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const heading = headingFor(field);

  useEffect(() => {
    api
      .objectFacets({}, [field], [])
      .then((facets) =>
        setKnown(
          (facets.fields[0]?.values ?? []).flatMap((entry) => (entry.value === null ? [] : [entry.value])),
        ),
      )
      .catch(() => setKnown([]));
  }, [api, field]);

  const write = (next: string): void => {
    setWorking(true);
    setProblem(undefined);
    app
      .objectsFieldSet(ids, field, next)
      .then((bulk) =>
        onDone({ tone: "success", title: saidOf(next === "" ? `${heading} cleared` : `${heading} set to ${next}`, bulk) }),
      )
      .catch((error: unknown) => {
        setProblem(describe(error));
        setWorking(false);
      });
  };

  const needle = value.trim().toLowerCase();
  const offered = known.filter((entry) => needle === "" || entry.toLowerCase().includes(needle)).slice(0, 12);

  return (
    <Dialog
      title={`Set ${heading.toLowerCase()} on ${ids.length}`}
      onClose={onClose}
      width="medium"
      footerButtons={[
        { buttonType: "danger", content: `Clear ${heading.toLowerCase()}`, onClick: () => write(""), disabled: working },
        { buttonType: "default", content: "Cancel", onClick: onClose },
        { buttonType: "primary", content: "Set", onClick: () => write(value.trim()), disabled: working || value.trim() === "" },
      ]}
    >
      <Stack gap="condensed">
        <FormControl>
          <FormControl.Label>{heading}</FormControl.Label>
          <TextInput
            block
            autoFocus
            value={value}
            placeholder="A value in use, or a new one"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && value.trim() !== "") write(value.trim());
            }}
          />
        </FormControl>
        {offered.length > 0 && (
          <ActionList aria-label="Values in use" variant="inset">
            {offered.map((entry) => (
              <ActionList.Item key={entry} onSelect={() => setValue(entry)} active={entry === value}>
                {entry}
              </ActionList.Item>
            ))}
          </ActionList>
        )}
        {problem && <InlineMessage variant="critical">{problem}</InlineMessage>}
      </Stack>
    </Dialog>
  );
}

/** Point everything selected at a term, or stop pointing at it. */
function TermDialog({
  api,
  app,
  ids,
  vocab,
  removing,
  onClose,
  onDone,
}: DialogProps & { readonly vocab: string; readonly removing: boolean }): React.JSX.Element {
  const [terms, setTerms] = useState<Term[]>([]);
  const [typed, setTyped] = useState("");
  const [chosen, setChosen] = useState<Term | undefined>(undefined);
  const [kind, setKind] = useState("supports");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  useEffect(() => {
    api
      .termList(vocab)
      .then(setTerms)
      .catch((error: unknown) => setProblem(describe(error)));
  }, [api, vocab]);

  const apply = (): void => {
    if (!chosen) return;
    setWorking(true);
    setProblem(undefined);
    const target = { target: "term", vocab, term: chosen.id } as const;
    (removing ? app.objectsEdgeRemove(ids, kind, target) : app.objectsEdgeAdd(ids, kind, target))
      .then((bulk) =>
        onDone({
          tone: "success",
          title: saidOf(removing ? `${kind} ${chosen.label} removed` : `${kind} ${chosen.label} added`, bulk),
        }),
      )
      .catch((error: unknown) => {
        setProblem(describe(error));
        setWorking(false);
      });
  };

  const needle = typed.trim().toLowerCase();
  const shown = terms
    .filter((term) => needle === "" || term.label.toLowerCase().includes(needle) || term.id.includes(needle))
    .slice(0, 40);

  return (
    <Dialog
      title={`${removing ? "Remove" : "Add"} ${vocab} ${removing ? "from" : "to"} ${ids.length}`}
      onClose={onClose}
      width="medium"
      footerButtons={[
        { buttonType: "default", content: "Cancel", onClick: onClose },
        {
          buttonType: removing ? "danger" : "primary",
          content: chosen ? `${removing ? "Remove" : "Add"} ${chosen.label}` : removing ? "Remove" : "Add",
          onClick: apply,
          disabled: working || !chosen,
        },
      ]}
    >
      <Stack gap="condensed">
        <TextInput
          block
          autoFocus
          leadingVisual={SearchIcon}
          aria-label={`Find ${vocab}`}
          placeholder={`Find ${vocab}`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <div className="yk-term-pick">
          <ActionList selectionVariant="single" role="listbox" aria-label={vocab} variant="inset">
            {shown.map((term) => (
              <ActionList.Item key={term.id} selected={chosen?.id === term.id} onSelect={() => setChosen(term)}>
                <ActionList.LeadingVisual>
                  <TagIcon />
                </ActionList.LeadingVisual>
                {term.label}
                {term.label !== term.id && <ActionList.Description>{term.id}</ActionList.Description>}
              </ActionList.Item>
            ))}
          </ActionList>
          {shown.length === 0 && <Text size="small" className="yk-muted">No {vocab} matches.</Text>}
        </div>
        <FormControl>
          <FormControl.Label>Kind of link</FormControl.Label>
          <TextInput list="bulk-edge-kinds" value={kind} onChange={(event) => setKind(event.target.value)} />
          <datalist id="bulk-edge-kinds">
            {EDGE_KINDS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
          <FormControl.Caption>
            {removing ? "Only links of this kind are taken away." : "supports: it fits. owned: it is that one's own."}
          </FormControl.Caption>
        </FormControl>
        {problem && <InlineMessage variant="critical">{problem}</InlineMessage>}
      </Stack>
    </Dialog>
  );
}
