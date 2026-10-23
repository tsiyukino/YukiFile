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

import { ActionList, FormControl, Heading, Select, Spinner, Stack, Text } from "@primer/react";
import { Blankslate } from "@primer/react/experimental";
import { useEffect, useState } from "react";

import type { Api, ObjectId, Pointer, Summary, Term } from "../plugin-host/commands.js";
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

      {loading ? (
        <Spinner size="small" aria-label="Reading the vocabulary" />
      ) : (
        <ActionList selectionVariant="single">
          {terms.map((term) => (
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
}

export function TermPage({ api, term, generation, onSelect }: TermPageProps): React.JSX.Element {
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
      const summaries = ids.length > 0 ? await api.objectSummaries(ids) : [];
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
    <Stack gap="normal" padding="normal">
      <Stack gap="none">
        <Heading as="h1">{label}</Heading>
        <Text size="small">
          {term.vocab}: {term.id}
        </Text>
        <Text size="small">{countWording(pointers)}</Text>
      </Stack>

      {byKind(pointers, names).map((group) => (
        <Stack key={group.kind} gap="condensed">
          <Heading as="h2">{group.kind}</Heading>
          <ActionList>
            {group.objects.map((object) => (
              <ActionList.Item key={object.id} onSelect={() => onSelect(object.id)}>
                {object.name ?? "Untitled"}
                {object.path && object.path !== object.name && (
                  <ActionList.Description variant="block">{object.path}</ActionList.Description>
                )}
              </ActionList.Item>
            ))}
          </ActionList>
        </Stack>
      ))}
    </Stack>
  );
}
