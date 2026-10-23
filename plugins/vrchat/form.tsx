/**
 * The second step, when somebody says a new object is a VRChat asset.
 *
 * A category and a vendor. The category is offered from the ones the seed
 * library settled on and accepts anything; the vendor is free text, because
 * `vrc-lessons.md` is clear that guessing one from a filename is a mistake
 * and the package reader's folders are a hint for the person, not an answer.
 */

import { Button, FormControl, Stack, TextInput } from "@primer/react";
import { useState } from "react";

import type { FormProps } from "../../src/plugin-host/panel.js";
import { CATEGORIES, vrchatFields } from "./vrchat.js";

export default function VrchatForm({ paths, initial, onDone }: FormProps): React.JSX.Element {
  // The folder a thing sits in is the category the person already filed it
  // under, so it is the honest default.
  const folder = paths[0]?.path.includes("/") ? paths[0].path.split("/")[0] ?? "" : "";

  const [category, setCategory] = useState(initial["category"] ?? folder);
  const [vendor, setVendor] = useState(initial["vendor"] ?? "");

  return (
    <Stack gap="condensed">
      <FormControl>
        <FormControl.Label>Category</FormControl.Label>
        <TextInput
          list="vrchat-categories"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          block
        />
        <datalist id="vrchat-categories">
          {CATEGORIES.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </FormControl>

      <FormControl>
        <FormControl.Label>Vendor</FormControl.Label>
        <TextInput value={vendor} onChange={(event) => setVendor(event.target.value)} block />
        <FormControl.Caption>
          The shop or author. The package panel lists the folders under Assets/, where it usually sits.
        </FormControl.Caption>
      </FormControl>

      <Stack direction="horizontal" gap="condensed">
        <Button variant="primary" onClick={() => onDone({ ok: true, values: vrchatFields({ category, vendor }) })}>
          Next
        </Button>
      </Stack>
    </Stack>
  );
}
