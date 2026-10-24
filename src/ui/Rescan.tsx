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

  // Confirming a move is a remove and an add on the same object, which keeps
  // everything hung on it. The kind comes from the rescan, which looked.
  const confirm = (candidate: Candidate): void => {
    setRunning(true);
    setProblem(undefined);
    app
      .objectPathRemove(candidate.object, candidate.from)
      .then(() => app.objectPathAdd(candidate.object, { path: candidate.to, kind: candidate.kind }))
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

      {result && result.added.length > 0 && (
        <Text size="small" weight="light">
          New paths are not objects until a plugin&apos;s scan says so.
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
              <Button size="small" disabled={running} onClick={() => confirm(candidate)}>
                Moved
              </Button>
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
