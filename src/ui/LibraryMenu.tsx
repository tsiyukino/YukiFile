/**
 * What can be done to the library as a whole, in one menu.
 *
 * The plugins' library actions (a scan is the usual one), the shell's own
 * rescan, and the library in and out of a file. They used to be a column of
 * buttons above the pane, where two long names pushed the one line saying
 * what a scan did out of sight. In a menu they take no room, and what each
 * did is reported above the grid where a person is looking.
 *
 * # Scanning lives in the plugins
 *
 * Deciding what counts as an object is domain knowledge, and the core has
 * none. A folder library, a VRChat library and a library of papers give three
 * different answers, so the answer arrives as a plugin. A library with no such
 * plugin can still be filled by hand from the Disk view.
 */

import { ActionList, ActionMenu, Dialog } from "@primer/react";
import { DownloadIcon, ImageIcon, PlayIcon, SyncIcon, UploadIcon } from "@primer/octicons-react";
import { useState } from "react";

import { pressedApiFor, type Api, type AppApi } from "../plugin-host/commands.js";
import type { Loaded } from "../plugin-host/loader.js";
import { libraryAction } from "../plugin-host/panel.js";
import type { Manifest } from "../plugin-host/types.js";
import { FindCovers } from "./FindCovers.js";
import { describe } from "./problem.js";
import { Rescan } from "./Rescan.js";
import { exportLibrary, importDocument, type Dialogs } from "./Transfer.js";

/** Something to tell the person, above the grid. */
export interface Report {
  readonly tone: "info" | "success" | "warning" | "critical";
  readonly title: string;
  readonly detail?: string | undefined;
}

/** Every library action the installed plugins offer. */
export function libraryActionsOf(plugins: readonly Manifest[]): Array<{ plugin: string; action: string }> {
  return plugins.flatMap((plugin) =>
    (plugin.contributes?.library_actions ?? []).map((action) => ({ plugin: plugin.id, action })),
  );
}

export interface LibraryMenuProps {
  readonly api: Api;
  readonly app: AppApi;
  readonly dialogs: Dialogs;
  readonly plugins: readonly Manifest[];
  readonly loaded: readonly Loaded[];
  /** Something finished, or started; say so. `undefined` clears. */
  readonly onReport: (report: Report | undefined) => void;
  /** The library changed: re-read it. */
  readonly onChanged: () => void;
}

export function LibraryMenu({ api, app, dialogs, plugins, loaded, onReport, onChanged }: LibraryMenuProps): React.JSX.Element {
  const [running, setRunning] = useState<string | undefined>(undefined);
  const [rescanning, setRescanning] = useState(false);
  const [covering, setCovering] = useState(false);
  const offered = libraryActionsOf(plugins);

  const runPlugin = (plugin: string, action: string): void => {
    const manifest = plugins.find((p) => p.id === plugin);
    const owner = loaded.find((entry) => entry.manifest.id === plugin);
    const specifier = manifest?.contributes?.library_action_module;
    const fn = specifier ? libraryAction(owner?.modules.get(specifier)) : undefined;

    if (!fn) {
      onReport({ tone: "critical", title: `${action} could not start`, detail: `${plugin} could not be loaded.` });
      return;
    }

    setRunning(action);
    onReport({ tone: "info", title: `Running ${action}…` });
    // The press lends the plugin the network, for the hosts it named.
    fn({ api: pressedApiFor(api, app, manifest?.contributes?.hosts ?? []), action })
      .then((outcome) => {
        onReport({ tone: "success", title: `${capitalised(action)} finished`, detail: outcome.summary });
        if (outcome.changed) onChanged();
      })
      .catch((error: unknown) => onReport({ tone: "critical", title: `${action} failed`, detail: describe(error) }))
      .finally(() => setRunning(undefined));
  };

  const transfer = (label: string, work: () => ReturnType<typeof exportLibrary>): void => {
    setRunning(label);
    work()
      .then((done) => {
        if (!done) return;
        onReport({ tone: "success", title: capitalised(done.line) });
        if (done.changed) onChanged();
      })
      .catch((error: unknown) => onReport({ tone: "critical", title: `${label} failed`, detail: describe(error) }))
      .finally(() => setRunning(undefined));
  };

  return (
    <>
      <ActionMenu>
        <ActionMenu.Button size="medium">{running ? `${capitalised(running)}…` : "Library"}</ActionMenu.Button>
        <ActionMenu.Overlay width="medium" align="end">
          <ActionList>
            {offered.length > 0 && (
              <ActionList.Group>
                <ActionList.GroupHeading>From plugins</ActionList.GroupHeading>
                {offered.map(({ plugin, action }) => (
                  <ActionList.Item
                    key={`${plugin}:${action}`}
                    disabled={running !== undefined}
                    onSelect={() => runPlugin(plugin, action)}
                  >
                    <ActionList.LeadingVisual>
                      <PlayIcon />
                    </ActionList.LeadingVisual>
                    {capitalised(action)}
                    <ActionList.Description variant="block">{plugin}</ActionList.Description>
                  </ActionList.Item>
                ))}
              </ActionList.Group>
            )}
            {offered.length > 0 && <ActionList.Divider />}
            <ActionList.Item onSelect={() => setRescanning(true)} disabled={running !== undefined}>
              <ActionList.LeadingVisual>
                <SyncIcon />
              </ActionList.LeadingVisual>
              Rescan disk…
              <ActionList.Description variant="block">Bring locations back in line with the disk</ActionList.Description>
            </ActionList.Item>
            <ActionList.Item onSelect={() => setCovering(true)} disabled={running !== undefined}>
              <ActionList.LeadingVisual>
                <ImageIcon />
              </ActionList.LeadingVisual>
              Find covers…
              <ActionList.Description variant="block">
                A picture from inside everything that has none yet
              </ActionList.Description>
            </ActionList.Item>
            <ActionList.Divider />
            <ActionList.Item
              disabled={running !== undefined}
              onSelect={() => transfer("import", () => importDocument(app, dialogs))}
            >
              <ActionList.LeadingVisual>
                <DownloadIcon />
              </ActionList.LeadingVisual>
              Import from file…
            </ActionList.Item>
            <ActionList.Item
              disabled={running !== undefined}
              onSelect={() => transfer("export", () => exportLibrary(app, dialogs))}
            >
              <ActionList.LeadingVisual>
                <UploadIcon />
              </ActionList.LeadingVisual>
              Export to file…
            </ActionList.Item>
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>

      {covering && <FindCovers api={api} app={app} onClose={() => setCovering(false)} onChanged={onChanged} />}

      {rescanning && (
        <Dialog title="Rescan disk" width="large" onClose={() => setRescanning(false)}>
          <Rescan app={app} onChanged={onChanged} />
        </Dialog>
      )}
    </>
  );
}

function capitalised(text: string): string {
  return text === "" ? text : text.charAt(0).toUpperCase() + text.slice(1);
}
