/**
 * The second step, when somebody says a new object is a paper.
 *
 * The first consumer of the `forms` slot, and the reason the slot exists:
 * knowing that a paper has a DOI is this plugin's business and has no place in
 * the core. Nothing in `bridge::objects` mentions a DOI, and the values this
 * returns reach it as an opaque map.
 *
 * # It hands values over, it does not write them
 *
 * `onDone` returns what was filled in; the application writes it through
 * `object.create`. A plugin with a direct write would route around the review
 * that change sets exist for, which is why writing is on `APP_ONLY` and this
 * component never sees it.
 */

import { Button, FormControl, Stack, TextInput } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import { useState } from "react";

import type { FormProps } from "../../src/plugin-host/panel.js";
import { fieldsFrom, titleFrom } from "./paper.js";

export default function PaperForm({
  paths,
  initial,
  onDone,
}: FormProps): React.JSX.Element {
  // The filename is what the person already calls the thing, so it is the
  // honest default. A guess, offered — never written unless they keep it.
  const suggested = paths[0] ? titleFrom(paths[0].path) : "";

  const [doi, setDoi] = useState(initial["doi"] ?? "");
  const [title, setTitle] = useState(initial["title"] ?? suggested);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const done = (): void => {
    const result = fieldsFrom({ doi, title });
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }

    setProblem(undefined);
    onDone({ ok: true, values: result.values });
  };

  return (
    <Stack gap="condensed">
      <FormControl>
        <FormControl.Label>Title</FormControl.Label>
        <TextInput
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          block
        />
        <FormControl.Caption>
          Shared with whatever else names this object.
        </FormControl.Caption>
      </FormControl>

      <FormControl>
        <FormControl.Label>DOI</FormControl.Label>
        <TextInput
          value={doi}
          onChange={(event) => setDoi(event.target.value)}
          placeholder="10.1000/example"
          block
        />
        <FormControl.Caption>
          A bare id, a `doi:` prefix or a doi.org link all work.
        </FormControl.Caption>
      </FormControl>

      {problem && <InlineMessage variant="warning">{problem}</InlineMessage>}

      <Stack direction="horizontal" gap="condensed">
        <Button variant="primary" onClick={done}>
          Next
        </Button>
        {/* Leaving both blank is allowed: the property was still chosen, and
            `store::carried` keeps that decision whether or not it has values. */}
      </Stack>
    </Stack>
  );
}
