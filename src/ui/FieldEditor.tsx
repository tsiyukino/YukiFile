/**
 * One field, read until a person wants to write.
 *
 * Shows the value; a pencil turns it into a box with Save and Cancel, and
 * Clear when the person has a value of their own to take back. Used for the
 * shared fields a page draws itself and for the fields inside a region, with
 * the caller deciding which stored path the value goes to.
 *
 * # Two values, not one
 *
 * `shown` is what the page displays — for a shared field that may be a shop's
 * title. `own` is what the person themselves wrote, if anything. Editing
 * starts from `shown`, because that is what they are looking at; Clear is
 * offered only when `own` exists, because clearing a shop's value is not a
 * thing a person can do from here, and a button that does nothing is worse
 * than none.
 */

import { Button, FormControl, IconButton, Stack, Text, TextInput } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import { PencilIcon } from "@primer/octicons-react";
import { useState } from "react";

import { describe } from "./problem.js";

export interface FieldEditorProps {
  readonly label: string;
  /** What is displayed. Undefined for an empty field. */
  readonly shown: string | undefined;
  /** The person's own value for the field, if they wrote one. */
  readonly own: string | undefined;
  /** Write the value. Empty clears. */
  readonly onSave: (value: string) => Promise<void>;
}

export function FieldEditor({ label, shown, own, onSave }: FieldEditorProps): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const begin = (): void => {
    setDraft(shown ?? "");
    setProblem(undefined);
    setEditing(true);
  };

  const save = (value: string): void => {
    setWorking(true);
    setProblem(undefined);
    onSave(value)
      .then(() => setEditing(false))
      .catch((error: unknown) => setProblem(describe(error)))
      .finally(() => setWorking(false));
  };

  if (!editing) {
    return (
      <Stack direction="horizontal" gap="condensed" align="center">
        <Text size="small">
          {label}: {shown ?? <Text weight="light">empty</Text>}
        </Text>
        <IconButton
          icon={PencilIcon}
          aria-label={`Edit ${label}`}
          size="small"
          variant="invisible"
          onClick={begin}
        />
      </Stack>
    );
  }

  return (
    <Stack gap="condensed">
      <FormControl>
        <FormControl.Label>{label}</FormControl.Label>
        <TextInput
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save(draft);
            if (event.key === "Escape") setEditing(false);
          }}
          block
        />
      </FormControl>
      {problem && <InlineMessage variant="critical">{problem}</InlineMessage>}
      <Stack direction="horizontal" gap="condensed">
        <Button variant="primary" size="small" disabled={working} onClick={() => save(draft)}>
          Save
        </Button>
        <Button size="small" disabled={working} onClick={() => setEditing(false)}>
          Cancel
        </Button>
        {own !== undefined && (
          <Button size="small" variant="danger" disabled={working} onClick={() => save("")}>
            Clear
          </Button>
        )}
      </Stack>
    </Stack>
  );
}

export interface NewFieldProps {
  /** Write a new field. Refused names never reach it. */
  readonly onAdd: (name: string, value: string) => Promise<void>;
  /** Whether a typed name is one. */
  readonly isName: (name: string) => boolean;
}

/**
 * A name and a value, for a field that does not exist yet.
 *
 * The generic escape hatch: a plugin's form is the right way to fill a region
 * in, and until a plugin has one, this is how a person records a category on
 * a thing they are looking at.
 */
export function NewField({ onAdd, isName }: NewFieldProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  if (!open) {
    return (
      <Button size="small" onClick={() => setOpen(true)}>
        Add field
      </Button>
    );
  }

  const add = (): void => {
    if (!isName(name)) {
      setProblem(`${name === "" ? "a field" : `"${name}"`} needs a name with no spaces, / or #`);
      return;
    }
    setWorking(true);
    setProblem(undefined);
    onAdd(name, value)
      .then(() => {
        setOpen(false);
        setName("");
        setValue("");
      })
      .catch((error: unknown) => setProblem(describe(error)))
      .finally(() => setWorking(false));
  };

  return (
    <Stack gap="condensed">
      <Stack direction="horizontal" gap="condensed">
        <FormControl>
          <FormControl.Label>Field</FormControl.Label>
          <TextInput value={name} onChange={(event) => setName(event.target.value)} />
        </FormControl>
        <FormControl>
          <FormControl.Label>Value</FormControl.Label>
          <TextInput value={value} onChange={(event) => setValue(event.target.value)} />
        </FormControl>
      </Stack>
      {problem && <InlineMessage variant="warning">{problem}</InlineMessage>}
      <Stack direction="horizontal" gap="condensed">
        <Button variant="primary" size="small" disabled={working} onClick={add}>
          Add
        </Button>
        <Button size="small" disabled={working} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </Stack>
    </Stack>
  );
}
