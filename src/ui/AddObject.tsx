/**
 * Making an object out of something on disk.
 *
 * Two steps, and the second one belongs to plugins. First a person says what
 * the thing is — zero or more semantic properties, from the list the installed
 * plugins declare. Then each plugin whose property was chosen gets to ask for
 * what it needs, one form at a time, and the application writes the lot
 * through `object.create`.
 *
 * # Choosing nothing is a choice
 *
 * A folder somebody wants recorded is an object whether or not any plugin
 * claims to know what it is. The picker lists what *could* be said about it;
 * saying nothing records it as what it observably is, which is what a scan
 * would have done.
 *
 * # Forms run in sequence, and going back keeps what was typed
 *
 * `FormProps.initial` exists for this. A person who filled in a DOI, went back
 * to add a second property, and came forward again should find the DOI still
 * there. Cancelling discards everything, which is the reason
 * `2026-09-11_choosing-a-type-is-storable.md` gives for why people confirm with
 * blank forms rather than cancel — so a blank form has to keep its property,
 * and `newObjectFrom` makes sure it does.
 */

import { Button, Checkbox, CheckboxGroup, FormControl, Heading, Stack, Text } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import { useState } from "react";

import type { Api, AppApi, ObjectId, PathAt } from "../plugin-host/commands.js";
import type { Loaded } from "../plugin-host/loader.js";
import { formComponent } from "../plugin-host/panel.js";
import { choosable, formsFor } from "../plugin-host/picker.js";
import type { Contribution, Mount } from "../plugin-host/slots.js";
import type { Manifest } from "../plugin-host/types.js";
import { nameOf, newObjectFrom, wording, type Collected } from "./add.js";
import { describe } from "./problem.js";

export interface AddObjectProps {
  /** What the forms are handed. Built from the allowlist, so a form cannot write. */
  readonly api: Api;
  /** What the application writes with. A form never sees it. */
  readonly app: AppApi;
  /** Where the new object will sit, as the browser walked it. */
  readonly at: PathAt;
  readonly plugins: readonly Manifest[];
  readonly loaded: readonly Loaded[];
  readonly mounts: readonly Mount[];
  readonly onAdded: (id: ObjectId) => void;
  readonly onCancel: () => void;
}

export function AddObject({
  api,
  app,
  at,
  plugins,
  loaded,
  mounts,
  onAdded,
  onCancel,
}: AddObjectProps): React.JSX.Element {
  const [chosen, setChosen] = useState<string[]>([]);
  // 0 is the picker; 1..n is the nth form. Only the picker changes `chosen`,
  // so a step past the last form cannot arise -- but if it did, the picker is
  // the only honest place to be.
  const [stepped, setStep] = useState(0);
  const [collected, setCollected] = useState<Collected>(new Map());
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);

  const choices = choosable(plugins);
  const forms = formsFor(plugins, chosen, mounts);
  const step = stepped <= forms.length ? stepped : 0;
  const name = nameOf(at.path);

  const create = (withValues: Collected): void => {
    setCreating(true);
    setProblem(undefined);
    app
      .objectCreate(newObjectFrom(at, chosen, withValues))
      .then(onAdded)
      .catch((error: unknown) => {
        setProblem(describe(error));
        setCreating(false);
      });
  };

  // Past the last form there is nothing left to ask, so advancing from it
  // creates. Same for advancing from the picker when no form is wanted.
  const advance = (withValues: Collected): void => {
    if (step >= forms.length) {
      create(withValues);
    } else {
      setStep(step + 1);
    }
  };

  const heading = (
    <Stack gap="none">
      <Heading as="h2">Add {name}</Heading>
      <Text size="small">
        {at.path}
        {at.kind === "folder" ? "/" : ""}
      </Text>
    </Stack>
  );

  if (step === 0) {
    return (
      <Stack gap="normal" padding="normal">
        {heading}

        {choices.length === 0 ? (
          <Text>
            No installed plugin offers a type. It will be recorded as what it
            is on disk.
          </Text>
        ) : (
          <CheckboxGroup onChange={(selected) => setChosen(selected)}>
            <CheckboxGroup.Label>What is it?</CheckboxGroup.Label>
            <CheckboxGroup.Caption>
              Choose any that apply, or none. A plugin whose type is chosen asks
              for what it needs next.
            </CheckboxGroup.Caption>
            {choices.map((choice) => {
              const { name: label, within } = wording(choice);
              return (
                <FormControl key={choice.property}>
                  <Checkbox value={choice.property} checked={chosen.includes(choice.property)} />
                  <FormControl.Label>{label}</FormControl.Label>
                  {within && <FormControl.Caption>within {within}</FormControl.Caption>}
                </FormControl>
              );
            })}
          </CheckboxGroup>
        )}

        {problem && <InlineMessage variant="critical">{problem}</InlineMessage>}

        <Stack direction="horizontal" gap="condensed">
          <Button variant="primary" disabled={creating} onClick={() => advance(collected)}>
            {forms.length === 0 ? (creating ? "Adding…" : "Add") : "Next"}
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </Stack>
      </Stack>
    );
  }

  // `step` is within 1..forms.length here, so the lookup cannot miss; the
  // fallback only satisfies the index type.
  const contribution = forms[step - 1] ?? forms[0];
  if (!contribution) return <Stack padding="normal">{heading}</Stack>;

  const Form = formFor(contribution, loaded);

  return (
    <Stack gap="normal" padding="normal">
      {heading}
      <Text size="small" weight="semibold">
        {contribution.property} · step {step} of {forms.length}
      </Text>

      {Form ? (
        <Form
          // Keyed so a form for one property does not keep its state when
          // the step moves to another plugin's form.
          key={contribution.property}
          api={api}
          property={contribution.property}
          paths={[at]}
          initial={collected.get(contribution.property) ?? {}}
          onDone={(result) => {
            if (!result.ok) {
              setProblem(result.problem);
              return;
            }
            setProblem(undefined);
            const next = new Map(collected);
            next.set(contribution.property, result.values);
            setCollected(next);
            advance(next);
          }}
        />
      ) : (
        <Stack gap="condensed">
          <InlineMessage variant="warning">
            {contribution.plugin}&apos;s form did not load. The property can still
            be chosen; it will carry no values until something fills them in.
          </InlineMessage>
          <Button onClick={() => advance(collected)}>Continue without it</Button>
        </Stack>
      )}

      {problem && <InlineMessage variant="critical">{problem}</InlineMessage>}

      <Stack direction="horizontal" gap="condensed">
        <Button disabled={creating} onClick={() => setStep(step - 1)}>
          Back
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
        {creating && <Text size="small">Adding…</Text>}
      </Stack>
    </Stack>
  );
}

/**
 * The form a contribution names, if its module loaded and is one.
 *
 * Same shape as the object page's `componentFor`, and kept separate for the
 * same reason `formComponent` is kept apart from `panelComponent`: the two
 * contracts can diverge, and a shared resolver would let one silently accept
 * the other's shape.
 */
function formFor(
  contribution: Contribution,
  loaded: readonly Loaded[],
): ReturnType<typeof formComponent> {
  const owner = loaded.find((entry) => entry.manifest.id === contribution.plugin);
  if (!owner) return undefined;
  return formComponent(owner.modules.get(contribution.value));
}
