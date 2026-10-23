/**
 * Where a thing was bought.
 *
 * A listing URL in any of the spellings people paste, a price in yen, and
 * the title the shop uses. The URL is normalised to an item id and the
 * canonical page, so two spellings of one listing compare equal; one that is
 * not a Booth listing is refused with its reason.
 */

import { Button, FormControl, Stack, TextInput } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import { useState } from "react";

import type { FormProps } from "../../src/plugin-host/panel.js";
import { boothFields } from "./vrchat.js";

export default function BoothForm({ initial, onDone }: FormProps): React.JSX.Element {
  const [url, setUrl] = useState(initial["url"] ?? "");
  const [price, setPrice] = useState(initial["price"] ?? "");
  const [title, setTitle] = useState(initial["title"] ?? "");
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const done = (): void => {
    const result = boothFields({ url, price, title });
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    setProblem(undefined);
    onDone(result);
  };

  return (
    <Stack gap="condensed">
      <FormControl>
        <FormControl.Label>Listing</FormControl.Label>
        <TextInput
          value={url}
          placeholder="https://booth.pm/ja/items/6467347"
          onChange={(event) => setUrl(event.target.value)}
          block
        />
        <FormControl.Caption>A Booth URL in any form, or the item number.</FormControl.Caption>
      </FormControl>

      <FormControl>
        <FormControl.Label>Price</FormControl.Label>
        <TextInput value={price} placeholder="1200" onChange={(event) => setPrice(event.target.value)} />
        <FormControl.Caption>Whole yen.</FormControl.Caption>
      </FormControl>

      <FormControl>
        <FormControl.Label>Shop title</FormControl.Label>
        <TextInput value={title} onChange={(event) => setTitle(event.target.value)} block />
        <FormControl.Caption>As the listing names it. Becomes a source for the object's title.</FormControl.Caption>
      </FormControl>

      {problem && <InlineMessage variant="warning">{problem}</InlineMessage>}

      <Stack direction="horizontal" gap="condensed">
        <Button variant="primary" onClick={done}>
          Next
        </Button>
      </Stack>
    </Stack>
  );
}
