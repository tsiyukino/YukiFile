/**
 * What an archive holds, on screen.
 *
 * The deciding is in `panel.ts` and stays there: `summarise` is a pure
 * function of a listing, tested without a DOM, and this only turns its answer
 * into elements. Splitting them is what lets the interesting question — which
 * of 4000 entries to show — be tested without rendering anything.
 *
 * This is the first plugin component, and it uses no privilege the core would
 * not give a third party: it is handed an `api` built from the allowlist, and
 * it imports nothing from the host beyond the panel contract.
 */

import { Label, Spinner, Stack, Text } from "@primer/react";
import { useEffect, useState } from "react";

import type { PanelProps } from "../../src/plugin-host/panel.js";
import { isProblem, open, type PanelState } from "./panel.js";

export default function ArchivePanel({ api, objectId }: PanelProps): React.JSX.Element {
  const [state, setState] = useState<PanelState | undefined>(undefined);

  useEffect(() => {
    let current = true;

    // The path lives on the object's fs instances, which the region does not
    // carry. Reading it here keeps the panel to one command and one concern.
    api
      .objectGet(objectId)
      .then((record) => {
        const path = record.values.find((value) => value.path.endsWith("/path"));
        if (!path) return { problem: "This object has no location on disk." };
        return open(api, path.value);
      })
      .then((next) => {
        // The object can change while a listing is in flight. Dropping a late
        // answer is the difference between a stale panel and a correct one.
        if (current) setState(next);
      })
      .catch((error: unknown) => {
        if (current) setState({ problem: String(error) });
      });

    return () => {
      current = false;
    };
  }, [api, objectId]);

  if (!state) return <Spinner aria-label="Reading the archive" />;

  if (isProblem(state)) {
    return <Text size="small">{state.problem}</Text>;
  }

  return (
    <Stack gap="condensed">
      <Text size="small">
        {state.files} {state.files === 1 ? "file" : "files"}
        {state.folders > 0 && `, ${state.folders} folders`} · {bytes(state.unpacked)}{" "}
        unpacked
      </Text>

      {state.escaping.length > 0 && (
        // Nothing is extracted, so these cannot overwrite anything today.
        // They are shown because the names reach a screen, and because
        // whoever adds an extract command needs to have seen them first.
        <Label variant="attention">
          {state.escaping.length} {state.escaping.length === 1 ? "entry" : "entries"}{" "}
          escape the archive root
        </Label>
      )}

      <Stack gap="none">
        {state.rows.map((row) => (
          <Text key={row.path} size="small">
            {row.path}
            {row.isDir ? "/" : ` · ${bytes(row.size)}`}
          </Text>
        ))}
      </Stack>

      {state.hidden > 0 && (
        <Text size="small" weight="light">
          and {state.hidden} more
        </Text>
      )}
    </Stack>
  );
}

/** A size a person can read. */
export function bytes(size: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Whole bytes stay whole; anything scaled gets one decimal, which is enough
  // to tell 1.2 GB from 1.9 GB and not so much that it reads as precision.
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}
