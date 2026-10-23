/**
 * The listing, as a link, and its price.
 *
 * Nothing is fetched. `docs.yml` says the network happens when the user
 * presses a button, and a page drawing is not one.
 */

import { Link, Text } from "@primer/react";
import { useEffect, useState } from "react";

import type { PanelProps } from "../../src/plugin-host/panel.js";

export default function BoothPanel({ api, objectId, property, instance }: PanelProps): React.JSX.Element {
  const [fields, setFields] = useState<Readonly<Record<string, string>> | undefined>(undefined);

  useEffect(() => {
    let current = true;
    api
      .objectFlat(objectId)
      .then((object) => {
        if (!current) return;
        const region = object.regions.find((r) => r.property === property && r.instance === instance);
        setFields(region?.fields ?? {});
      })
      .catch(() => {
        if (current) setFields({});
      });
    return () => {
      current = false;
    };
  }, [api, objectId, property, instance]);

  if (!fields) return <Text size="small">Reading…</Text>;

  const url = fields["url"];
  const price = fields["price"];

  if (!url && !price) return <Text size="small">No listing recorded.</Text>;

  return (
    <Text size="small">
      {url ? (
        <Link href={url} target="_blank" rel="noreferrer">
          {fields["title"] ?? url}
        </Link>
      ) : (
        fields["title"]
      )}
      {price && ` · ¥${price}`}
    </Text>
  );
}
