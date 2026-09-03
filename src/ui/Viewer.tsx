/**
 * Where a viewer draws.
 *
 * `2026-09-01_viewer-extension-point.md` settles what a viewer is: given an
 * object and a rectangular region, render it. The plugin does not know whether
 * that region is embedded, covering the window, or somewhere else — presentation
 * is a host decision made at runtime.
 *
 * This is the host side of that. It picks the region, and a plugin that wanted
 * a say has nowhere to put the opinion: the manifest has no `mode` field and
 * the words "tab" and "window" appear nowhere in the plugin API.
 *
 * v1 offers two presentations, embedded and covering, because they share a
 * React tree and differ by a container's CSS. Separate windows are deferred:
 * they need a second React root and cross-window state, and none of that cost
 * is a viewer-extension-point question.
 */

import { Button, Stack, Text } from "@primer/react";
import { useState } from "react";

import type { Api, FlatObject } from "../plugin-host/commands.js";
import type { Loaded } from "../plugin-host/loader.js";
import { panelComponent, type Panel } from "../plugin-host/panel.js";
import type { Contribution, Mount } from "../plugin-host/slots.js";
import { viewersFor } from "../plugin-host/slots.js";
import type { Manifest } from "../plugin-host/types.js";

/** How much room a viewer is given. */
export type Extent = "inline" | "covering";

export interface ViewerProps {
  readonly api: Api;
  readonly object: FlatObject;
  readonly plugins: readonly Manifest[];
  readonly loaded: readonly Loaded[];
  readonly mounts: readonly Mount[];
}

export function Viewer({
  api,
  object,
  plugins,
  loaded,
  mounts,
}: ViewerProps): React.JSX.Element | null {
  const [extent, setExtent] = useState<Extent>("inline");
  const [chosen, setChosen] = useState<string | undefined>(undefined);

  const offered = viewersFor(plugins, object.carries, mounts);

  // More than one viewer on an object is normal — a PDF that is also a
  // product has two ways of being looked at — and the choice is the person's.
  // The first in mount order is only a default.
  //
  // An object nothing is scoped to falls out here rather than needing its own
  // guard: an empty list has no first entry, and most objects have no viewer.
  const showing = offered.find((v) => key(v) === chosen) ?? offered[0];
  if (!showing) return null;

  const Component = componentFor(showing, loaded);

  return (
    <Stack gap="condensed">
      <Stack direction="horizontal" gap="condensed" align="center">
        {offered.length > 1 &&
          offered.map((viewer) => (
            <Button
              key={key(viewer)}
              variant={key(viewer) === key(showing) ? "primary" : "default"}
              onClick={() => setChosen(key(viewer))}
            >
              {viewer.property}
            </Button>
          ))}

        <Button onClick={() => setExtent(extent === "inline" ? "covering" : "inline")}>
          {extent === "inline" ? "Fill the window" : "Shrink"}
        </Button>
      </Stack>

      <div
        style={
          extent === "covering"
            ? {
                position: "fixed",
                inset: 0,
                zIndex: 10,
                background: "var(--bgColor-default)",
                overflow: "auto",
              }
            : { height: "60vh", overflow: "auto" }
        }
      >
        {extent === "covering" && (
          <Button onClick={() => setExtent("inline")}>Close</Button>
        )}

        {Component ? (
          <Component
            api={api}
            objectId={object.id}
            property={showing.property}
            instance={showing.instance}
          />
        ) : (
          // The same stance the object page takes on a panel that will not
          // load: name the plugin rather than leave a gap nobody can explain.
          <Text size="small">{showing.plugin} could not be loaded</Text>
        )}
      </div>
    </Stack>
  );
}

/** What distinguishes one offered viewer from another. */
function key(viewer: Contribution): string {
  return `${viewer.plugin}:${viewer.property}#${viewer.instance}`;
}

/** The component a contribution names, if its module loaded and is one. */
function componentFor(
  contribution: Contribution,
  loaded: readonly Loaded[],
): Panel | undefined {
  const owner = loaded.find((entry) => entry.manifest.id === contribution.plugin);
  if (!owner) return undefined;
  return panelComponent(owner.modules.get(contribution.value));
}
