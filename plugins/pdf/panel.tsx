/**
 * What a PDF is, beside the page that shows it.
 *
 * Deliberately small. The plugin's reason for existing in v1 is the viewer;
 * the panel exists because an object page should say something about a PDF
 * before anybody opens it, and because a plugin contributing to both slots is
 * what proves the two are independent.
 *
 * No page count here. Counting pages means opening the document, and opening
 * it in a panel that is drawn for every PDF in a list would load pdf.js for
 * documents nobody asked to see.
 */

import { Text } from "@primer/react";

import type { PanelProps } from "../../src/plugin-host/panel.js";
import { pdfLocation } from "./pdf.js";
import { useEffect, useState } from "react";

export default function PdfPanel({ api, objectId }: PanelProps): React.JSX.Element {
  const [where, setWhere] = useState<string | undefined>(undefined);

  useEffect(() => {
    let current = true;

    api
      .objectFlat(objectId)
      .then((object) => {
        if (current) setWhere(pdfLocation(object));
      })
      .catch(() => {
        // The object page already reports what it could not load. A panel
        // repeating it would say the same thing twice on one screen.
      });

    return () => {
      current = false;
    };
  }, [api, objectId]);

  return <Text size="small">{where ?? "no PDF on disk"}</Text>;
}
