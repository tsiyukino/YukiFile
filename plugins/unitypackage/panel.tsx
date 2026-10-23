/**
 * A Unity package's contents, on screen.
 *
 * Same split as the archive panel: `panel.ts` decides, this draws. The one
 * thing worth a line of its own is the top-level folders, since that is where
 * a vendor's name sits and what a person searches a shop with.
 */

import { Label, Spinner, Stack, Text } from "@primer/react";
import { useEffect, useState } from "react";

import type { PanelProps } from "../../src/plugin-host/panel.js";
import { isProblem, open, type PanelState } from "./panel.js";

export default function UnityPackagePanel({ api, objectId }: PanelProps): React.JSX.Element {
  const [state, setState] = useState<PanelState | undefined>(undefined);

  useEffect(() => {
    let current = true;
    api
      .objectFlat(objectId)
      .then((object) => {
        const location = object.locations.find((at) => at.kind === "file");
        if (!location) return { problem: "This object has no file on disk." };
        return open(api, location.path);
      })
      .then((next) => {
        if (current) setState(next);
      })
      .catch((error: unknown) => {
        if (current) setState({ problem: String(error) });
      });
    return () => {
      current = false;
    };
  }, [api, objectId]);

  if (!state) return <Spinner aria-label="Reading the package" />;
  if (isProblem(state)) return <Text size="small">{state.problem}</Text>;

  return (
    <Stack gap="condensed">
      <Text size="small">
        {state.files} {state.files === 1 ? "asset" : "assets"}
        {state.folders > 0 && `, ${state.folders} folders`} · {bytes(state.unpacked)}
        {state.previews > 0 && ` · ${state.previews} with previews`}
      </Text>

      {state.top.length > 0 && (
        <Stack direction="horizontal" gap="condensed" wrap="wrap">
          {state.top.map((folder) => (
            <Label key={folder}>{folder}</Label>
          ))}
        </Stack>
      )}

      <Stack gap="none">
        {state.rows.map((row) => (
          <Text key={row.path} size="small">
            {row.path}
            {row.size === null ? "/" : ` · ${bytes(row.size)}`}
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

function bytes(size: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}
