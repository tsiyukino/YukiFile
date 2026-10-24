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
}

export interface TransferProps {
  readonly app: AppApi;
  readonly dialogs: Dialogs;
  /** The library changed: something was imported. */
  readonly onChanged: () => void;
}

export function Transfer({ app, dialogs, onChanged }: TransferProps): React.JSX.Element {
  const [working, setWorking] = useState(false);
  const [said, setSaid] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const run = (work: () => Promise<string | undefined>): void => {
    setWorking(true);
    setProblem(undefined);
    work()
      .then((line) => setSaid(line))
      .catch((error: unknown) => setProblem(describe(error)))
      .finally(() => setWorking(false));
  };

  const exportLibrary = (): void =>
    run(async () => {
      const to = await dialogs.pickTarget();
      if (to === null) return undefined;
      const wrote = await app.libraryExportFile(to);
      const parts = [`${wrote.objects} objects`, `${wrote.terms} terms`];
      if (wrote.edges_left_out > 0) parts.push(`${wrote.edges_left_out} edges to pathless objects left out`);
      return `exported ${parts.join(", ")}`;
    });

  const importDocument = (): void =>
    run(async () => {
      const from = await dialogs.pickDocument();
      if (from === null) return undefined;
      const outcome = await app.libraryImportFile(from);
      const parts = [`${outcome.objects_created} added`, `${outcome.written} written`];
      if (outcome.unchanged > 0) parts.push(`${outcome.unchanged} unchanged`);
      if (outcome.pending !== null) parts.push("some need review");
      if (outcome.objects_created > 0 || outcome.written > 0) onChanged();
      return `imported: ${parts.join(", ")}`;
    });

  return (
    <Stack gap="condensed">
      <Stack direction="horizontal" gap="condensed" wrap="wrap">
        <Button size="small" disabled={working} onClick={importDocument}>
          Import…
        </Button>
        <Button size="small" disabled={working} onClick={exportLibrary}>
          Export…
        </Button>
      </Stack>
      {said && <Text size="small">{said}</Text>}
      {problem && <InlineMessage variant="critical">{problem}</InlineMessage>}
    </Stack>
  );
}
