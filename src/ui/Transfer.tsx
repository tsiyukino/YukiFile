/**
 * The library in and out of a file.
 *
 * Export writes the whole library as a contract document; import reads one
 * through the same review every import gets, so a document that disagrees
 * with a value somebody chose opens a change set rather than overwriting.
 * The seed library came in this way from a shell; these are the buttons.
 *
 * The dialogs are injected. A component that opened one itself could only
 * be tested inside Tauri, and `invoke.ts` is the one door to the runtime.
 */

import { Button, Stack, Text } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import { useState } from "react";

import type { AppApi } from "../plugin-host/commands.js";
import { describe } from "./problem.js";

/** The two questions the operating system answers. */
export interface Dialogs {
  readonly pickDocument: () => Promise<string | null>;
  readonly pickTarget: () => Promise<string | null>;
  /** A folder to open as a library. Optional where nothing opens one. */
  readonly pickLibrary?: () => Promise<string | null>;
}

export interface TransferProps {
  readonly app: AppApi;
  readonly dialogs: Dialogs;
  /** The library changed: something was imported. */
  readonly onChanged: () => void;
}

/** What one transfer did, in a line, and whether the library changed. */
export interface Transferred {
  readonly line: string;
  readonly changed: boolean;
}

/**
 * Write the whole library to where the dialog says.
 *
 * `undefined` when the person closed the dialog: nothing happened, and there
 * is nothing to say about it.
 */
export async function exportLibrary(app: AppApi, dialogs: Dialogs): Promise<Transferred | undefined> {
  const to = await dialogs.pickTarget();
  if (to === null) return undefined;
  const wrote = await app.libraryExportFile(to);
  const parts = [`${wrote.objects} objects`, `${wrote.terms} terms`];
  if (wrote.edges_left_out > 0) parts.push(`${wrote.edges_left_out} edges to pathless objects left out`);
  return { line: `exported ${parts.join(", ")}`, changed: false };
}

/** Read a document the dialog names, through the same review every import gets. */
export async function importDocument(app: AppApi, dialogs: Dialogs): Promise<Transferred | undefined> {
  const from = await dialogs.pickDocument();
  if (from === null) return undefined;
  const outcome = await app.libraryImportFile(from);
  const parts = [`${outcome.objects_created} added`, `${outcome.written} written`];
  if (outcome.unchanged > 0) parts.push(`${outcome.unchanged} unchanged`);
  if (outcome.pending !== null) parts.push("some need review");
  return {
    line: `imported: ${parts.join(", ")}`,
    changed: outcome.objects_created > 0 || outcome.written > 0 || outcome.pending !== null,
  };
}

export function Transfer({ app, dialogs, onChanged }: TransferProps): React.JSX.Element {
  const [working, setWorking] = useState(false);
  const [said, setSaid] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const run = (work: () => Promise<Transferred | undefined>): void => {
    setWorking(true);
    setProblem(undefined);
    work()
      .then((done) => {
        setSaid(done?.line);
        if (done?.changed) onChanged();
      })
      .catch((error: unknown) => setProblem(describe(error)))
      .finally(() => setWorking(false));
  };

  return (
    <Stack gap="condensed">
      <Stack direction="horizontal" gap="condensed" wrap="wrap">
        <Button size="small" disabled={working} onClick={() => run(() => importDocument(app, dialogs))}>
          Import…
        </Button>
        <Button size="small" disabled={working} onClick={() => run(() => exportLibrary(app, dialogs))}>
          Export…
        </Button>
      </Stack>
      {said && <Text size="small">{said}</Text>}
      {problem && <InlineMessage variant="critical">{problem}</InlineMessage>}
    </Stack>
  );
}
