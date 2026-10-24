/**
 * Bringing the library's locations back in line with the disk.
 *
 * A plugin's scan adds. Between scans a person moves a product into another
 * category, renames a folder, deletes a zip they unpacked, and the library
 * goes on saying the thing is where it was. This is the button for that.
 *
 * What the core could prove it applied. What it could not -- a removal and
 * an addition sharing a name -- is a question, and the questions are drawn
 * here with a button each: the person knows whether they moved it.
 */

import { Button, Stack, Text } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import { useState } from "react";

import type { AppApi, Candidate, Rescanned } from "../plugin-host/commands.js";
import { describe } from "./problem.js";

export interface RescanProps {
  readonly app: AppApi;
  /** The library changed; whoever owns it should re-read. */
  readonly onChanged: () => void;
}

/** What a rescan did, in one line. */
export function summaryOf(result: Rescanned): string {
  const parts: string[] = [];
  if (result.moved > 0) parts.push(`${result.moved} moved`);
  if (result.touched > 0) parts.push(`${result.touched} changed`);
  if (result.removed > 0) parts.push(`${result.removed} gone`);
  if (result.added.length > 0) parts.push(`${result.added.length} new on disk`);
  if (result.unreadable.length > 0) parts.push(`${result.unreadable.length} unreadable`);
  return parts.length === 0 ? "the library matches the disk" : parts.join(", ");
}

export function Rescan({ app, onChanged }: RescanProps): React.JSX.Element {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Rescanned | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const rescan = (): void => {
    setRunning(true);
    setProblem(undefined);
    app
      .libraryReconcile()
      .then((next) => {
        setResult(next);
        if (next.moved + next.touched + next.removed > 0) onChanged();
      })
      .catch((error: unknown) => setProblem(describe(error)))
      .finally(() => setRunning(false));
  };

  // The rescan left the old location in place and asked. "Moved" moves it
  // whole -- the same row, the size and hash it had -- and "Not moved" is
  // the removal the rescan held back. Either way the question is answered
  // and the next rescan does not ask it again.
  const answer = (candidate: Candidate, moved: boolean): void => {
    setRunning(true);
    setProblem(undefined);
    (moved
      ? app.objectPathMove(candidate.object, candidate.from, candidate.to)
      : app.objectPathRemove(candidate.object, candidate.from)
    )
      .then(() => {
        setResult((held) =>
          held ? { ...held, candidates: held.candidates.filter((c) => c !== candidate) } : held,
        );
        onChanged();
      })
      .catch((error: unknown) => setProblem(describe(error)))
      .finally(() => setRunning(false));
  };

  return (
    <Stack gap="condensed">
      <Stack direction="horizontal" gap="condensed" align="center">
        <Button size="small" disabled={running} onClick={rescan}>
          {running ? "Rescanning…" : "Rescan"}
        </Button>
        {result && <Text size="small">{summaryOf(result)}</Text>}
      </Stack>

      {problem && <InlineMessage variant="critical">{problem}</InlineMessage>}

      {result && (result.added.length > 0 || result.moved > 0 || result.candidates.length > 0) && (
        // Where a thing is, the rescan records; what holds it is a plugin's
        // edge. A product moved into another category still sits under the
        // old one in the Library pane until the plugin's scan says otherwise.
        <Text size="small" weight="light">
          New paths are not objects, and a moved one is not re-grouped, until a plugin&apos;s scan says so.
        </Text>
      )}

      {result && result.candidates.length > 0 && (
        <Stack gap="condensed">
          <Text size="small" weight="semibold">
            Moved, or a different thing with the same name?
          </Text>
          {result.candidates.map((candidate) => (
            <Stack key={`${candidate.from}>${candidate.to}`} direction="horizontal" gap="condensed" align="center">
              <Text size="small">
                {candidate.from} → {candidate.to}
              </Text>
              <Button size="small" disabled={running} onClick={() => answer(candidate, true)}>
                Moved
              </Button>
              <Button size="small" disabled={running} onClick={() => answer(candidate, false)}>
                Not moved
              </Button>
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
