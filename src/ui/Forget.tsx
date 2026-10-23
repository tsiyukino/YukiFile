/**
 * Undoing a mis-click.
 *
 * `object.forget` removes an object and everything hung on it; the files on
 * disk are untouched. It is on `APP_ONLY` because a person deciding to forget
 * something is the review, and a plugin doing it on their behalf is not.
 *
 * Confirmed first, because what is forgotten is every value and edge the
 * object carried, and "the library manages what it knows, not the things"
 * is a sentence worth reading before pressing the button rather than after.
 */

import { Button, ConfirmationDialog, Text } from "@primer/react";
import { useState } from "react";

import type { AppApi, ObjectId } from "../plugin-host/commands.js";
import { describe } from "./problem.js";

export interface ForgetButtonProps {
  readonly app: AppApi;
  readonly object: ObjectId;
  /** What the object is called, for the question. */
  readonly name: string;
  readonly onForgotten: () => void;
}

export function ForgetButton({ app, object, name, onForgotten }: ForgetButtonProps): React.JSX.Element {
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const forget = (): void => {
    setWorking(true);
    setProblem(undefined);
    app
      .objectForget(object)
      .then(onForgotten)
      .catch((error: unknown) => setProblem(describe(error)))
      .finally(() => setWorking(false));
  };

  return (
    <>
      <Button variant="danger" disabled={working} onClick={() => setAsking(true)}>
        Forget
      </Button>
      {problem && <Text size="small">{problem}</Text>}
      {asking && (
        <ConfirmationDialog
          title={`Forget ${name}?`}
          confirmButtonContent="Forget"
          confirmButtonType="danger"
          onClose={(gesture) => {
            setAsking(false);
            if (gesture === "confirm") forget();
          }}
        >
          The library forgets what it recorded about this object: its
          properties, its values and where it sits. The files on disk are
          untouched.
        </ConfirmationDialog>
      )}
    </>
  );
}
