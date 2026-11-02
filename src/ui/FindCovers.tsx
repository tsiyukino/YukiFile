/**
 * The dialog that finds covers for the whole library (`coverHunt.ts`).
 *
 * Says what it will do before it does it, shows how far it got while it
 * runs, can be stopped, and says what it did. Nothing a person chose is
 * replaced, so running it twice is harmless: the second run looks only at
 * what the first could not cover.
 */

import { Button, Checkbox, Dialog, FormControl, ProgressBar, Stack, Text } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import { useRef, useState } from "react";

import type { Api, AppApi } from "../plugin-host/commands.js";
import { findCovers, type Hunted, type Progress } from "./coverHunt.js";
import { describe } from "./problem.js";

export interface FindCoversProps {
  readonly api: Api;
  readonly app: AppApi;
  readonly onClose: () => void;
  /** Covers were written: the grid should re-read. */
  readonly onChanged: () => void;
}

export function FindCovers({ api, app, onClose, onChanged }: FindCoversProps): React.JSX.Element {
  const [packages, setPackages] = useState(true);
  const [progress, setProgress] = useState<Progress | undefined>(undefined);
  const [result, setResult] = useState<Hunted | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const stop = useRef(false);

  const start = (): void => {
    stop.current = false;
    setRunning(true);
    setResult(undefined);
    setProblem(undefined);
    findCovers(api, app, { packages, stopped: () => stop.current, onProgress: setProgress })
      .then((done) => {
        setResult(done);
        if (done.found > 0) onChanged();
      })
      .catch((error: unknown) => setProblem(describe(error)))
      .finally(() => setRunning(false));
  };

  const percent = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  return (
    <Dialog
      title="Find covers"
      subtitle="For everything that has no cover yet, a picture from inside it."
      width="large"
      onClose={() => {
        stop.current = true;
        onClose();
      }}
      footerButtons={
        running
          ? [{ buttonType: "danger", content: "Stop", onClick: () => (stop.current = true) }]
          : [
              { buttonType: "default", content: result ? "Close" : "Cancel", onClick: onClose },
              { buttonType: "primary", content: result ? "Look again" : "Find covers", onClick: start },
            ]
      }
    >
      <Stack gap="normal">
        <Text size="small">
          Each object without a cover is looked through: pictures in its folder, pictures in its archives, and, if
          ticked, the previews Unity stores in its packages. The picture named most like a cover wins; texture maps
          never do. A cover anyone chose, or a shop provided, is left alone.
        </Text>
        <Text size="small" className="yk-muted">
          A cover found here is a guess: one a shop provides, fetched before or after, is shown instead, and a cover you
          pick yourself outranks both. A wrong guess can be cleared from the object&apos;s page.
        </Text>

        <FormControl disabled={running}>
          <Checkbox checked={packages} onChange={(event) => setPackages(event.target.checked)} />
          <FormControl.Label>Look inside Unity packages too</FormControl.Label>
          <FormControl.Caption>
            Slower: a package is read through to find its previews. Most products have no other picture.
          </FormControl.Caption>
        </FormControl>

        {progress && (
          <Stack gap="condensed">
            <ProgressBar progress={percent} aria-label="How far it got" />
            <Text size="small">
              {progress.done} of {progress.total} looked at · {progress.found} covers found
            </Text>
            {running && progress.current && (
              <Text size="small" className="yk-muted">
                Looking at {progress.current}
              </Text>
            )}
          </Stack>
        )}

        {result && (
          <InlineMessage variant={result.found > 0 ? "success" : "warning"}>
            {result.stopped ? "Stopped. " : ""}
            Found covers for {result.found} of {result.looked}.
            {result.looked - result.found - result.unreadable.length > 0 &&
              ` ${result.looked - result.found - result.unreadable.length} hold no picture that looks like a cover.`}
            {result.unreadable.length > 0 && ` ${result.unreadable.length} could not be read.`}
          </InlineMessage>
        )}

        {problem && <InlineMessage variant="critical">{problem}</InlineMessage>}
      </Stack>
    </Dialog>
  );
}
