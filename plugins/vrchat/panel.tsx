/**
 * What a VRChat asset says on its page: what it is, who made it, what it fits.
 *
 * The avatars come from edges, not fields. `supports` is what the listing
 * says it fits; `owned` is what is on disk. `vrc-lessons.md`: those are
 * different sets, and reverse lookup has to answer from the second.
 */

import { Label, LabelGroup, Stack, Text } from "@primer/react";
import { useEffect, useState } from "react";

import type { Edge, Term } from "../../src/plugin-host/commands.js";
import type { PanelProps } from "../../src/plugin-host/panel.js";

interface Shown {
  readonly fields: Readonly<Record<string, string>>;
  readonly avatars: ReadonlyMap<string, string[]>;
}

/** Avatar edges grouped by kind, labelled from the vocabulary. */
export function avatarsOf(edges: readonly Edge[], terms: readonly Term[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.target !== "term" || edge.vocab !== "avatar") continue;
    const label = terms.find((term) => term.id === edge.term)?.label ?? edge.term;
    const held = grouped.get(edge.kind) ?? [];
    held.push(label);
    grouped.set(edge.kind, held);
  }
  return grouped;
}

export default function VrchatPanel({ api, objectId, property, instance }: PanelProps): React.JSX.Element {
  const [shown, setShown] = useState<Shown | undefined>(undefined);

  useEffect(() => {
    let current = true;
    Promise.all([api.objectFlat(objectId), api.objectEdges(objectId), api.termList("avatar")])
      .then(([object, edges, terms]) => {
        if (!current) return;
        const region = object.regions.find((r) => r.property === property && r.instance === instance);
        setShown({ fields: region?.fields ?? {}, avatars: avatarsOf(edges, terms) });
      })
      .catch(() => {
        if (current) setShown({ fields: {}, avatars: new Map() });
      });
    return () => {
      current = false;
    };
  }, [api, objectId, property, instance]);

  if (!shown) return <Text size="small">Reading…</Text>;

  const { fields, avatars } = shown;
  const line = [fields["category"], fields["vendor"]].filter(Boolean).join(" · ");

  return (
    <Stack gap="condensed">
      {line ? <Text size="small">{line}</Text> : <Text size="small">No category or vendor recorded.</Text>}
      {fields["status"] && (
        <Text size="small" weight="light">
          source: {fields["status"]}
        </Text>
      )}
      {avatars.size === 0 ? (
        <Text size="small">No avatars recorded.</Text>
      ) : (
        [...avatars.entries()].map(([kind, labels]) => (
          <Stack key={kind} gap="none">
            <Text size="small" weight="semibold">
              {kind}
            </Text>
            <LabelGroup>
              {labels.map((label) => (
                <Label key={label}>{label}</Label>
              ))}
            </LabelGroup>
          </Stack>
        ))
      )}
    </Stack>
  );
}
