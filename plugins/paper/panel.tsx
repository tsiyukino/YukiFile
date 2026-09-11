/**
 * What a paper says on an object's page.
 *
 * Small on purpose. The DOI is the one thing this plugin knows that the page
 * cannot work out for itself, so it is the one thing shown. A citation, a
 * fetched abstract and an author list all want the network, and `docs.yml` says
 * that happens when the user presses a button rather than when a page draws.
 *
 * The region is drawn whether or not the DOI is there: a paper somebody
 * recorded without one is still a paper, and a blank region is what says the
 * field is waiting to be filled.
 */

import { Link, Text } from "@primer/react";
import { useEffect, useState } from "react";

import type { PanelProps } from "../../src/plugin-host/panel.js";

export default function PaperPanel({
  api,
  objectId,
  property,
  instance,
}: PanelProps): React.JSX.Element {
  const [doi, setDoi] = useState<string | undefined>(undefined);

  useEffect(() => {
    let current = true;

    api
      .objectFlat(objectId)
      .then((object) => {
        if (!current) return;
        const region = object.regions.find(
          (candidate) =>
            candidate.property === property && candidate.instance === instance,
        );
        setDoi(region?.fields["doi"]);
      })
      .catch(() => {
        // The object page already reports what it could not read. A panel
        // saying so a second time is two messages about one failure.
        if (current) setDoi(undefined);
      });

    return () => {
      current = false;
    };
  }, [api, objectId, property, instance]);

  if (!doi) {
    return <Text size="small">No DOI recorded.</Text>;
  }

  // A link rather than plain text: a DOI's whole purpose is to resolve, and
  // retyping one into a browser is what it exists to avoid.
  return (
    <Text size="small">
      <Link href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer">
        {doi}
      </Link>
    </Text>
  );
}
