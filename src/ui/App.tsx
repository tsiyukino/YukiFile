/**
 * The application shell.
 *
 * Deliberately thin for now: this commit's job is the scaffolding, and what
 * proves the scaffolding works is a command answering across the boundary.
 * The object page arrives next and replaces the body of this.
 *
 * # Layout comes from Primer's tokens, not from numbers
 *
 * `Stack` takes named spacing (`normal`, `condensed`) rather than pixel
 * values. Primer v38 removed the `sx` prop and the `Box` component, so there
 * is no longer a supported way to hand-place things with arbitrary spacing —
 * which is the design system doing its job. Two visual registers held together
 * by shared tokens was the point; bypassing them is how they drift apart.
 */

import { Heading, Stack, Text } from "@primer/react";
import { useEffect, useState } from "react";

import { apiFor, type Api } from "../plugin-host/commands.js";
import { invoke } from "./invoke.js";

/** The API every panel is handed, wired to the real Tauri bridge. */
export const api: Api = apiFor(invoke);

export function App(): React.JSX.Element {
  const [reached, setReached] = useState("asking the core…");

  useEffect(() => {
    // Any read-only command would do. This one needs no library contents to
    // answer, so it says whether the bridge is wired without depending on a
    // scan having run.
    api
      .termList("avatar")
      .then((terms) => setReached(`the core answered: ${terms.length} avatar terms`))
      .catch((error: unknown) => setReached(describe(error)));
  }, []);

  return (
    <Stack padding="normal" gap="condensed">
      <Heading>Yukifile</Heading>
      <Text size="medium">{reached}</Text>
    </Stack>
  );
}

/** A thrown value in words, whatever shape it arrived in. */
function describe(error: unknown): string {
  if (typeof error === "object" && error !== null && "kind" in error) {
    return `the core refused: ${String((error as { kind: unknown }).kind)}`;
  }
  return error instanceof Error ? error.message : String(error);
}
