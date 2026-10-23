/**
 * The review screen: what was proposed, decided entry by entry.
 *
 * The one GitHub interaction the design copies on purpose. A set is a pull
 * request, an object is a file in its diff, a field is a hunk, and each is
 * accepted or declined on its own. "Accept additions" is the bulk action that
 * is always safe: it fills blanks and touches no decision already made.
 *
 * Until this screen existed a set waited where nothing could see it. Every
 * `import.propose` that disagreed with a value somebody chose opened one, and
 * the disagreement went nowhere.
 *
 * # Deciding is local, applying is not
 *
 * Each checkbox writes its decision through `changes.accept` at once, so a
 * review half done survives closing the window. Nothing reaches a field until
 * Apply, which writes every accepted entry in one transaction or none of them.
 * A field that moved in between is refused by name, and the refusal is shown
 * beside the entry it is about rather than as a line at the bottom.
 */

import { ActionList, Button, Checkbox, FormControl, Heading, Spinner, Stack, Text } from "@primer/react";
import { Blankslate, InlineMessage } from "@primer/react/experimental";
import { useEffect, useState } from "react";

import type { Api, AppApi, ChangeEntry, ChangeSetSummary } from "../plugin-host/commands.js";
import { describe, staleDetail, type Stale } from "./problem.js";
import { byObject, countsOf, decided, objectsOf, recount, wording, type ObjectChanges } from "./changeset.js";

// --- the pane: every set waiting -----------------------------------------

export interface ReviewListProps {
  readonly api: Api;
  /** Changes when the library does, so a scan's new set appears. */
  readonly generation: number;
  readonly selected: number | undefined;
  readonly onSelect: (set: number) => void;
}

export function ReviewList({ api, generation, selected, onSelect }: ReviewListProps): React.JSX.Element {
  const [sets, setSets] = useState<ChangeSetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  useEffect(() => {
    let current = true;
    setLoading(true);
    api
      .changesPending()
      .then((next) => {
        if (current) setSets(next);
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
  }, [api, generation]);

  if (problem) return <Text size="small">{problem}</Text>;
  if (loading) return <Spinner size="small" aria-label="Reading what is waiting" />;

  if (sets.length === 0) {
    return <Text size="small">Nothing is waiting for review.</Text>;
  }

  return (
    <ActionList selectionVariant="single">
      {sets.map((set) => (
        <ActionList.Item key={set.id} selected={set.id === selected} onSelect={() => onSelect(set.id)}>
          {set.label}
          <ActionList.Description variant="block">{countsOf(set)}</ActionList.Description>
        </ActionList.Item>
      ))}
    </ActionList>
  );
}

// --- the page: one set, decided -------------------------------------------

export interface ReviewPageProps {
  readonly api: Api;
  readonly app: AppApi;
  readonly set: number;
  /** The set was applied. The library changed; whoever owns it should re-read. */
  readonly onApplied: () => void;
}

export function ReviewPage({ api, app, set, onApplied }: ReviewPageProps): React.JSX.Element {
  const [summary, setSummary] = useState<ChangeSetSummary | undefined>(undefined);
  const [entries, setEntries] = useState<ChangeEntry[]>([]);
  const [groups, setGroups] = useState<ObjectChanges[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [stale, setStale] = useState<Stale | undefined>(undefined);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setProblem(undefined);
    setStale(undefined);

    const load = async (): Promise<void> => {
      const [pending, held] = await Promise.all([api.changesPending(), api.changesEntries(set)]);
      // Names come from the same call the object list uses. One call for
      // every object the set touches, not one per entry.
      const named = held.length > 0 ? await api.objectSummaries(objectsOf(held)) : [];
      if (!current) return;
      setSummary(pending.find((candidate) => candidate.id === set));
      setEntries(held);
      setGroups(byObject(held, named));
    };

    load()
      .catch((error: unknown) => {
        if (current) setProblem(describe(error));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [api, set]);

  // Every decision is written at once and reflected locally, so a review
  // half done survives closing the window and the screen does not refetch
  // the set on each click.
  const settle = (next: ChangeEntry[]): void => {
    setEntries(next);
    setGroups((held) =>
      held.map((group) => ({
        ...group,
        entries: next.filter((entry) => entry.object === group.object),
      })),
    );
    setSummary((held) => (held ? recount(held, next) : held));
  };

  const run = (work: () => Promise<void>): void => {
    setWorking(true);
    setProblem(undefined);
    setStale(undefined);
    work()
      .catch((error: unknown) => {
        const moved = staleDetail(error);
        if (moved) setStale(moved);
        setProblem(describe(error));
      })
      .finally(() => setWorking(false));
  };

  const decide = (change: number, accepted: boolean): void =>
    run(async () => {
      await app.changesAccept(change, accepted);
      settle(decided(entries, change, accepted));
    });

  const bulk = (work: () => Promise<unknown>): void =>
    run(async () => {
      await work();
      // A bulk action changes many rows by a rule the core owns; re-reading
      // is cheaper than reimplementing the rule here to predict the result.
      settle(await api.changesEntries(set));
    });

  const apply = (): void =>
    run(async () => {
      await app.changesApply(set);
      onApplied();
    });

  if (loading) return <Spinner aria-label="Reading the set" />;

  // A set that could not be read is not a set with nothing in it.
  if (problem && !summary) return <InlineMessage variant="critical">{problem}</InlineMessage>;

  if (!summary) {
    return (
      <Blankslate>
        <Blankslate.Heading>Nothing to review here</Blankslate.Heading>
        <Blankslate.Description>
          This set was applied or does not exist. Pick another from the pane.
        </Blankslate.Description>
      </Blankslate>
    );
  }

  return (
    <Stack gap="normal" padding="normal">
      <Stack gap="none">
        <Heading as="h2">{summary.label}</Heading>
        <Text size="small">{countsOf(summary)}</Text>
      </Stack>

      <Stack direction="horizontal" gap="condensed" wrap="wrap">
        <Button disabled={working} onClick={() => bulk(() => app.changesAcceptAdditions(set))}>
          Accept additions
        </Button>
        <Button disabled={working} onClick={() => bulk(() => app.changesAcceptAll(set, true))}>
          Accept all
        </Button>
        <Button disabled={working} onClick={() => bulk(() => app.changesAcceptAll(set, false))}>
          Decline all
        </Button>
        <Button variant="primary" disabled={working} onClick={apply}>
          Apply {summary.accepted} of {entries.length}
        </Button>
      </Stack>

      {problem && !stale && <InlineMessage variant="critical">{problem}</InlineMessage>}

      {groups.map((group) => (
        <Stack key={group.object} gap="condensed">
          <Heading as="h3">
            {group.name ?? <Text weight="light">Untitled</Text>}
          </Heading>
          {group.entries.map((entry) => (
            <Stack key={entry.id} gap="none">
              <FormControl disabled={working}>
                <Checkbox
                  checked={entry.accepted}
                  onChange={(event) => decide(entry.id, event.target.checked)}
                />
                <FormControl.Label>
                  {entry.field} <Text weight="light">{wording(entry)}</Text>
                </FormControl.Label>
                {entry.reason && <FormControl.Caption>{entry.reason}</FormControl.Caption>}
              </FormControl>
              {stale && stale.object === entry.object && stale.field === entry.field && (
                // Beside the entry it is about. A line at the bottom saying
                // "a field moved" sends the person hunting for which.
                <InlineMessage variant="warning">{problem}</InlineMessage>
              )}
            </Stack>
          ))}
        </Stack>
      ))}

      {entries.length === 0 && (
        <Text>This set proposes nothing. Applying it closes it.</Text>
      )}
    </Stack>
  );
}
