/**
 * Vocabularies, their terms, and what points at each.
 *
 * The seed library references 73 avatars and owns 21 bases. An avatar is a
 * term, not an object, which is why "what fits Manuka?" has somewhere to be
 * answered even for an avatar nobody owns -- and why the answer comes from
 * what the library holds rather than from a shop page.
 *
 * The pane lists the library's vocabularies and the terms in one of them.
 * The page shows one term: every object pointing at it, grouped by the kind
 * of edge, each a way into the object. A plugin will draw its own avatar
 * page in time; this is the framework's, and it shows the model.
 */

import { ActionList, Button, FormControl, Heading, Select, Spinner, Stack, Text, TextInput } from "@primer/react";
import { FilterIcon, SearchIcon } from "@primer/octicons-react";
import { Blankslate } from "@primer/react/experimental";
import { useEffect, useState } from "react";

import type { Api, ObjectId, Pointer, Summary, Term } from "../plugin-host/commands.js";
import { CardGrid } from "./Card.js";
import { headingFor } from "./filters.js";
import { PageHead } from "./PageHead.js";
import { describe } from "./problem.js";
import { byKind, countWording, objectsPointing } from "./vocabulary.js";

/** One term, named by where it lives. */
export interface TermRef {
  readonly vocab: string;
  readonly id: string;
}

// --- the pane -----------------------------------------------------------

export interface TermListProps {
  readonly api: Api;
  readonly generation: number;
  readonly selected: TermRef | undefined;
  readonly onSelect: (term: TermRef) => void;
}

export function TermList({ api, generation, selected, onSelect }: TermListProps): React.JSX.Element {
  const [vocabularies, setVocabularies] = useState<string[]>([]);
  const [vocab, setVocab] = useState<string | undefined>(undefined);
  const [terms, setTerms] = useState<Term[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    let current = true;
    api
      .termVocabularies()
      .then((found) => {
        if (!current) return;
        setVocabularies(found);
        // Keep the choice across a re-read when it still exists; otherwise
        // the first one, which is the only one a fresh library can show.
        setVocab((held) => (held && found.includes(held) ? held : found[0]));
      })
      .catch((error: unknown) => {
        if (current) setProblem(describe(error));
      });
    return () => {
      current = false;
    };
  }, [api, generation]);

  useEffect(() => {
    if (vocab === undefined) {
      setTerms([]);
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    api
      .termList(vocab)
      .then((found) => {
        if (current) setTerms(found);
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
  }, [api, generation, vocab]);

  if (problem) return <Text size="small">{problem}</Text>;

  if (vocabularies.length === 0) {
    return (
      <Text size="small">
        This library holds no vocabulary yet. An import brings them in.
      </Text>
    );
  }

  return (
    <Stack gap="condensed">
      <FormControl>
        <FormControl.Label>Vocabulary</FormControl.Label>
        <Select value={vocab ?? ""} onChange={(event) => setVocab(event.target.value)} block>
          {vocabularies.map((name) => (
            <Select.Option key={name} value={name}>
              {name}
            </Select.Option>
          ))}
        </Select>
      </FormControl>

      <TextInput
        size="small"
        block
        leadingVisual={SearchIcon}
        placeholder={`Filter ${vocab ?? "terms"}`}
        aria-label="Filter terms"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />

      {loading ? (
        <Spinner size="small" aria-label="Reading the vocabulary" />
      ) : (
        <ActionList selectionVariant="single" role="listbox" aria-label={vocab ?? "Terms"} variant="inset">
          {terms
            .filter((term) => {
              // A label and its id both: an avatar is typed in whichever
              // script the person thinks of it in.
              const needle = typed.trim().toLowerCase();
              return needle === "" || term.label.toLowerCase().includes(needle) || term.id.includes(needle);
            })
            .map((term) => (
            <ActionList.Item
              key={term.id}
              selected={selected?.vocab === term.vocab && selected.id === term.id}
              onSelect={() => onSelect({ vocab: term.vocab, id: term.id })}
            >
              {term.label}
              {term.label !== term.id && <ActionList.Description>{term.id}</ActionList.Description>}
            </ActionList.Item>
          ))}
        </ActionList>
      )}
    </Stack>
  );
}

// --- the page -----------------------------------------------------------

export interface TermPageProps {
  readonly api: Api;
  readonly term: TermRef;
  readonly generation: number;
  /** An object in the list was chosen: open it. */
  readonly onSelect: (id: ObjectId) => void;
  /** Show everything pointing at the term in the grid, with its filters. */
  readonly onShowInGrid?: ((term: TermRef) => void) | undefined;
  /** What cards say under their names. */
  readonly detail?: { readonly fields: readonly string[]; readonly vocabularies: readonly string[] } | undefined;
}

export function TermPage({ api, term, generation, onSelect, onShowInGrid, detail }: TermPageProps): React.JSX.Element {
  const [label, setLabel] = useState<string | undefined>(undefined);
  const [pointers, setPointers] = useState<Pointer[]>([]);
  const [names, setNames] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setProblem(undefined);

    const read = async (): Promise<void> => {
      const [terms, found] = await Promise.all([api.termList(term.vocab), api.termObjects(term.vocab, term.id)]);
      const ids = objectsPointing(found);
      // On a term's own page, its vocabulary would say the same term on
      // every card; the fields still say what each thing is.
      const summaries = ids.length > 0 ? await api.objectSummaries(ids, detail?.fields ?? [], []) : [];
      if (!current) return;
      setLabel(terms.find((candidate) => candidate.id === term.id)?.label);
      setPointers(found);
      setNames(summaries);
    };

    read()
      .catch((error: unknown) => {
        if (current) setProblem(describe(error));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [api, term.vocab, term.id, generation]);

  if (loading) return <Spinner aria-label="Reading the term" />;
  if (problem) return <Text>{problem}</Text>;

  if (label === undefined) {
    // The vocabulary no longer holds it. A page that drew an empty list
    // would read as "nothing fits it", which is a different fact.
    return (
      <Blankslate>
        <Blankslate.Heading>No such term</Blankslate.Heading>
        <Blankslate.Description>
          {term.vocab} no longer holds {term.id}. Pick another from the pane.
        </Blankslate.Description>
      </Blankslate>
    );
  }

  return (
    <div>
      <PageHead
        title={label}
        detail={
          <>
            {headingFor(term.vocab)} · <span className="yk-mono">{term.id}</span> · <span>{countWording(pointers)}</span>
          </>
        }
      >
        {onShowInGrid && pointers.length > 0 && (
          <Button leadingVisual={FilterIcon} onClick={() => onShowInGrid(term)}>
            Show in the grid
          </Button>
        )}
      </PageHead>

      <Stack gap="spacious">
        {byKind(pointers, names).map((group) => (
          <Stack key={group.kind} gap="condensed">
            <Heading as="h2" variant="small">
              {group.kind}
            </Heading>
            <CardGrid api={api} rows={group.objects} size="small" label={group.kind} onChoose={(row) => onSelect(row.id)} />
          </Stack>
        ))}
      </Stack>
    </div>
  );
}
