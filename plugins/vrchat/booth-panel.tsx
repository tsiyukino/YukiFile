/**
 * The listing: its title as a link, its shop, its price, its number, and a
 * warning when the shop is not the vendor anything else names.
 *
 * Nothing is fetched. `docs.yml` says the network happens when the user
 * decides, and a page drawing is not a decision.
 *
 * Title, price, url, vendor and cover are shared fields, so they are among
 * the object's sources for each field rather than in this region's own
 * fields; `listingValues` gathers both. Reading only the region's fields
 * once made this panel say "No listing recorded." on every product that had
 * one.
 */

import { Link, Text } from "@primer/react";
import { AlertIcon } from "@primer/octicons-react";
import { useEffect, useState } from "react";

import type { FlatObject } from "../../src/plugin-host/commands.js";
import type { PanelProps } from "../../src/plugin-host/panel.js";
import { listingValues, pageUrl, shopMismatch } from "./booth.js";
import { boothItem } from "./vrchat.js";

export default function BoothPanel({ api, objectId, property, instance }: PanelProps): React.JSX.Element {
  const [object, setObject] = useState<FlatObject | null | undefined>(undefined);

  useEffect(() => {
    let current = true;
    api
      .objectFlat(objectId)
      .then((found) => {
        if (current) setObject(found);
      })
      .catch(() => {
        if (current) setObject(null);
      });
    return () => {
      current = false;
    };
  }, [api, objectId, property, instance]);

  if (object === undefined) return <Text size="small">Reading…</Text>;
  if (object === null) return <Text size="small">This listing could not be read.</Text>;

  const own = listingValues(object, property, instance);
  const item = own["item_id"] ?? (own["url"] ? boothItem(own["url"]) : undefined);
  const link = own["url"] ?? (item ? pageUrl(item) : undefined);

  if (!item && !link && !own["title"]) return <Text size="small">No listing recorded.</Text>;

  const mismatch = shopMismatch(own["vendor"], object, property, instance);
  const fetched = own["vendor"] !== undefined || own["cover"] !== undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Text size="small">
        {link ? (
          <Link href={link} target="_blank" rel="noreferrer">
            {own["title"] ?? link}
          </Link>
        ) : (
          own["title"]
        )}
        {own["vendor"] && ` · ${own["vendor"]}`}
        {own["price"] && ` · ¥${own["price"]}`}
        {item && ` · #${item}`}
      </Text>
      {!fetched && item && (
        <Text size="small" style={{ color: "var(--fgColor-muted)" }}>
          Not fetched yet: Fetch listing at the top of the page brings its picture and shop.
        </Text>
      )}
      {mismatch && (
        <Text size="small" style={{ color: "var(--fgColor-attention)" }}>
          <AlertIcon size={12} /> This listing is by {mismatch.shop}, but this object says {mismatch.files}. The listing
          number may be wrong: correct item_id, then fetch again.
        </Text>
      )}
    </div>
  );
}
