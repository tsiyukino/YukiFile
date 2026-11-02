/**
 * Which library the window shows, and the way to another.
 *
 * The library's name at the top left opens a dialog: the libraries opened
 * before, each with a button to open it and one to take it off the list, and
 * **Open another library…**, which asks the operating system for a folder.
 * A dialog rather than a menu because each row carries two actions, and a
 * menu row may only be one. A folder that has never been a library
 * becomes one when opened; that is how a new library starts.
 *
 * Switching restarts the application into the chosen library
 * (`libraries.rs`), so a press does not come back here when it works. A
 * library on a drive that is not plugged in is listed, greyed: it will be
 * back, and dropping it would lose the path.
 */

import { Button, Dialog, IconButton, Label, Text } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import { FileDirectoryIcon, FileDirectoryOpenFillIcon, XIcon } from "@primer/octicons-react";
import { useEffect, useState } from "react";

import type { AppApi, RecentLibrary } from "../plugin-host/commands.js";
import { describe } from "./problem.js";
import type { Dialogs } from "./Transfer.js";

export interface LibrarySwitcherProps {
  readonly app: AppApi;
  readonly dialogs: Dialogs;
  /** Where the open library is, as the core reported it. */
  readonly root: string | undefined;
}

export function LibrarySwitcher({ app, dialogs, root }: LibrarySwitcherProps): React.JSX.Element {
  const [recent, setRecent] = useState<RecentLibrary[]>([]);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  // Read when the menu opens, so a library opened in another window shows.
  useEffect(() => {
    if (!open) return;
    app
      .libraryRecent()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, [app, open]);

  const current = recent.find((row) => row.current);
  const name = current?.name ?? (root ? nameOf(root) : "Library");

  const go = (path: string): void => {
    setSwitching(path);
    setProblem(undefined);
    // Resolves only when the switch failed: success restarts the window.
    app
      .librarySwitch(path)
      .catch((error: unknown) => {
        setProblem(describe(error));
        setSwitching(undefined);
      });
  };

  const forget = (row: RecentLibrary): void => {
    app
      .libraryRecentRemove(row.path)
      .then(() => setRecent((held) => held.filter((r) => r.path !== row.path)))
      .catch((error: unknown) => setProblem(describe(error)));
  };

  const choose = (): void => {
    dialogs
      .pickLibrary?.()
      .then((picked) => {
        if (picked) go(picked);
      })
      .catch((error: unknown) => setProblem(describe(error)));
  };

  return (
    <>
      <button
        type="button"
        className="yk-brand"
        aria-label={`Library: ${name}. Switch library`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className="yk-brand-name">Yukifile</span>
        <span className="yk-brand-root" title={root}>
          {name} ▾
        </span>
      </button>

      {open && (
        <Dialog
          title="Libraries"
          subtitle="Each is a folder; what Yukifile records about it lives in .yukifile inside it."
          width="large"
          onClose={() => setOpen(false)}
          footerButtons={
            dialogs.pickLibrary
              ? [{ buttonType: "primary", content: "Open another library…", onClick: choose, disabled: switching !== undefined }]
              : []
          }
        >
          <ul className="yk-libraries">
            {recent.map((row) => (
              <li key={row.path} className="yk-library-row" data-missing={row.exists ? undefined : "true"}>
                {row.current ? <FileDirectoryOpenFillIcon /> : <FileDirectoryIcon />}
                <div className="yk-library-text">
                  <span className="yk-library-name">{row.name}</span>
                  <span className="yk-mono yk-muted">{row.path}</span>
                </div>
                {row.current ? (
                  <Label variant="accent">Open now</Label>
                ) : row.exists ? (
                  <Button size="small" disabled={switching !== undefined} onClick={() => go(row.path)}>
                    Open {row.name}
                  </Button>
                ) : (
                  <Label variant="secondary">Not found</Label>
                )}
                {!row.current && (
                  <IconButton
                    icon={XIcon}
                    size="small"
                    variant="invisible"
                    aria-label={`Forget ${row.name} from this list`}
                    onClick={() => forget(row)}
                  />
                )}
              </li>
            ))}
          </ul>
          {switching && !problem && <Text size="small">Restarting into {switching}…</Text>}
          {problem && (
            <InlineMessage variant="critical">That library could not be opened: {problem}</InlineMessage>
          )}
          <Text size="small" className="yk-muted">
            Choosing a folder that has never been a library makes it one. Forgetting one takes it off this list
            and leaves the folder alone.
          </Text>
        </Dialog>
      )}
    </>
  );
}

function nameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
